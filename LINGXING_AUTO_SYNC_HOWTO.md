# 领星数据自动同步 · 操作手册（给第一次配置的人）

目标：**不用再下载 Excel、不用再手动上传**。每天自动从领星取数写进数据库，看板打开就是最新数据。
电脑关机也照跑，因为任务跑在 GitHub 的服务器上。

## 一、整体是怎么转的（先理解这一句）

```
GitHub Actions（每天 08:10 自动跑）
        │  用 MCP 密钥调领星接口，拉最近几天、筛掉零活动行
        ▼
Supabase 数据库（免费额度，存日明细，月/周用视图现算）
        │  浏览器用「匿名只读」的 key 查
        ▼
看板（打开即最新；本地 IndexedDB 只做缓存/离线兜底）
```

密钥只存在 GitHub Secrets 和 Supabase 后台，**不会进代码、不会进浏览器**。

## 二、你需要做的 4 件事

### 1. 拿领星 MCP 密钥

- 位置：领星 ERP → 开放平台 / MCP 设置里，生成一串密钥（`X-Mcp-Key`）。
- 官方说明：<https://www.lingxing.com/help/article/mcp>
- 权限只需要**读取**（店铺、产品表现、订单利润）。
- 拿到后先别贴到聊天里，第 3 步直接填进 GitHub Secrets。

### 2. 开一个免费的 Supabase 数据库

1. 打开 <https://supabase.com> → 用 GitHub 账号登录 → New project。
2. 名字随便（如 `amazon-dashboard`），区域选 `Southeast Asia (Singapore)`，记下数据库密码（用不到也能填）。
3. 项目建好后，左侧 **SQL Editor** → 把本仓库 `db/schema.sql` 全文粘进去 → Run。看到 Success 就对了。
4. 左侧 **Project Settings → API**，记下两样东西：
   - `Project URL`（形如 `https://xxxx.supabase.co`）
   - `service_role` 那一栏的 key（**不是** `anon` 那个；这个只给 GitHub 用）

### 3. 在 GitHub 仓库里填 3 个 Secret

仓库 → **Settings → Secrets and variables → Actions → New repository secret**，逐个添加：

| 名字 | 值 |
|---|---|
| `LINGXING_MCP_KEY` | 第 1 步拿到的领星 MCP 密钥 |
| `SUPABASE_URL` | 第 2 步的 Project URL |
| `SUPABASE_SERVICE_KEY` | 第 2 步的 `service_role` key |

填完可以在 **Variables** 里加一个 `LINGXING_CURRENCY`（默认 `USD`；如果你的报表是人民币口径就填 `CNY`）。

### 4. 手动跑一次回补（第一次要补历史）

仓库 → **Actions** → 左侧「领星数据自动同步」→ 右侧 **Run workflow**：

- 第一次建议 `days = 30`（补最近 30 天），点 Run。
- 跑完点进去看日志：应该出现「产物：日 N 行 / 月 N 行 / 周 N 行」和「Supabase 上传完成」。
- 30 天没问题后，再跑一次 `from` / `to` 指定更早的区间（一次最多 90 天，建议按月补）。

之后**不用再管**：每天北京时间 08:10 自动跑。失败会自动开一个 Issue 提醒你。

## 三、怎么确认数据对了

1. 打开 Supabase → Table Editor → `fact_daily`，应该能看到每天约 1,000 行左右。
2. 左侧 SQL Editor 跑一句对账：

```sql
-- 最近 7 天按天汇总，和你现有 Excel 的销售额对一下
select date, round(sum(sales_amount)::numeric, 2) as 销售额, round(sum(gross_profit)::numeric, 2) as 毛利额
from fact_daily
where date >= current_date - 7
group by 1 order by 1 desc;
```

3. 数字对得上再往下走（接前端）。**对不上先别接前端**，先查口径。

## 四、常见问题

| 现象 | 原因 / 处理 |
|---|---|
| 日志里「缺少 LINGXING_MCP_KEY」 | Secret 名字拼错，或没在仓库级而填到了组织级 |
| 日志里「网关错误 code=102」 | 领星密钥失效/无权限，重新生成 |
| 日志里「429」或大量店铺失败 | 领星 QPS=1 的风控。把 `--days` 调小（如 1~2）再试 |
| 成本匹配率低于 50% | 币种不对（`LINGXING_CURRENCY`），或订单利润表口径变了 |
| Supabase 报 401/403 | 用了 `anon` key 而不是 `service_role`；或没执行 `db/schema.sql` |
| 负毛利行占比很高（>30%） | 成本口径待核对（见下） |

## 五、已知待办

- **成本口径对账**：用 2026-09-17 的真实数据实测，1,109 行里有 51% 是负毛利。可能是
  「订单利润」的成本项比「销售额」口径更全（含头程/仓储），也可能是 MSKU→ASIN 归并错了。
  **必须先拿你现有 Excel 的毛利列对一次**，再决定口径。
- **前端接入**：目前数据只进数据库，看板还没有读它（下一步做：启动时拉数据库 → 写入
  IndexedDB → 顶部显示「业绩截至 X 月 X 日」）。保留 Excel 导入作为兜底。
- **库存 / 退货 / 评论 / 目标**：暂未接入（接口字段待逐个核对，目标不是实绩、只能人工维护）。
