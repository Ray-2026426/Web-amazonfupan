# 领星 MCP → 亚马逊业绩报告 字段校准

> 本文是**实测结果**,不是文档转述。所有字段名、样例值都来自 2026-09-02 的真实调用返回。
> 校对日期：2026-09-18　校对方式：`scripts/lingxing-probe.mjs`（真实 key）

---

## 一、已跑通的调用方式

**服务端**：`https://openmcp.lingxing.com/mcp-servers/lingxing-mcp`（协议 `2025-06-18`）

> ⚠️ 用 `https://`，不要用 `http://`。领星官方明确要求 https，否则 key 明文传输。

**三步调用链**（`help` → `search` → `action`）：

```
tools/list  →  只有 3 个网关工具：help / search / action
help        →  {limit:50, offset:0}   列出业务工具（本账号共 276 个：198 只读 + 78 写入）
search      →  {toolId:"<工具ID>"}    取该工具的入参 JSON Schema
action      →  {toolId, params}       执行
```

### 三个必须知道的坑（都踩过）

**坑 1：业务参数必须放在 `arguments` 字段**

```js
// ❌ 错误：写成 params，网关收不到 toolId，领星返回 code=400 参数有误（很容易误判成业务参数问题）
rpc('tools/call', { name: 'action', params: { toolId, params } })
// ✅ 正确
rpc('tools/call', { name: 'action', arguments: { toolId, params } })
```

**坑 2：成功码是 `code:1`，不是 0；失败也返回 HTTP 200**

```json
{"code":1,   "data":{...}, "success":true}                 // 成功
{"code":400, "data":null, "msg":"参数有误", "success":false}  // 参数错
{"code":102, "data":null, "msg":"MCP Key无效或已失效"}       // key 无效
{"code":429, "data":null, "msg":"认证请求过于频繁"}           // 试太多次被风控
```

JSON-RPC 层的 `isError` **恒为 false**，必须自己判 `code`。

**坑 3：`initialize` / `tools/list` 不校验鉴权**

拿假 key 也能握手成功并拿到 3 个网关工具。「能连上」不等于「key 有效」——鉴权只在 `action` 时才真正检查。

---

## 二、两张表的基本情况

| | 产品表现 | 订单利润 |
|---|---|---|
| toolId | `query_product_performance_asin_lists` | `query_order_profit_list` |
| 数据行字段数 | **235** | **166** |
| 有日期字段？ | ✅ `rdate` | ❌ **没有** |
| 能按店铺过滤？ | ✅ `sids` 参数 | ❌ 无 `sids` 参数 |
| 主要提供 | 销量 / 流量 / 广告 / 评分 / 库存 | **成本结构**（采购/物流/仓储/佣金/退款） |
| 两边同名字段 | **36 个** | |

### 2.1 粒度问题（最关键的一条）

**产品表现的默认行为是「跨店铺聚合」**，直接拉会得到不能用的行：

| 行 | asin | `sids` | 国家 |
|---|---|---|---|
| 0 | B0CPL5MRXY | `[4346,4347,4799,4348]`（4 店） | 美国/加拿大/巴西/墨西哥 |
| 2 | B08N9TLWY2 | **20 个店铺** | 德国/法国/荷兰/西班牙/意大利/… |

而本 app 的 `DataRow` 是「**店铺 + 国家 + ASIN + 日期**」粒度。所以**必须按店铺循环查询**。

**已验证的解法**：每次传 `sids=<单个店铺ID>`，返回行就变成单店：

```
sids=4346 → 行0: asin=B0CPL5MRXY sids=[4346] 国家=美国 volume=551 amount=14482.11
            行1: asin=B0CPL4XB7G sids=[4346] 国家=美国 volume=166 amount=11011.38
total 从 25497（全店）降到 482（单店）
```

**成本**：本账号 **81 个店铺**，QPS=1（≥1.2 秒/次）→ 单日增量约 **81 次调用 ≈ 2 分钟**。
历史回补按天循环：1 年 ≈ 3 万次 ≈ 11 小时（可断点续跑，适合夜间跑）。

### 2.2 订单利润没有日期字段

`data.list[]` 里没有任何日期字段，所以**无法一次拉多天再自己按天拆**。
解法：**按天循环**，每次 `start_date = end_date = D`。

它同样有粒度问题（`sids` 是数组，无 `sids` 入参），但它的 `summary_field` 枚举里有 `msku`——
而 MSKU 本身就是店铺特有的。**待验证**：`summary_field=msku` 是否能让订单利润的行拆到单店。

---

## 三、字段映射表

### 3.1 产品表现 → app `DataRow`（维度）

| app 字段 | 领星字段 | 状态 |
|---|---|---|
| `date` | `rdate` | ✅ 已验证 `"2026-09-02"` |
| `child_asin` | `asin` | ✅ |
| `parent_asin` | `parent_asins[0].parent_asin`（**顶层 `parent_asin` 是 null**） | ⚠️ 注意 |
| `product_name` | `item_name`（或 `local_name` 中文短名） | ✅ |
| `shop_name` | `seller_store_countries[0].seller_name` 或 `price_list[0].seller_name` | ✅ 已验证 `"OG-Meo-NA诺博-US"` |
| `country` | `seller_store_countries[0].country` | ⚠️ 返回**中文**（`"美国"`），需要中文→国家代码映射 |
| `brand` | `price_list[0].brand_title`（已验证 `"Meowoo"`） | ⚠️ 待确认 |
| `manager` | `principal_names`（已验证 `"李梦琳"`） | ⚠️ 待确认 |

### 3.2 产品表现 → app `DataRow`（指标）—— 全部已验证

| app 字段 | 领星字段 | 实测样例 |
|---|---|---|
| `sales_quantity` | `volume` | 551 |
| `sales_amount` | `amount` | 14482.11 |
| `gross_profit` | `gross_profit` | 1672.80 |
| `sessions` | `sessions` | 197 |
| `impressions` | `impressions` | 24624 |
| `clicks` | `clicks` | 274 |
| `ad_spend` | `spend` | 830.66 |
| `ad_sales` | `ad_sales_amount` | 3637.72 |
| `ad_orders` | `ad_order_quantity` | 131 |
| `natural_clicks` | `nature_click` | 561 |
| `natural_orders` | `nature_order_items` | 419 |
| `fba_sellable_qty` | `afn_fulfillable_quantity` | 16925 |
| `rating` | `avg_star` | 4.6 |
| `review_count` | `reviews_count` | 4031 |
| `sp_spend` / `sp_sales` | `ads_sp_cost` / `ads_sp_sales` | |
| `sd_spend` / `sd_sales` | `ads_sd_cost` / `ads_sd_sales` | |
| `sb_spend` / `sb_sales` | `shared_ads_sb_cost` / `shared_ads_sb_sales` | ⚠️ 命名不同 |
| `sbv_spend` / `sbv_sales` | `shared_ads_sbv_cost` / `shared_ads_sbv_sales` | ⚠️ 命名不同 |

> **命名陷阱**：产品表现用 `shared_ads_sb_cost`，订单利润用 `ads_sb_cost`。同一个东西两种名字。

**产品表现额外能给的**（app 目前没用到，但很有价值）：
同环比 `amount_chain_ratio` / `amount_yoy_ratio`、`volume_chain_ratio` / `volume_yoy_ratio`、
`buy_box_percentage`（Buybox 占有率）、`acos` / `roas` / `tacos` / `asoas` / `cpc` / `ctr` / `cvr`、
`volume_7d` / `volume_14d` / `volume_30d`（滚动销量）、`available_days`（可售天数）、
`return_rate` / `return_goods_rate`、`cate_rank`（类目排名）、`page_views` 系列。

### 3.3 订单利润 → app `DataRow`（成本字段，**产品表现完全没有**）

这是「必须拼接」的原因——36 个成本字段**只在订单利润里**：

| app 字段 | 领星字段 | 实测样例 | 状态 |
|---|---|---|---|
| `procurement_cost` | `purchase_costs` | -29131.73 | ⚠️ |
| `first_mile_cost` | `logistics_costs`？还是 `afn_logistics_costs`？ | -5784.72 | ⚠️ **需你确认** |
| `fba_fee` | `fba_fulfillment_fee` 还是 `fulfillment_fee`？ | -59092.90 | ⚠️ **需你确认** |
| `storage_fee` | `fba_storage_fee` + `long_term_stock_fee`？还是 `total_stock_fee`？ | -2292.10 | ⚠️ **需你确认** |
| `platform_commission` | `selling_fee` | -28419.23 | ⚠️ |
| `refund_cost` | `refund_amount` | -12699.07 | ⚠️ |

### 3.4 ⚠️ 符号约定：成本是负数

订单利润返回的成本**全部是负数**（`selling_fee: -28419.23`、`purchase_costs: -29131.73`）。

而 app 的 `types.ts` 明确写着：

```ts
// Costs (Absolute values for aggregation)
first_mile_cost: number;
```

→ **必须取绝对值**，否则所有占比与毛利率会算反。这是拼接时最容易出错的一步。

---

## 四、拼接方案

```
对每一天 D：
  对每个店铺 sid（81 个）：
    产品表现(sids=sid, start=end=D, date_view_type=day, summary_field=asin)
      → 单店 × 单日 × ASIN 指标（销量/流量/广告/评分/库存）
  订单利润(start=end=D, summary_field=msku[待验证])
      → 成本结构（按 MSKU）
  以 (店铺 + ASIN/MSKU + 日期) 为键拼接
      → 取订单利润成本的绝对值
      → 输出符合 DataRow 的一行
```

**拼接键的难点**：
- 产品表现的行是 **ASIN 级**（`asin` + `sids`）
- 订单利润的行是 **MSKU 级**（`price_list[].seller_sku` + `price_list[].asin`）
- 两边都有 `price_list`，里面有 `asin` / `parent_asin` / `seller_sku` / `sid` → **可以用 `price_list` 做映射表**

---

## 五、需要你确认的 4 件事

1. **头程 / FBA费 / 仓储费分别对应哪个字段？**
   领星的成本字段名有多个近义项（`logistics_costs` vs `afn_logistics_costs`、`fulfillment_fee` vs `fba_fulfillment_fee`、
   `fba_storage_fee` vs `total_stock_fee` vs `long_term_stock_fee`），**我不敢替你猜**——猜错会让整个 P&L 费用结构失真。
   建议：你打开领星「订单利润」页面，看它表头对应的字段名，或者告诉我你现在的 Excel 里这几列的列名。

2. **币种**：我测试用的是 `currency_type=CNY`（返回 `￥`）。你实际经营报表用 **USD 还是 CNY**？
   （这会影响所有金额字段，也会影响 `target` 目标的币种一致性）

3. **国家字段**：领星返回中文（`"美国"`），你 app 里的 `country` 存的是**国家代码还是中文**？
   （决定要不要建一张映射表，也决定筛选器能不能对上）

4. **`parent_asin` 取值**：产品表现**顶层** `parent_asin` 是 `null`，只有 `parent_asins[]` 数组和 `price_list[].parent_asin` 有值。
   你 app 的父 ASIN 折叠功能依赖这个字段——确认用哪个来源？

---

## 六、附：可复用脚本

| 脚本 | 用途 |
|---|---|
| `scripts/lingxing-probe.mjs` | 通用探针：`--catalog` 拉全量工具目录 / `--call` / `--schema` |
| `.lingxing-probe/catalog.tsv` | 276 个业务工具清单（toolId + 名称），便于按关键词找工具 |
| `.lingxing-probe/field-inventory.json` | 两张表的完整字段清单 |

`.lingxing-probe/` 已在 `.gitignore` 中——**里面有真实店铺名、销量、品名，绝不能提交**。
