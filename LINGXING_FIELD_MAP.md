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

### 六个必须知道的坑（全部实际踩过并解决）

**坑 1：业务参数必须放在 `arguments` 字段**

```js
// ❌ 错误：写成 params，网关收不到 toolId，领星返回 code=400 参数有误（很容易误判成业务参数问题）
rpc('tools/call', { name: 'action', params: { toolId, params } })
// ✅ 正确
rpc('tools/call', { name: 'action', arguments: { toolId, params } })
```

**坑 2：成功码是 `code:1`，不是 0；失败也返回 HTTP 200**

```json
{"code":1,   "data":{...}, "success":true}                    // 成功
{"code":400, "data":null, "msg":"参数有误", "success":false}     // 参数错
{"code":102, "data":null, "msg":"MCP Key无效或已失效"}          // key 无效
{"code":429, "data":null, "msg":"认证请求过于频繁"}              // 试太多次被风控
```

JSON-RPC 层的 `isError` **恒为 false**，必须自己判 `code`。

**坑 3：`initialize` / `tools/list` 不校验鉴权**

拿假 key 也能握手成功并拿到 3 个网关工具。「能连上」不等于「key 有效」——鉴权只在 `action` 时才真正检查。

**坑 4：必须完整走 `tools/list → help → search → action` 这条链**

少了刷新步骤，`action` 会返回
`422 {"code":102,"msg":"工具参数定义已更新，请刷新工具列表后重新调用。"}`。
会话建立顺序必须是：`initialize` → `notifications/initialized` → **`tools/list`** → **`help`** → **`search(toolId)`** → `action`。

**坑 5（最坑）：上面那条 422 报错，真正的成因往往不是"定义过期"，而是参数类型错了**

`offset` / `length` 的类型**两个工具不一样**：

| 工具 | `offset` / `length` 的 schema 类型 |
|---|---|
| `query_product_performance_asin_lists` | **integer**（传数字） |
| `query_order_profit_list` | **string**（**必须传字符串**） |

给订单利润传数字 `offset: 0`，就会得到那条"工具参数定义已更新"的 422 ——
报错信息和类型完全不沾边。**别被它带偏去反复刷新工具列表**（我在这上面浪费了好几轮）。

**坑 6：双层信封不一致**

网关统一返回 `{code:1, data:...}`，但 `data` 里面有的工具是业务载荷本体
（如店铺列表 `data.list`），有的还套了一层（如产品表现的 `data.data.list`）。
必须做一层归一化，不能写死层级。

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

## 四、拼接方案（已实现并跑通）

```
订单利润 summary_field='msku'（length='1000'，offset/length 用字符串）
  → 每行都是单店铺（实测 200/200）
  → 用 price_list[0] 取 (sid, asin, seller_sku)
  → 按 (sid|asin) 归并成本

产品表现 逐店铺 sids=<sid>（length=1000，offset/length 用数字）
  → 单店 × 当天 × ASIN 行，带 rdate

按 (sid|asin) 拼接 → 成本取绝对值 → 过滤零活动行 → 输出 Excel
```

**已实测确认：**
- 订单利润 `summary_field='msku'` 实测 **100% 单店铺行**（200/200），而 `summary_field='asin'`
  有 95/200 行是跨店铺的。**这是解决"订单利润没有 sids 参数"的关键。**
- 成本字段的取值选择（两两实测相等，可放心用）：
  `fulfillment_fee` == `fba_fulfillment_fee`、`fba_storage_fee` == `total_stock_fee`
- 头程字段仍有歧义：`logistics_costs`(-2.24) vs `afn_logistics_costs`(-2.18)，
  当前用 `logistics_costs`，改 `scripts/lingxing-asin-report.mjs` 的 `FIRST_MILE_FIELD` 即可切换。

**正确性对账（`scripts/verify-lingxing-report.mjs`）：**
逐店铺把「拉取到的行汇总」与「领星返回的 total_sum」对账 ——
81/81 店铺一致（仅 1 个店铺 0.03 的四舍五入差），销量 2307 = 2307。
说明**分页与店铺循环没有漏数据**。

**性能**：81 店铺 × 1 次调用（每店铺一页拉完）+ 订单利润 2 页 ≈ 116 次调用 / 约 9 分钟。
结果按店铺+日期缓存在 `.lingxing-probe/cache/`，重跑（换过滤条件、改字段）**秒级完成，不再打接口**。

### 4.1 必须过滤零活动行

产品表现返回的是**整个 ASIN 目录**：实测 2026-09-17 共 **45,789 行，其中只有 1,109 行有活动（2.3%）**。
全量导出既没法看也没意义。脚本默认只保留当天有活动的行，需要完整目录用 `--include-empty`。

---

## 五、⚠️ 数据新鲜度：流量指标不是 T+1

**实测证据（同一账号、同一套条件，只换日期）：**

| 指标（全店合计） | 2026-09-16 | 2026-09-17 |
|---|---|---|
| Sessions-Total | **14,117** | **789** |
| 自然点击量 < 0 的行数 | 49 | 467 |
| 匹配到成本的行 | 1,207 / 1,323 | 1,083 / 1,109 |

2026-09-17 的 `sessions` / `sessions_total` / `page_views` **全为 0**，且 `nature_click` 变成
`-clicks` 的负残差（因为自然流量 = 总流量 − 广告流量，总流量缺失时就成了负数）。
用 `length=1000` 拉全部 482 行复查，`total_sum.sessions` 依然是 0 —— **不是分页问题**。
切换 `date_type`（purchase / settlement）也不改变结果。

**结论：领星的亚马逊流量数据（Sessions / PageViews）有 1 天以上的同步延迟。**
若在 T+1 当天就拉前一日的报表，`Sessions-Total`、`CVR`、`销量CVR`、`自然点击量`、`自然CVR`
这 5 列会是 0 或负数。脚本已内置告警，不会静默输出空值。

**建议**：日常同步跑 **T-2**（即今天拉前天），或对 T-1 的数据标记"流量待补"。

---

## 六、仍需你确认的 2 件事

1. **头程费用**用 `logistics_costs` 还是 `afn_logistics_costs`？
   （两者实测值不同：-2.24 vs -2.18。当前默认前者）
2. **二级分类**：领星 `categories[0]` 形如 `B-GJ工具\A戒指尺\戒指测量`，
   脚本取第 2 段 = `"A戒指尺"`（含排序用字母前缀）。
   如果你们习惯的"二级分类"是去掉前缀的 `"戒指尺"`，把 `STRIP_LEVEL_PREFIX` 改成 `true` 即可。

（原先关于币种、国家字段的问题已定：币种用 USD；国家字段领星返回中文如 `"美国"`，报表按中文输出。）

---

## 七、怎么用

```powershell
$env:LINGXING_MCP_KEY='<你的鉴权密钥>'

# 生成某天的 ASIN 日报（输出到 reports/）
node scripts/lingxing-asin-report.mjs --date 2026-09-16 --currency USD

# 需要完整 ASIN 目录（含当天零销售的 ASIN）
node scripts/lingxing-asin-report.mjs --date 2026-09-16 --include-empty

# 忽略本地缓存，强制重新拉取
node scripts/lingxing-asin-report.mjs --date 2026-09-16 --no-cache

# 对账：逐店铺核对行汇总 vs 领星 total_sum
node scripts/verify-lingxing-report.mjs --date 2026-09-16
```

---

## 八、附：可复用脚本

| 脚本 | 用途 |
|---|---|
| `scripts/lingxing-client.mjs` | MCP 客户端封装（会话链路、双层信封归一化、错误解析、QPS 节流）。**所有领星调用都应走它** |
| `scripts/lingxing-asin-report.mjs` | **主脚本**：生成 ASIN 维度日报（Excel，47 列按指定顺序） |
| `scripts/verify-lingxing-report.mjs` | 对账：逐店铺核对行汇总 vs 领星 `total_sum` |
| `scripts/lingxing-probe.mjs` | 通用探针：`--catalog` 拉全量工具目录 / `--schema` / `--call` |
| `.lingxing-probe/catalog.tsv` | 276 个业务工具清单（toolId + 名称） |
| `.lingxing-probe/field-inventory.json` | 两张表的完整字段清单 |
| `.lingxing-probe/cache/<日期>/` | 按店铺缓存的原始返回，重跑秒级完成 |

`.lingxing-probe/` 与 `reports/` 已在 `.gitignore` 中 ——**里面有真实店铺名、销量、品名，绝不能提交**。
