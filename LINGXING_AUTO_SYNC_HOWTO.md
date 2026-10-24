# 领星数据自动更新：照着做

目标：电脑关机后，云端仍每天从领星拉取数据。看板打开后自动读取最新业绩，无需每天下载、上传 Excel。

## 已经完成

- 2026-10-20 已在 `Ray’AI WorkSpace` 新建独立项目 `amazon-performance-dashboard`，区域为新加坡，项目 URL 是 `https://ywbxdzsqymztlvknltbn.supabase.co`。
- 已运行 [db/schema.sql](db/schema.sql)：数据表、管理规则表、只读视图和按天原子替换函数都已建好。真实查询确认匿名角色无权读取业务表，测试写入已回滚。
- 2026-10-20 已确认 GitHub 仓库 `Ray-2026426/Web-amazonfupan` 与 Vercel 项目 `web-amazonfupan` 连接正常，生产部署已成功。已在 Vercel 的生产环境填入 `SUPABASE_URL`。
- 当前云数据库还没有同步记录或业务数据。Vercel 的其他环境变量尚未配置，因此看板还未切换到云端读取。
- 每日业绩保存在 `fact_daily`，不是一份不断追加的 Excel。每行对应日期、店铺、ASIN、币种；月度和周度由日明细汇总。目标表保存在独立的云端版本中，上传新版完整成功后才会切换。

## 你要做的事（只需配置一次）

1. **准备领星 MCP 密钥。** 在领星开放平台启用 MCP，生成可读取店铺、产品表现、订单利润的 `X-Mcp-Key`。密钥只填在 GitHub Secret 中，不要发到聊天里。[领星官方说明](https://www.lingxing.com/help/article/mcp)
2. **复制 Supabase 服务端密钥。** 项目和数据库已由我建好。打开 [这个 Supabase 项目](https://supabase.com/dashboard/project/ywbxdzsqymztlvknltbn)，在 API Keys 页面复制 **secret key**（通常以 `sb_secret_` 开头）。不要使用浏览器公开的 publishable key，也不要把密钥发到聊天里。
3. **给 GitHub 仓库配置三个 Secrets。** 在仓库 Settings → Secrets and variables → Actions → New repository secret 中填写：

   | 名称 | 填入的值 |
   | --- | --- |
   | `LINGXING_MCP_KEY` | 第 1 步的领星密钥 |
   | `SUPABASE_URL` | `https://ywbxdzsqymztlvknltbn.supabase.co` |
   | `SUPABASE_SECRET_KEY` | 第 2 步的 Supabase secret key |

4. **给 Vercel 项目配置剩余四个环境变量。** 在 [Vercel 项目](https://vercel.com/ray-2026426s-projects/web-amazonfupan) → Settings → Environment Variables 中填写（`SUPABASE_URL` 已由我填好）：

   | 名称 | 填入的值 |
   | --- | --- |
   | `VITE_CLOUD_SYNC_ENABLED` | `true` |
   | `SUPABASE_SECRET_KEY` | 同一个 Supabase secret key |
   | `DASHBOARD_READ_TOKEN` | 自己生成的一串至少 24 位随机字符，作为看板只读密码 |
   | `DASHBOARD_ADMIN_TOKEN` | 另一串不同的至少 24 位随机字符，作为数据管理密码 |

   保存后重新部署 Vercel 项目。`SUPABASE_SECRET_KEY`、`DASHBOARD_READ_TOKEN`、`DASHBOARD_ADMIN_TOKEN` **不要**添加 `VITE_` 前缀；它们只在服务端使用。看板上的“连接云端数据”输入只读密码，不输入领星或 Supabase 密钥。
   看板上的“数据管理”使用单独的 `DASHBOARD_ADMIN_TOKEN`。管理后台可查看同步记录与日明细、修改成本匹配及产品字段规则、暂停每日同步、调整每天回补 1–14 天。修改匹配规则后，下一次同步才会重算；更早的日期要到 GitHub Actions 手动指定 `from` / `to` 回补。
   如果领星同步使用的不是默认 `USD`，GitHub Variables 和 Vercel 环境变量都要设置相同的 `LINGXING_CURRENCY`（例如 `CNY`）。
5. **第一次补历史数据。** GitHub 仓库 → Actions →「领星数据自动同步」→ Run workflow。先输入 `days=3`，确认成功后分段补历史数据。每次建议 7–30 天，避免一次运行超过 GitHub Actions 的 120 分钟限制。`from` 和 `to` 都填写时按指定日期执行。完成后打开看板，输入只读密码。

   > 如果只是想确认"密钥/表有没有问题"，把 `selfcheck` 填 `true` 单独跑一次（日志会列出 ✅/❌ 清单）。
   > **平时跑同步时 `selfcheck` 留空或填 `false`**：自检会额外做一次领星鉴权，紧接着同步再鉴权，
   > 短时间两次鉴权容易触发 429「认证请求过于频繁」。
   > 现在同步脚本本身已内置限流退避：命中 429 会自动等待（40s→64s→102s）重试 4 次。
6. **目标表只上传一次。** 看板右上角点「数据管理」，输入单独的管理密码，进入「目标表」页上传全年目标文件。支持横向排列的“2026年1月目标销量”等列；目标按月份保存，业绩仍按天更新。下次打开看板会自动读取云端目标，无需重传。换新版目标时重新上传即可。
7. **下载每日明细。** 「数据管理」→「每日数据」→「下载每日明细」，可选「单日」或「时间段」，然后下载 CSV 或 Excel。
   列名与《项目业绩-月维度.xlsx》对齐：`日期 / 年份 / 月份` 打头，随后是参考表的 47 个业务字段（ASIN、父ASIN、店铺、国家、负责人、品名、二级分类、品牌、销量、销售额、订单量、退款金额、评分、评论数、订单毛利润、FBA-可售、Sessions-Total、CVR、销量CVR、广告花费、SP/SD/SB/SBV 广告费、广告销售额、SP/SD/SB/SBV 广告销售额、广告订单量、展示、点击、CTR、广告CVR、CPC、ROAS、ACOS、ACoAS、ASoAS、自然点击量、自然订单量、自然CVR、头程费用、FBA费用、仓储费用、采购费用、佣金费用），最后追加 `店铺ID / 币种` 便于去重对账。
   CSV 支持任意长度区间（前端按 31 天分段拉取后合并）；Excel 单次最多 92 天。

## 历史数据回补（2025-01-01 起）

**现状**：云端日明细从 2026-10-21 才开始有数据，所以现在下载 2025 年的区间会是空的。要把历史补齐，用专门的回补工作流：

Actions →「历史数据回补」→ Run workflow，参数：

| 参数 | 说明 |
|---|---|
| `from` | 起始日期，默认 `2025-01-01` |
| `to` | 结束日期，留空 = 昨天 |
| `chunk_days` | 每块天数，默认 14（一块约 40~60 分钟，留足 120 分钟余量） |
| `max_parallel` | 同时跑几块，默认 1（领星有 QPS 限制，调大容易 429） |

工作流会把区间自动切成连续的小块，逐块调用 `scripts/sync/run.mjs --from … --to … --upload`，每块独立任务、互不覆盖。

**耗时预期**：实测 1 天约 2~4 分钟（81 个店铺逐个调用），2025-01-01 到今天是 661 天，串行约 **30~45 小时**。建议：

- 先跑一个月（如 `2025-01-01` ~ `2025-01-31`）确认数字对得上；
- 再按季度分批，或把 `max_parallel` 调到 2~3 缩短挂钟时间（注意 429）；
- 回补与每日同步互不冲突（不同日期段），但同一天重复跑会整体替换，不会叠加。

回补完成后，「下载每日明细」就能按天或按任意区间导出完整历史。

## 我已经做好的部分

- GitHub Actions 每天北京时间约 08:10 运行，拉最近 3 天，覆盖领星延迟回填的数据；逐店限速和分页校验。
- Supabase 保存日明细；同一天的数据在数据库事务内整体替换，失败时保留旧数据。
- Vercel 的 `/api/data` 和 `/api/freshness` 只在服务端读 Supabase；看板按所选日期拉取本期、上期和去年同期数据，每 15 分钟刷新一次，显示数据截至日。
- 看板保留原有 Excel 导入。**目前自动更新的是 ASIN 业绩、流量、广告和成本。** 目标表由管理员上传一次后保存在云端；库存、退货、评论和图片仍沿用本地导入。
- 定时任务不再写死只拉 1 天：改为读「数据管理 → 自动同步设置 → 每天回补最近 N 天」（1~14，默认 3）。
  N 大于 1 时，某天同步失败留下的空档会在第二天的运行里被自动补上。
  如果缺口落在回补窗口之外（例如已经缺了一个星期），用 Actions →「领星数据自动同步」→ Run workflow
  填 `days=7`，或填 `from` / `to` 指定区间单独补一次。

## 上线前核对一次数字

Supabase SQL Editor 运行：

```sql
select date, round(sum(sales_amount), 2) as sales_amount,
       round(sum(gross_profit), 2) as gross_profit,
       round(sum(ad_spend), 2) as ad_spend
from fact_daily
where date >= current_date - 7
group by date order by date desc;
```

用你原来同日期、同币种、同店铺范围的 Excel 核对销售额、毛利和广告花费。

**已知的两处口径差异（不是错，是两张报表的定义不同）：**

| 项 | 产品表现（我们取销售额） | 订单利润（我们取毛利/成本） |
| --- | --- | --- |
| 销售额 | 含税/促销前的销售额 | 净额（扣退款等），会比产品表现略低 |
| 毛利 | — | 含「当天没销量但有仓储/头程/退款」的 ASIN |

实测 2026-09-17：销售额 26,353.62（产品表现） vs 24,376.68（订单利润净额），差 8.1%；
毛利 2,422.91（我们） vs 2,308.36（领星 total_sum），差 5.0%。

因此同步脚本的校验阈值设为 **10%**（超过才报警），并把每天的对账数字写进
`data/snapshot/manifest.json` 的 `meta.reconciliations`，可随时核对。

> 负毛利行占比看起来很高（实测 45%~59%）是正常现象：领星按 MSKU/天 粒度，
> 仓储费、头程、退款这些一次性成本会砸在某一天的某个 SKU 上，合计毛利仍是对的。

## 如何知道是否正常

- 看板顶部显示“云端业绩数据截至 YYYY-MM-DD”。同步失败时，会显示失败状态并保留数据库内上一次成功的数据。
- GitHub Actions 的这次运行日志显示“Supabase 上传完成”；失败时工作流尝试创建 GitHub Issue。
- 定时任务由 GitHub 执行，电脑关机不影响。GitHub 官方说明定时任务可能延迟或偶发跳过，公开仓库连续 60 天无活动还可能自动停用；如果以后需要严格保证每天准点更新，应迁移到专用云端调度器。[GitHub 官方说明](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule)

## 同步失败时按这个顺序查

1. **先跑「领星连通性测试」**（Actions 左侧另一个 workflow，点 Run workflow，约 10 秒出结果）。
   它只做 1 次鉴权 + 1 次取店铺列表，不像整轮同步那样烧几百次请求。
2. **如果它也报 429**：这是领星的鉴权频率限制，不是配置错。
   - 等 **30~60 分钟**再试，期间不要再触发（每多试一次都会延长冷却）。
   - 如果隔天还是 429：很可能是 **GitHub 机器的共享出口 IP 被领星限流**，重试解决不了。
     这时要把"谁在跑同步"换成**出口 IP 固定且干净**的地方（自己的云服务器 / 自建 runner）；
     数据库和前端都不用改。
3. **如果连通性测试通过、但同步失败**：看日志里具体是哪一步（取店铺 / 订单利润 / 产品表现），
   错误信息通常带 `code=` 和中文原因。
4. **如果同步成功但库里没数据**：检查 `SUPABASE_URL` / `SUPABASE_SECRET_KEY`，
   以及 Supabase 是否执行过 `db/schema.sql`。

## 常见问题

| 现象 | 处理 |
| --- | --- |
| Actions 提示缺少密钥 | 检查 GitHub Secrets 的三个名称是否完全一致。 |
| Supabase 返回 401/403 | 检查是否用服务端 secret key，并重新运行 `db/schema.sql`。 |
| 看板显示“云端访问密码不正确” | 输入 Vercel 的 `DASHBOARD_READ_TOKEN`，不是领星密钥。 |
| 看板只有本地数据 | 确认 Vercel 已重新部署，`VITE_CLOUD_SYNC_ENABLED=true`，且首次同步已完成。 |
| 领星接口限速或查询失败 | 在 Actions 中用 `days=1` 重试；完整校验不过时不会覆盖该天数据。 |
| 报错 `code=429 认证请求过于频繁` | 见上面「同步失败时按这个顺序查」。现在鉴权被限流会**立即失败并提示等待**（不再反复重试烧配额），业务调用被限流才自动退避。 |

## 部署记录

- **2026-10-22**：Vercel 生产环境补齐 4 个变量（`VITE_CLOUD_SYNC_ENABLED` / `SUPABASE_SECRET_KEY` /
  `DASHBOARD_READ_TOKEN` / `DASHBOARD_ADMIN_TOKEN`），随后需要重新部署让**构建期**变量生效。
- 部署方式（两种都行）：
  1. Vercel → 项目 → **Deployments** → 列表里最新一条 → 右侧 `⋯` → **Redeploy** → 再点一次确认；
  2. 往 `main` 推任意一次提交，Vercel 会自动重新构建（本次就是用这种方式触发的）。
- 部署完验证：`GET /api/freshness` 带上 `Authorization: Bearer <DASHBOARD_READ_TOKEN>`，
  应返回 `latest_date` 与 `latestRun`；不带令牌应返回 401。

