# 领星数据自动更新：照着做

目标：电脑关机后，云端仍每天从领星拉取数据。看板打开后自动读取最新业绩，无需每天下载、上传 Excel。

## 你要做的事（只需配置一次）

1. **准备领星 MCP 密钥。** 在领星开放平台启用 MCP，生成可读取店铺、产品表现、订单利润的 `X-Mcp-Key`。密钥只填在 GitHub Secret 中，不要发到聊天里。[领星官方说明](https://www.lingxing.com/help/article/mcp)
2. **创建 Supabase 项目。** 在 [Supabase](https://supabase.com/) 新建项目，进入 SQL Editor，把 [db/schema.sql](db/schema.sql) 全文运行一次。以后若更新本仓库数据库结构，也重新运行这份脚本。到项目的 API Keys 页面复制 Project URL 和服务端用的 **secret key**（通常以 `sb_secret_` 开头）。不要使用浏览器公开的 publishable key。
3. **给 GitHub 仓库配置三个 Secrets。** 在仓库 Settings → Secrets and variables → Actions → New repository secret 中填写：

   | 名称 | 填入的值 |
   | --- | --- |
   | `LINGXING_MCP_KEY` | 第 1 步的领星密钥 |
   | `SUPABASE_URL` | 第 2 步的 Project URL |
   | `SUPABASE_SECRET_KEY` | 第 2 步的 Supabase secret key |

4. **给 Vercel 项目配置五个环境变量。** 在 Vercel Project → Settings → Environment Variables 中填写：

   | 名称 | 填入的值 |
   | --- | --- |
   | `VITE_CLOUD_SYNC_ENABLED` | `true` |
   | `SUPABASE_URL` | 同一个 Supabase Project URL |
   | `SUPABASE_SECRET_KEY` | 同一个 Supabase secret key |
   | `DASHBOARD_READ_TOKEN` | 自己生成的一串至少 24 位随机字符，作为看板只读密码 |
   | `DASHBOARD_ADMIN_TOKEN` | 另一串不同的至少 24 位随机字符，作为数据管理密码 |

   保存后重新部署 Vercel 项目。`SUPABASE_SECRET_KEY`、`DASHBOARD_READ_TOKEN`、`DASHBOARD_ADMIN_TOKEN` **不要**添加 `VITE_` 前缀；它们只在服务端使用。看板上的“连接云端数据”输入只读密码，不输入领星或 Supabase 密钥。
   看板上的“数据管理”使用单独的 `DASHBOARD_ADMIN_TOKEN`。管理后台可查看同步记录与日明细、修改成本匹配及产品字段规则、暂停每日同步、调整每天回补 1–14 天。修改匹配规则后，下一次同步才会重算；更早的日期要到 GitHub Actions 手动指定 `from` / `to` 回补。
   如果领星同步使用的不是默认 `USD`，GitHub Variables 和 Vercel 环境变量都要设置相同的 `LINGXING_CURRENCY`（例如 `CNY`）。
5. **第一次补历史数据。** GitHub 仓库 → Actions →「领星数据自动同步」→ Run workflow。先输入 `days=3`，确认成功后分段补历史数据。每次建议 7–30 天，避免一次运行超过 GitHub Actions 的 120 分钟限制。`from` 和 `to` 都填写时按指定日期执行。完成后打开看板，输入只读密码。

## 我已经做好的部分

- GitHub Actions 每天北京时间约 08:10 运行，拉最近 3 天，覆盖领星延迟回填的数据；逐店限速和分页校验。
- Supabase 保存日明细；同一天的数据在数据库事务内整体替换，失败时保留旧数据。
- Vercel 的 `/api/data` 和 `/api/freshness` 只在服务端读 Supabase；看板按所选日期拉取本期、上期和去年同期数据，每 15 分钟刷新一次，显示数据截至日。
- 看板保留原有 Excel 导入。**目前自动更新的是 ASIN 业绩、流量、广告和成本。** 目标、库存、退货、评论和图片仍沿用本地导入。

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

用你原来同日期、同币种、同店铺范围的 Excel 核对销售额、毛利和广告花费。离线样本中 2026-09-17 的 81 个店铺查询通过了接口汇总校验，但毛利约 51% 的行是负数；上线前需要用你的真实报表确认成本口径。

## 如何知道是否正常

- 看板顶部显示“云端业绩数据截至 YYYY-MM-DD”。同步失败时，会显示失败状态并保留数据库内上一次成功的数据。
- GitHub Actions 的这次运行日志显示“Supabase 上传完成”；失败时工作流尝试创建 GitHub Issue。
- 定时任务由 GitHub 执行，电脑关机不影响。GitHub 官方说明定时任务可能延迟或偶发跳过，公开仓库连续 60 天无活动还可能自动停用；如果以后需要严格保证每天准点更新，应迁移到专用云端调度器。[GitHub 官方说明](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule)

## 常见问题

| 现象 | 处理 |
| --- | --- |
| Actions 提示缺少密钥 | 检查 GitHub Secrets 的三个名称是否完全一致。 |
| Supabase 返回 401/403 | 检查是否用服务端 secret key，并重新运行 `db/schema.sql`。 |
| 看板显示“云端访问密码不正确” | 输入 Vercel 的 `DASHBOARD_READ_TOKEN`，不是领星密钥。 |
| 看板只有本地数据 | 确认 Vercel 已重新部署，`VITE_CLOUD_SYNC_ENABLED=true`，且首次同步已完成。 |
| 领星接口限速或查询失败 | 在 Actions 中用 `days=1` 重试；完整校验不过时不会覆盖该天数据。 |
