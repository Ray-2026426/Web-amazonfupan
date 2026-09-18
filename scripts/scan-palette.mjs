/**
 * 扫描源码中实际使用的 Tailwind 调色板工具类（含 hover / focus / even 等变体前缀）。
 *
 * 背景：本项目的暗色模式不依赖 Tailwind 的 dark: 变体，而是在 index.html 里挂上
 * html.dark，再用 CSS 覆盖同名工具类。这种做法要求「覆盖清单」和「源码里真正用到的类」
 * 严格一一对应——手写清单必然漏项（漏掉的浅色底会在暗色下变成刺眼的白块）。
 *
 * 所以这里把「实际用到的类」变成可机器校验的清单，供 gen-dark-theme.mjs 生成样式表，
 * 并供 verify-dark-theme.mjs 做覆盖率断言。
 */
import fs from 'node:fs';
import path from 'node:path';

export const ROOT = path.resolve(import.meta.dirname, '..');

export const HUES = [
    'slate', 'gray', 'zinc', 'neutral', 'stone',
    'red', 'orange', 'amber', 'yellow', 'lime', 'green', 'emerald', 'teal', 'cyan',
    'sky', 'blue', 'indigo', 'violet', 'purple', 'fuchsia', 'pink', 'rose',
];

export const PROPS = [
    'bg', 'text', 'border', 'ring', 'divide', 'from', 'via', 'to',
    'fill', 'stroke', 'shadow', 'outline', 'decoration', 'placeholder', 'accent', 'caret',
];

const UTIL_RE = new RegExp(
    `(?<![\\w:.-])((?:(?:[a-z0-9]+(?:-[a-z0-9]+)*):)*)` +
    `((?:${PROPS.join('|')})-(?:${HUES.join('|')})(?:-\\d{2,3})?(?:\\/\\d{1,3})?)`,
    'g',
);

/** 扫描时跳过的目录 */
const SKIP_DIRS = new Set([
    'node_modules', 'dist', '.git', 'scripts', 'tools',
    '.chrome-debug', '.chrome-debug2', '.chrome-debug3', '.tmp-esbuild', '.tmp-verify',
]);

/** 覆盖清单自身不能参与扫描，否则会把「生成的规则」当成「源码用到的类」 */
const SKIP_FILES = new Set(['index.css', 'dark-theme.css']);

function walk(dir, out = []) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (SKIP_DIRS.has(entry.name)) continue;
            walk(full, out);
        } else if (/\.(tsx?|jsx?|html|css|mjs)$/.test(entry.name)) {
            if (SKIP_FILES.has(entry.name)) continue;
            out.push(full);
        }
    }
    return out;
}

/**
 * @returns {{summary: object, tokens: Array<object>}}
 */
export function scanPalette(root = ROOT) {
    const tokens = new Map();

    for (const file of walk(root)) {
        const rel = path.relative(root, file).replace(/\\/g, '/');
        let text;
        try {
            text = fs.readFileSync(file, 'utf8');
        } catch {
            continue;
        }
        for (const m of text.matchAll(UTIL_RE)) {
            const prefix = m[1] || '';
            const util = m[2];
            const full = prefix + util;

            const body = util.slice(util.indexOf('-') + 1); // hue-shade/opacity
            const [shadePart, opacityPart] = body.split('/');
            const lastDash = shadePart.lastIndexOf('-');

            let hue;
            let shade;
            if (/^\d{2,3}$/.test(shadePart.slice(lastDash + 1))) {
                hue = shadePart.slice(0, lastDash);
                shade = Number(shadePart.slice(lastDash + 1));
            } else {
                hue = shadePart;
                shade = null;
            }

            let rec = tokens.get(full);
            if (!rec) {
                rec = {
                    token: full,
                    prop: util.slice(0, util.indexOf('-')),
                    hue,
                    shade,
                    opacity: opacityPart ? Number(opacityPart) : null,
                    variants: prefix.split(':').filter(Boolean),
                    count: 0,
                    files: new Set(),
                };
                tokens.set(full, rec);
            }
            rec.count += 1;
            rec.files.add(rel);
        }
    }

    const list = [...tokens.values()]
        .map((r) => ({ ...r, files: [...r.files].sort() }))
        .sort((a, b) => (a.token < b.token ? -1 : a.token > b.token ? 1 : 0));

    const variantSet = new Set();
    const byProp = {};
    const byHue = {};
    for (const r of list) {
        for (const v of r.variants) variantSet.add(v);
        byProp[r.prop] = (byProp[r.prop] || 0) + 1;
        byHue[r.hue] = (byHue[r.hue] || 0) + 1;
    }

    return {
        summary: {
            distinctTokens: list.length,
            totalOccurrences: list.reduce((s, r) => s + r.count, 0),
            usedVariants: [...variantSet].sort(),
            byProp,
            byHue,
        },
        tokens: list,
    };
}

/** CSS 类名转义（: 和 / 需要反斜杠转义） */
export function escapeClass(cls) {
    return cls.replace(/[^a-zA-Z0-9_-]/g, (c) => `\\${c}`);
}

if (import.meta.filename === process.argv[1] || process.argv[1]?.endsWith('scan-palette.mjs')) {
    const result = scanPalette();
    const jsonFlag = process.argv.indexOf('--json');
    const payload = JSON.stringify(result, null, 2);
    if (jsonFlag !== -1 && process.argv[jsonFlag + 1]) {
        fs.writeFileSync(process.argv[jsonFlag + 1], payload);
        console.log('written:', process.argv[jsonFlag + 1]);
        console.log(JSON.stringify(result.summary, null, 2));
    } else {
        console.log(payload);
    }
}
