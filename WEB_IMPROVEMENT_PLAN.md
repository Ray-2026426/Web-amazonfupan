# 亚马逊业绩复盘 Web —— 改进计划（2026-10-15 核查版）

> **与已有文档的关系**：`APP_OPTIMIZATION_PLAN.md`（8/30，工程质量与体验路线图）、`WEB_STRATEGY.md`（9/18，产品战略三条主线）、`MCP_AUTO_SYNC_DESIGN.md`（9/19，领星自动同步设计）三份文档方向都成立，本文件不重复它们的论证，只做三件事：
> 1. 把**今天真实的状态**（本次逐项实测）记下来；
> 2. 补上三份文档都**没有覆盖的一件事：交付链路本身是断的**；
> 3. 把三份文档收敛成一份**可排期、可验收**的顺序表。
>
> 本文所有数字与结论均为本次实测，不是估计。核查时间：2026-10-15。

---

## 0. 今天的事实基线

| # | 项目 | 实测结论 | 证据 |
|---|---|---|---|
| 1 | 线上站点 | **存活**，`https://web-amazonfupan.vercel.app` HTTP 200 | 直接请求返回 200 |
| 2 | 代码仓库 | `Ray-2026426/Web-amazonfupan`（public，描述「亚马逊业绩复盘」），HEAD = `f8d401c`（2026-09-19 18:28 北京时间） | GitHub API |
| 3 | 本地 ↔ 远端 | 纳入比对 65 个文件：**33 个字节级一致、31 个仅 CRLF/LF 差异、0 个真实内容差异**，无未推送改动 | 按 git blob SHA-1 + 换行符归一化逐文件比对 |
| 4 | 同步方式 | 本地**不是 git 仓库**（无 `.git`），机器上**没有 git.exe**；推送靠 `scripts/push-to-github.mjs`（需 `GITHUB_TOKEN` 或 `.github-token`，**当前两者都不存在**） | `Test-Path`、`Get-Command git` |
| 5 | Vercel | **已连 GitHub 自动部署**：提交 `f8d401c` 上有 `context: Vercel / Deployment has completed` 状态 | GitHub Commit Status API |
| 6 | 本地构建 | **坏的**：`vite build` 失败——`node_modules/@esbuild/win32-x64/` 里只有 `package.json` 和 `README.md`，**缺 `esbuild.exe`** | 实际执行构建 + 目录清单 |
| 7 | 类型检查 | **不通过**：`tsc --noEmit` 报 `dataLoader.ts(419,30) TS2352`（`imageId: string` 断言成 `number`） | 实际执行 tsc |
| 8 | 本机 Node | 无系统 node/npm；harness 自带 `node v24.21.0`（**无 npm**，有 `pnpm.mjs`） | `where node`、运行时目录清单 |
| 9 | `dist/` | **2026-09-05 的旧产物**，比源码旧 6 周，且被 `.gitignore` 排除 → 线上产物由 Vercel 现场构建，**这个目录与线上无关** | 文件时间戳 |
| 10 | 生产外部依赖 | `index.html` 仍加载 `cdn.tailwindcss.com` + Google Fonts + 指向 `esm.sh` 的 import map；本机实测三者均可达（CDN 响应 2.9s） | 源码 + 实网请求 |
| 11 | 密钥 | `vite.config.ts` 仍用 `define` 把 `GEMINI_API_KEY` 内联进前端包，`dist/assets/index-DgpThuqq.js` 里**确实**能搜到 `PLACEHOLDER_API_KEY` → 当前是占位值，**尚未真泄漏**；AI Key 存 `localStorage`；生产环境直连第三方 API（dev 才走 Vite 代理） | `vite.config.ts`、`components/aiApiConfig.ts`、包内搜索 |
| 12 | 导入链路 | `App.tsx:254` **先 `await clearDB()`**，随后 8 个 `saveToDB(...)` **全部不 await**；`db.ts` 的 `saveToDB`/`clearDB` 用 `catch` 吞掉异常 | 源码 |
| 13 | 工程门禁 | 无 `test`/`lint`/`typecheck` 脚本，无 `.github/` CI；依赖 `idb` 已不再使用（`db.ts` 已改原生 IndexedDB） | `package.json`、文件树 |

**一句话总结**：功能层很完整，**线上也是活的**；但「改一行代码 → 稳定上线」这条路目前要手动、且本地还构建不了；数据层最大的风险（先清空再导入、写库失败静默）仍在。

---

## 1. 「我改动它会自动同步到 GitHub 和 Vercel 吗？」

**不会自动同步到 GitHub；会自动部署到 Vercel。** 要分两段看：

```
你改代码
   │
   ├─ ① 本地 → GitHub：❌ 不自动
   │     本地没有 .git（不是 git 仓库）、机器没装 git，
   │     只能手动跑 scripts/push-to-github.mjs，而且需要 Token（现在没有）
   │
   └─ ② GitHub → Vercel：✅ 自动
         Vercel 已连这个仓库，任何推送到 main 的提交都会自动构建 + 部署
         （提交状态里能查到 "Vercel: Deployment has completed"）
```

也就是说：**①不会自己发生，②会发生。** 所以现在的实际情况是「你改完本地代码，线上不会有任何变化，除非你手动推一次」。

### 三种让 ① 也顺起来的做法

| 方案 | 做法 | 优点 | 缺点 |
|---|---|---|---|
| **A. 装 Git for Windows（建议）** | 装 git → `git init` + `git remote add origin https://github.com/Ray-2026426/Web-amazonfupan.git` → 之后 `git add/commit/push`；**同时必须先加 `.gitattributes`（`* text=auto eol=lf`）**，否则那 31 个 CRLF 文件会在首次提交时变成「每行都改」的噪音 diff | 标准流程、有历史、可回滚、可开分支和 PR、Vercel 自动部署立即生效 | 要装一个软件（一次性） |
| **B. 继续用自研推送脚本** | `node scripts/push-to-github.mjs --repo Ray-2026426/Web-amazonfupan --branch main --apply`，Token 从 `GITHUB_TOKEN` 或 `--token-file .github-token` 读入；脚本自带密钥扫描 + 换行符归一化 + `base_tree` 保护远端独有文件，默认 dry-run | 零安装，脚本已写好且考虑周到 | 每次手动、无本地历史、无分支/合并能力、Token 要自己保管 |
| **C. GitHub 网页上传** | 网页拖文件 | 无需工具 | 只适合改 1–2 个文件，容易漏文件 |

> 脚本的 dry-run（**不加 `--apply`**）会列出「新增/修改/未变/远端独有」，是每次推送前的安全网，建议保留这个习惯。

---

## 2. 优先级原则

现有两份文档的排序（数据不丢 → 安全 → 屏幕可用 → 闭环 → 性能）我完全同意，但今天多了一条**排在最前面**的现实：

> **如果代码推不上去、本地还构建不了，那后面所有改进都无法安全上线。**

所以顺序调整为：

```
L0 交付链路（能改、能验、能上、能回滚）     ← 今天新增，1–2 天
L1 数据可信（导入不丢数据、写库不静默失败） ← 当前最大业务风险，1–2 周
L2 安全（Key 不进前端包、数据出境可控）     ← 上膛的枪，先拆引信
L3 口径唯一（指标语义层）                   ← 决定「运营和财务能不能对上账」
L4 决策闭环（问题找人 + 效果回填）          ← 决定「用户凭什么每天打开」
L5 自动化接入（领星 MCP sidecar）           ← 决定天花板，但要先定部署形态
L6 性能 / 响应式 / 代码拆分                 ← 按需，最后做
```

---

## 3. Phase 0：止血 —— 让改动能安全上线（1–2 天）

| ID | 现状 | 做法 | 验收 | 量 |
|---|---|---|---|---|
| **E0-1** | `vite build` 失败：`node_modules/@esbuild/win32-x64` 缺 `esbuild.exe` | 重装依赖：`pnpm install --force`（本机无 npm，可用 pnpm 或 `node` 直跑）；仍失败就删掉 `node_modules/@esbuild` 再装 | `vite build` 成功产出 `dist/`，`vite preview` 能打开 | 0.5d |
| **E0-2** | `tsc --noEmit` 报 `dataLoader.ts(419,30) TS2352` | 修这个类型错误（`imageId` 实际是 string，改 `types.ts` 里 `ParsedImageRow.imageId` 的类型或改断言）；顺带加 `"typecheck": "tsc --noEmit"` 脚本 | `tsc --noEmit` 0 错误；`pnpm run typecheck` 可跑 | 0.5d |
| **E0-3** | 本地不是 git 仓库、没装 git → 每次推送靠手动脚本 | 按第 1 节方案 A 恢复标准 git：`git init`、加 `origin`、**先加 `.gitattributes`（`* text=auto eol=lf`）** 再首次提交，避免 31 个 CRLF 文件的噪音 diff | `git push` 成功；GitHub 上出现一次干净提交；Vercel 自动触发部署并成功 | 0.5d |
| **E0-4** | 无 CI；两个现成校验脚本（`verify-dark-theme.mjs`、`verify-subtable-display.mjs`）只有人记得才跑 | 加 `.github/workflows/ci.yml`：install → `typecheck` → `build` → 两个校验脚本；Vercel 侧保持默认 | 推送后 Actions 全绿；故意改坏一处能红 | 0.5d |
| **E0-5** | `vite.config.ts` 用 `define` 把 `GEMINI_API_KEY` 原样内联进前端包（`dist` 里已能搜到占位值）→ 一旦有人填真 key 再构建，等于把 key 发给每个访问者 | 删掉 `define` 里的两个 key 注入；`components/aiApiConfig.ts` 的 `getEffectiveGeminiKey` 相应去掉 env 兜底；AI Key 只保留「用户自己在设置里填、存本地」这一条路 | `dist/assets/*.js` 里搜不到任何 key；`.env.local` 不再参与前端构建 | 0.5d |
| **E0-6** | 生产仍依赖 `cdn.tailwindcss.com` + Google Fonts + `esm.sh` import map（实测可达，但 CDN 2.9s、且是单点故障；内网/弱网/被墙即白页） | 改为构建期 Tailwind（或把实际用到的工具类固化进 CSS）、字体改自托管或系统字体栈、删掉 import map；**同步调整 `scripts/gen-dark-theme.mjs`**，把现在 200+ 条 `!important` 覆盖规则整体消掉 | 断网启动仍能完整渲染；`index.html` 与 `dist/index.html` 里不再有外部 CDN 引用；`!important` 数量大幅下降 | 1–1.5d |

**Phase 0 出口条件**：`git push` → CI 绿 → Vercel 自动部署成功；本地 `build`/`typecheck` 都能跑；前端包里没有 Key；断网可用。

---

## 4. Phase 1：数据可信（1–2 周，当前最大业务风险）

现状证据（本次实测）：`App.tsx:254` 先 `await clearDB()`，之后 8 处 `saveToDB()` **不 await**，而 `db.ts` 又把异常全部 `catch` 掉 → **导入中途任何一步失败，都可能留下一半数据或空库，而界面显示成功**。

| ID | 任务 | 验收 |
|---|---|---|
| **D1-1** | 导入改为「解析 → 校验 → 预览 → 单事务提交」：全部文件先在内存/临时区解析完，校验通过后再一次性写入正式 store | 任一文件解析失败时，旧数据、旧筛选、旧动作 **100% 不变** |
| **D1-2** | `saveToDB` / `clearDB` 不再吞异常，统一返回成功/失败；调用处全部 `await`；提交按钮显示阶段与耗时；失败可见、可重试 | 制造一次写库失败（如配额超限），界面明确报错，且数据可回到导入前状态 |
| **D1-3** | 上传强校验：槽位完整性（该传的 8 类报表缺哪个直接挡住并说清）、表头识别、日期覆盖、重复行、金额/比例范围、跨表关联率 | 缺表 / 错表头 / 空文件 / 重复行均被拦下并给出可定位的原因 |
| **D1-4** | 保留最近一次可用快照 + 「撤销本次导入」；IndexedDB 版本迁移路径明确 | 导入后可一键回退到上一版数据 |
| **D1-5** | 一键全量导出备份 + 恢复引导（服务端落地之前的兜底） | 换电脑 / 清缓存后可完整还原 |

> 备选小改动（成本低、价值高）：**周度模式默认定位到「导入数据中的最近完整周」**，而不是系统当前时间的上周。

---

## 5. Phase 2：口径唯一 + 决策闭环（2–4 周）

### 5.1 指标语义层（决定可信度）

证据（沿用 `WEB_STRATEGY.md` 的实测）：`safeRatio(...)` 有约 25 处、`gross_margin` 相关约 41 处、同一个 `safeRatio(d.ad_spend, d.sales_amount)` 在 `DetailAnalysisModal.tsx` 里字面重复两遍 → 同一个「毛利率」在主表、P&L 子表、导出 Excel、AI 提示词里可能是不同算法。

| ID | 任务 | 验收 |
|---|---|---|
| **M2-1** | 建 `metrics/` 声明式注册表（`id / label / formula / format / definition / owner`），**先只收口「广告占比」一个指标**验证模式 | 该指标在主表、子表、导出、AI 数据块四处同源，改一处全局生效 |
| **M2-2** | 迁移 Top 10 指标（毛利额、毛利率、ACoS、退款率、库龄占比、目标序时等）到注册表，UI 不再自行重复计算 | 口径说明可作为 tooltip 展示；指标对账测试可自动化 |

### 5.2 决策闭环（决定使用频率）

**北极星指标：每周被真实采纳并回填效果的动作数。**

| ID | 任务 | 验收 |
|---|---|---|
| **M2-3** | 效果回填闭环：数据更新后自动识别「待复盘动作」，展示动作创建前后的关键指标与变化幅度，允许填写结论/原因/下一步 | 已完成动作中 ≥80% 有结果回填；能看到「你 3 天前处理的那个 ASIN，毛利恢复了 X」 |
| **M2-4** | 每日早晨一份简报推送到飞书/企微（昨天谁掉了、掉了多少毛利、最可能原因、建议动作，**带一键认领**） | 连续 5 个工作日按时推送成功；有人真的从简报里认领了动作 |
| **M2-5** | 首屏「数据范围上下文」常驻：当前周期、数据截至日、覆盖率、生效筛选、最后更新时间 | 任意页面 5 秒内能确认当前口径与数据新鲜度 |
| **M2-6** | 异常雷达升级为可解释优先队列：预计毛利影响 × 置信度 × 紧急系数排序，附规则版本与证据完整度 | 默认排序不再只看严重度颜色 |

---

## 6. Phase 3：领星自动同步 sidecar（1–2 个月）

设计已在 `MCP_AUTO_SYNC_DESIGN.md` 里做完（CORS 实测、数据量实测、星型模型、幂等 upsert、分层重拉、T-2 默认），这里只补**排期与一个此前未讨论的关键冲突**。

### 6.1 关键冲突：Vercel 放不下这个 sidecar

现在线上是 Vercel 的 Serverless 形态，而设计里的 sidecar 需要「常驻进程 + 本地 SQLite 单文件 + 一次跑 7–9 分钟的抓取任务」——这三件事 Vercel 都不提供（函数有执行时长上限、无持久磁盘）。

所以 Phase 3 开工前必须先选一个形态：

| 选项 | 说明 | 适合 |
|---|---|---|
| **A. 本机 sidecar（设计文档推荐）** | `npm run hub` 跑在 `localhost:8787`，SQLite 落本地磁盘；web 仍然部署在 Vercel，从浏览器访问本机服务 | 单人/小团队自用，敏感数据不出本机，改动最小 |
| **B. 云上托管（VPS / 容器）** | 代码 95% 可复用 A；换成常驻容器 + 对象存储或托管 Postgres | 要多人共享、要「关掉电脑也在同步」 |
| **C. 全 Serverless + 托管 DB** | Vercel Cron + 托管 Postgres（Neon/Supabase）；抓取拆成多个短任务 | 想彻底不运维，但改造量最大、且仍受函数时长限制 |

**建议：先 A，验证「点一下、等 2 分钟、数据自己进来」是否真的每天被用；确定有价值后再搬 B。**

### 6.2 任务

| ID | 任务 | 验收 |
|---|---|---|
| **S3-1** | sidecar 骨架（`localhost:8787`）+ `node:sqlite` 建表（`dim_shop` / `dim_asin` / `fact_daily`，PK `(sid, asin, date)`） | `/api/health` 返回 `{ok, db, lastSyncAt}` |
| **S3-2** | 领星抓取（复用现有 `scripts/lingxing-*.mjs` 逻辑）+ 幂等 upsert + 分层重拉（T-2 默认，T-2~T-4 每天重拉，T-5~T-14 每周） | 重跑同一天行数不增加；稳态约 324 次/天 ≈ 7 分钟 |
| **S3-3** | 上传页新增「从领星同步」Tab：日期范围、进度条、可取消、**数据新鲜度提示**（「09-17 流量未同步 Sessions=0」） | 81 店铺同步有实时进度、可中断、中断不写库 |
| **S3-4** | MCP 设置页（多 MCP 管理 + 测试连接）；**领星 key 只存服务端，前端只回显后 4 位** | localStorage 与前端包里都拿不到 MCP key |
| **S3-5** | AI 调用也收进 sidecar（顺带彻底解决 key 内联、dev/prod 代理不一致、成本不可控） | 前端不再直连任何第三方模型 |

---

## 7. Phase 4：性能与响应式（按需，最后做）

沿用 `APP_OPTIMIZATION_PLAN.md` 的 P2-01 / P2-02 / P2-03，不再重复。只强调两点：

- 优先级靠后是有理由的：`WEB_STRATEGY.md` 已判断「信息密度比好看重要」，而"每次改动都能安全上线"（Phase 0）比首包体积重要得多。
- 现已确认的清理项：依赖 `idb` 已不再使用，可直接删除。

---

## 8. 度量与发布

### 8.1 度量

| 维度 | 指标 | 目标 |
|---|---|---|
| 决策闭环 | 每周被采纳并回填效果的动作数（北极星） | 持续增长 |
| 决策闭环 | 动作效果回填率 | ≥ 80% |
| 数据安全 | 因导入失败导致旧数据变化次数 | **0** |
| 数据正确性 | 金标数据核心指标差异 | **0** |
| 交付 | main 分支 CI 通过率 | 100% |
| 交付 | 从「改完代码」到「线上生效」的中位时长 | < 10 分钟 |
| 性能 | 初始业务 JS gzip | < 300 KB |

### 8.2 发布

- Vercel 每次推送自动部署：**每次上线都可一键回滚到上一个 Deployment**，这是目前最好的安全网，务必用起来。
- 建议流程：`main` 只放可发布代码；改动先在分支上跑 CI → 合并 → 自动部署；数据层改造与视觉重构不要塞进同一个版本。
- 每次发布在提交信息里写清：**口径是否变化、缓存是否需要迁移、是否需要重新导入**。

---

## 9. 需要你拍板的 4 件事

1. **同步方式**：装 Git 走标准流程（建议），还是继续用 `push-to-github.mjs`？若要推送到 GitHub，需要你提供一次 `GITHUB_TOKEN`（细粒度、只给这个仓库的 contents 写权限即可）。
2. **Phase 3 的形态**：本机 sidecar（建议先做）/ 云上容器 / 全 Serverless + 托管 DB？
3. **AI Key 策略**：彻底收进后端代理（建议，同时解决泄漏与成本），还是保留「用户自带 Key」？
4. **SP-API 是否现在开始申请**：审批周期长，属于「今天不做、三个月后卡住」的事。

---

## 10. 明确不做（沿用 `WEB_STRATEGY.md` 第 7 节）

| 不做 | 理由 |
|---|---|
| ❌ 支持 Walmart / TikTok / Shopee 等全平台 | 先把 Amazon 做到「离了它不能干活」 |
| ❌ 手机端复刻宽表 | 移动端只做通知和认领 |
| ❌ 自定义报表设计器 / BI 平台 | 我们做「判断」，不做「画图工具」 |
| ❌ ERP / 进销存 / 财务记账 | 越界 |
| ❌ 账号权限 / 多人后台（现阶段） | 重资产低回报；但**服务端数据落地要做** |
| ❌ 视觉翻新 | 现有 UI 够用，信息密度优先 |
| ❌ 在 Phase 1 完成前继续加新报表 | 不可信的数据底座上再加杠杆 |

---

## 附：本周 10 项 backlog（Phase 0 全量）

1. 修复 `node_modules/@esbuild` 缺失，恢复本地 `vite build`（E0-1）
2. 修 `dataLoader.ts:419` 类型错误 + 加 `typecheck` 脚本（E0-2）
3. 加 `.gitattributes`（`eol=lf`）后 `git init` + 关联远端（E0-3）
4. 加 `.github/workflows/ci.yml`：typecheck + build + 两个校验脚本（E0-4）
5. 删掉 `vite.config.ts` 的 Key 内联（E0-5）
6. 把 `idb` 从依赖里删掉（顺手清理）
7. Tailwind 改构建期 / 字体自托管，删 CDN 与 import map（E0-6）
8. 调整 `gen-dark-theme.mjs`，消掉 200+ 个 `!important`（E0-6 后续）
9. 上传强校验：缺槽位直接挡住（D1-3 最小版）
10. 周度默认定位到「导入数据中的最近完整周」

---

## 附：本报告的复核方法

- **本地 ↔ 远端差异**：对每个文件计算 git blob SHA-1（`sha1("blob <len>\0" + 内容)`），再算一遍把 CRLF 归一成 LF 后的 SHA-1，与 GitHub `git/trees/main?recursive=1` 返回的 blob SHA 逐一比对。归一化后 SHA 相等即「仅换行符差异」。
- **Vercel 是否连接仓库**：读取 `GET /repos/Ray-2026426/Web-amazonfupan/commits/main/status`，提交上存在 `context: "Vercel"`、`description: "Deployment has completed"` 即证明 Git 集成已启用。
- **本地构建状态**：直接执行 `vite build` 与 `tsc --noEmit`（使用 DSH 自带 node v24.21.0）。
