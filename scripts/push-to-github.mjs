/**
 * 不用 git，直接把工作区作为一次 commit 推送到 GitHub（Git Data API）。
 *
 * 为什么不用 git：这台机器上没装 Git，而 Node 的 TLS 是通的，所以直接调 GitHub REST API。
 *
 * 安全性设计（一次性、可审计）：
 *   · 默认只做 dry-run：拉取远端状态、算出「新增/修改/未变」，不写任何东西。
 *   · 推送前做密钥扫描：命中 .env.local 里的实际取值、sk-/AIza/ghp_/github_pat_ 等
 *     模式的文件一律拒绝推送并报错退出。
 *   · 用 base_tree：只在远端树上叠加本次要改的文件，不会删掉仓库里别的文件。
 *   · 远端有、本地没有的文件会被保留；远端与本地同路径但内容不同时会列出警告，
 *     提示可能覆盖远端较新的版本。
 *
 * 用法：
 *   node scripts/push-to-github.mjs --repo <owner/name> [--branch main] [--apply]
 *   Token 从环境变量 GITHUB_TOKEN 读取，或用 --token-file <路径>。
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ROOT } from './scan-palette.mjs';

/* ------------------------------------------------------------------ *
 * 参数
 * ------------------------------------------------------------------ */
function arg(name, fallback = null) {
    const i = process.argv.indexOf(`--${name}`);
    return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const has = (name) => process.argv.includes(`--${name}`);

const repo = arg('repo') || process.env.GITHUB_REPO;
const branch = arg('branch', 'main');
const apply = has('apply');
const message =
    arg('message') ||
    process.env.GITHUB_COMMIT_MESSAGE ||
    'fix(theme): 修复夜间模式 —— 补全工具类覆盖表，消除暗色下的刺眼白块';

function readToken() {
    const tokenFile = arg('token-file');
    if (tokenFile && fs.existsSync(tokenFile)) return fs.readFileSync(tokenFile, 'utf8').trim();
    if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN.trim();
    return null;
}

if (!repo || !/^[^/]+\/[^/]+$/.test(repo)) {
    console.error('用法：node scripts/push-to-github.mjs --repo <owner/name> [--branch main] [--apply]');
    process.exit(2);
}
const token = readToken();
if (!token) {
    console.error('缺少 Token：请设置环境变量 GITHUB_TOKEN，或用 --token-file <路径> 指定文件。');
    process.exit(2);
}
const [owner, name] = repo.split('/');

/* ------------------------------------------------------------------ *
 * 收集文件（忽略规则与 .gitignore 保持一致）
 * ------------------------------------------------------------------ */
const IGNORE_DIRS = new Set(['node_modules', 'dist', 'dist-ssr', '.git', 'logs']);
const IGNORE_FILE_RE = [
    /^\.env($|\.)/i,        // .env / .env.local / .env.*  （里面有 GEMINI_API_KEY）
    /\.local$/i,
    /\.token$/i,
    /^\.github-token$/i,
    /\.log$/i,
    /^\.DS_Store$/i,
    /^Thumbs\.db$/i,
];

function collect(dir, out = []) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        const rel = path.relative(ROOT, full).replace(/\\/g, '/');
        if (entry.isDirectory()) {
            if (IGNORE_DIRS.has(entry.name)) continue;
            if (/^\.chrome-debug/.test(entry.name) || /^\.tmp-/.test(entry.name)) continue;
            if (entry.name === '.vscode' || entry.name === '.idea') continue;
            collect(full, out);
        } else {
            if (IGNORE_FILE_RE.some((re) => re.test(entry.name))) continue;
            out.push({ rel, full });
        }
    }
    return out;
}

const files = collect(ROOT).sort((a, b) => (a.rel < b.rel ? -1 : 1));

for (const f of files) {
    f.buf = fs.readFileSync(f.full);
    // Git blob 的 SHA-1 = sha1("blob <字节数>\0" + 内容)；用它判断文件是否真的变了
    f.sha = crypto.createHash('sha1').update(`blob ${f.buf.length}\0`).update(f.buf).digest('hex');
    // 再算一遍「把 CRLF 归一成 LF」后的哈希。远端仓库是 LF，本地工作区是 CRLF，
    // 这类文件内容其实没变；如果不区分，一次修复会变成「32 个文件每行都改了」的噪音 diff。
    const lf = Buffer.from(f.buf.toString('utf8').replace(/\r\n/g, '\n'), 'utf8');
    f.shaLf = crypto.createHash('sha1').update(`blob ${lf.length}\0`).update(lf).digest('hex');
}

/* ------------------------------------------------------------------ *
 * 密钥扫描（拒绝推送）
 * ------------------------------------------------------------------ */
console.log('密钥扫描…');
const SECRET_PATTERNS = [
    { re: /AIza[0-9A-Za-z_-]{35}/g, what: 'Google API Key' },
    { re: /sk-[A-Za-z0-9]{20,}/g, what: 'OpenAI 风格密钥' },
    { re: /ghp_[A-Za-z0-9]{36}/g, what: 'GitHub Token' },
    { re: /github_pat_[A-Za-z0-9_]{20,}/g, what: 'GitHub 细粒度 Token' },
    { re: /AKIA[0-9A-Z]{16}/g, what: 'AWS Access Key' },
    { re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g, what: '私钥' },
];

// .env.local 里的实际取值也必须全局禁止出现
// （本项目的 .env.local 里是 PLACEHOLDER_API_KEY 这种占位值，会被下面的占位判断过滤掉）
const PLACEHOLDER_RE = /PLACEHOLDER|YOUR[_-]|CHANGEME|CHANGE_ME|EXAMPLE|SAMPLE|DUMMY|FAKE|XXXX|TODO|^<.*>$|^\.\.\.$/i;
const envFile = path.join(ROOT, '.env.local');
const envValues = [];
const envPlaceholders = [];
if (fs.existsSync(envFile)) {
    for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
        const m = line.match(/^[A-Z0-9_]+\s*=\s*(.+)$/);
        if (!m) continue;
        const name = line.split('=')[0].trim();
        const value = m[1].trim();
        if (value.length < 8) continue;
        if (PLACEHOLDER_RE.test(value)) {
            envPlaceholders.push(name);
            continue;
        }
        envValues.push({ name, value });
    }
}

const leaks = [];
for (const f of files) {
    const text = f.buf.toString('utf8');
    for (const p of SECRET_PATTERNS) {
        const hits = text.match(p.re);
        if (hits) leaks.push({ rel: f.rel, what: p.what, sample: `${hits[0].slice(0, 12)}…` });
    }
    for (const ev of envValues) {
        if (text.includes(ev.value)) leaks.push({ rel: f.rel, what: `.env.local 中 ${ev.name} 的实际取值`, sample: '(已隐去)' });
    }
}

if (leaks.length) {
    console.error('\n发现疑似密钥，已中止：');
    for (const l of leaks) console.error(`  ${l.rel}  →  ${l.what}  ${l.sample}`);
    console.error('\n请先移除这些内容（或把它们加入忽略规则）再推送。');
    process.exit(1);
}
console.log(`  ✓ 未发现密钥（检查了 ${files.length} 个文件）`);
if (envValues.length) {
    console.log(`  · 已确认 .env.local 中的 ${envValues.map((e) => e.name).join(', ')} 取值没有出现在任何待推送文件里`);
}
if (envPlaceholders.length) {
    console.log(`  · .env.local 中的 ${envPlaceholders.join(', ')} 是占位值（非真实密钥），已跳过比对`);
}

// --list：只列文件与扫描结果，不联网（可离线复核「哪些文件会被推上去」）
if (has('list')) {
    console.log(`\n待推送文件（${files.length} 个，已按忽略规则排除 node_modules / dist / .env* 等）：`);
    for (const f of files) console.log(`  ${String(f.buf.length).padStart(8)}  ${f.rel}`);
    console.log(`\n共 ${files.length} 个文件，${(files.reduce((s, f) => s + f.buf.length, 0) / 1024).toFixed(1)} KB`);
    console.log('（--list 模式不联网、不写入）');
    process.exit(0);
}

/* ------------------------------------------------------------------ *
 * GitHub API
 * ------------------------------------------------------------------ */
const API = 'https://api.github.com';
async function gh(method, url, body) {
    const res = await fetch(url.startsWith('http') ? url : API + url, {
        method,
        headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
            'User-Agent': 'dsh-push-script',
            ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* 非 JSON 响应 */ }
    if (!res.ok) {
        const detail = json?.message || text.slice(0, 300);
        const err = new Error(`${method} ${url} → ${res.status} ${detail}`);
        err.status = res.status;
        throw err;
    }
    return json;
}

console.log(`\n读取远端仓库 ${owner}/${name} …`);
const info = await gh('GET', `/repos/${owner}/${name}`);
console.log(`  · 权限：${info.permissions ? JSON.stringify(info.permissions) : '未知'}`);
console.log(`  · 默认分支：${info.default_branch}`);

let baseCommitSha = null;
let remoteTree = new Map();
let remoteBranch = branch;

try {
    const ref = await gh('GET', `/repos/${owner}/${name}/git/ref/heads/${branch}`);
    baseCommitSha = ref.object.sha;
    const tree = await gh('GET', `/repos/${owner}/${name}/git/trees/${baseCommitSha}?recursive=1`);
    for (const e of tree.tree || []) {
        if (e.type === 'blob') remoteTree.set(e.path, e.sha);
    }
    console.log(`  · 分支 ${branch} 现有 ${remoteTree.size} 个文件（base commit ${baseCommitSha.slice(0, 7)}）`);
} catch (e) {
    if (e.status === 404 || e.status === 409) {
        // 空仓库：换用默认分支名
        remoteBranch = info.default_branch || branch;
        console.log(`  · 分支 ${branch} 不存在，仓库可能是空的；将使用默认分支 ${remoteBranch} 创建首次提交`);
    } else {
        throw e;
    }
}

/* ------------------------------------------------------------------ *
 * 差异
 * ------------------------------------------------------------------ */
const added = [];
const changed = [];
const unchanged = [];
const eolOnly = [];
for (const f of files) {
    if (!remoteTree.has(f.rel)) added.push(f);
    else if (remoteTree.get(f.rel) === f.sha) unchanged.push(f);
    else if (remoteTree.get(f.rel) === f.shaLf && !has('push-eol-changes')) eolOnly.push(f);
    else changed.push(f);
}
const remoteOnly = [...remoteTree.keys()].filter((p) => !files.some((f) => f.rel === p));

console.log(`\n差异（共 ${files.length} 个本地文件）：`);
console.log(`  新增 ${added.length}，修改 ${changed.length}，未变 ${unchanged.length}`);
if (eolOnly.length) {
    console.log(`  仅换行符差异 ${eolOnly.length}（内容与远端一致，默认跳过，避免整片噪音 diff）`);
    console.log(`    加 --push-eol-changes 可强制一起推`);
}
console.log(`  远端另有 ${remoteOnly.length} 个本地不存在的文件（会被保留）`);

const show = (label, list) => {
    if (!list.length) return;
    console.log(`\n  ${label}:`);
    for (const f of list.slice(0, 60)) console.log(`    ${f.rel}`);
    if (list.length > 60) console.log(`    … 另有 ${list.length - 60} 个`);
};
show('新增', added);
show('修改', changed);
if (remoteOnly.length) {
    console.log('\n  仅远端存在（保留不动）:');
    for (const p of remoteOnly.slice(0, 40)) console.log(`    ${p}`);
    if (remoteOnly.length > 40) console.log(`    … 另有 ${remoteOnly.length - 40} 个`);
}

if (!apply) {
    console.log('\n这是 dry-run，没有写入任何内容。确认无误后加上 --apply 重新执行。');
    process.exit(0);
}

/* ------------------------------------------------------------------ *
 * 推送
 * ------------------------------------------------------------------ */
const toUpload = [...added, ...changed];
console.log(`\n开始推送：${toUpload.length} 个文件需要上传 blob`);

for (let i = 0; i < toUpload.length; i += 1) {
    const f = toUpload[i];
    const blob = await gh('POST', `/repos/${owner}/${name}/git/blobs`, {
        content: f.buf.toString('base64'),
        encoding: 'base64',
    });
    f.blobSha = blob.sha;
    if ((i + 1) % 10 === 0 || i + 1 === toUpload.length) {
        console.log(`  blob ${i + 1}/${toUpload.length}`);
    }
}

const treeEntries = toUpload.map((f) => ({
    path: f.rel,
    mode: '100644',
    type: 'blob',
    sha: f.blobSha,
}));

console.log('创建 tree …');
const newTree = await gh('POST', `/repos/${owner}/${name}/git/trees`, {
    ...(baseCommitSha ? { base_tree: baseCommitSha } : {}),
    tree: treeEntries,
});

console.log('创建 commit …');
const commit = await gh('POST', `/repos/${owner}/${name}/git/commits`, {
    message,
    tree: newTree.sha,
    ...(baseCommitSha ? { parents: [baseCommitSha] } : {}),
});

if (baseCommitSha) {
    console.log(`更新 refs/heads/${branch} …`);
    await gh('PATCH', `/repos/${owner}/${name}/git/refs/heads/${branch}`, { sha: commit.sha });
} else {
    console.log(`创建 refs/heads/${remoteBranch} …`);
    await gh('POST', `/repos/${owner}/${name}/git/refs`, {
        ref: `refs/heads/${remoteBranch}`,
        sha: commit.sha,
    });
}

console.log(`\n推送完成：https://github.com/${owner}/${name}/commit/${commit.sha}`);
