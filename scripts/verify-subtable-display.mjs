/**
 * 校验「同环比 / 目标」显示开关的设置层。
 *
 * 关键需求是「默认显示」：用户从没动过设置、或本地存了脏数据时，都必须回落到显示。
 * 这个模块依赖浏览器的 localStorage，而沙箱里跑不了浏览器，所以这里用
 * typescript 的 transpileModule 在进程内把它转成 JS，再用 data: URL 导入，
 * 配一个假的 localStorage 来验证行为。
 *
 * 用法：node scripts/verify-subtable-display.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { ROOT } from './scan-palette.mjs';

let failures = 0;
let checks = 0;
const ok = (name, detail = '') => { checks += 1; console.log(`  \u2713 ${name}${detail ? ` — ${detail}` : ''}`); };
const fail = (name, detail) => { checks += 1; failures += 1; console.log(`  \u2717 ${name}\n      ${detail}`); };

const srcPath = path.join(ROOT, 'components', 'subtableDisplay.ts');
const source = fs.readFileSync(srcPath, 'utf8');

// 进程内转译（不 spawn 子进程，避免沙箱的管道限制）
const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;

/** 用给定的 localStorage 初始内容加载模块，返回模块导出 */
async function loadWith(initialRaw) {
    const store = new Map();
    if (initialRaw !== undefined) store.set('subtable_display_v1', initialRaw);
    globalThis.window = {
        localStorage: {
            getItem: (k) => (store.has(k) ? store.get(k) : null),
            setItem: (k, v) => store.set(k, String(v)),
        },
    };
    const url = 'data:text/javascript;base64,' + Buffer.from(js, 'utf8').toString('base64');
    const mod = await import(url);
    return { mod, store };
}

console.log('子表显示开关校验\n');

console.log('[1/3] 默认值（需求：默认显示）');
{
    const cases = [
        { label: '从未设置过（无存储）', raw: undefined },
        { label: '存储为空对象 {}', raw: '{}' },
        { label: '存储缺字段 {"other":1}', raw: '{"other":1}' },
        { label: '字段为 null', raw: '{"showCompare":null}' },
        { label: '脏数据：字符串 "yes"', raw: '{"showCompare":"yes"}' },
        { label: '脏数据：数字 0', raw: '{"showCompare":0}' },
        { label: '损坏的 JSON', raw: '{not json' },
    ];
    const bad = [];
    for (const c of cases) {
        const { mod } = await loadWith(c.raw);
        const s = mod.loadSubtableDisplaySettings();
        if (s.showCompare !== true) bad.push(`${c.label} → showCompare=${JSON.stringify(s.showCompare)}`);
    }
    if (bad.length === 0) ok('以上 7 种情况全部回落到「显示」', cases.map((c) => c.label).join(' / '));
    else fail('有情况没有回落到「显示」', bad.join('\n      '));
}

console.log('\n[2/3] 关闭后能持久化并读回');
{
    const { mod, store } = await loadWith(undefined);
    mod.saveSubtableDisplaySettings({ showCompare: false });
    const raw = store.get('subtable_display_v1');
    const reloaded = mod.loadSubtableDisplaySettings();
    if (reloaded.showCompare === false) {
        ok('存 false 后读回 false', `localStorage["subtable_display_v1"] = ${raw}`);
    } else {
        fail('存 false 后没有读回 false', `实际 showCompare=${JSON.stringify(reloaded.showCompare)}，raw=${raw}`);
    }

    // 明确存了 false 之后，再重新加载模块也要保持 false（不是每次回落到默认）
    const second = await loadWith(raw);
    if (second.mod.loadSubtableDisplaySettings().showCompare === false) {
        ok('新会话（重新加载模块）仍保持关闭');
    } else {
        fail('新会话丢失了关闭状态', '关掉后重开又变回显示了');
    }

    mod.saveSubtableDisplaySettings({ showCompare: true });
    if (mod.loadSubtableDisplaySettings().showCompare === true) ok('再开回来也正常');
    else fail('无法恢复为显示', '');
}

console.log('\n[3/3] 与子表渲染的接线');
{
    const modal = fs.readFileSync(path.join(ROOT, 'components', 'DetailAnalysisModal.tsx'), 'utf8');

    const need = [
        { what: '导入了设置模块', re: /from '\.\/subtableDisplay'/ },
        { what: 'state 初始值取自持久化设置', re: /useState\(\(\) => loadSubtableDisplaySettings\(\)\.showCompare\)/ },
        { what: '变更后写回持久化', re: /saveSubtableDisplaySettings\(\{ showCompare \}\)/ },
        { what: '屏幕单元格受开关控制', re: /\{!isInventory && showCompare && \(/ },
        { what: '工具栏开关存在且默认显示态可见', re: /role="switch"[\s\S]{0,200}aria-checked=\{showCompare\}/ },
    ];
    const missing = need.filter((n) => !n.re.test(modal));
    if (missing.length === 0) ok('接线完整', need.map((n) => n.what).join('、'));
    else fail('接线缺失', missing.map((n) => n.what).join('、'));

    // 复制 / 导出两条路径也必须跟随开关（用户明确要求「跟随」）
    const guardCount = (modal.match(/if \(!isInventory && showCompare\) \{/g) || []).length;
    if (guardCount === 2) {
        ok('复制 / 导出两条路径都已跟随开关', 'buildCellLinesForCopy、buildCellHtmlForCopy');
    } else {
        fail('复制 / 导出路径未全部跟随', `期望 2 处守卫，实际 ${guardCount} 处`);
    }

    // 库存子表本来就没有同环比/目标，开关不应出现在那里
    const invToggle = /type === 'Inventory' && \([\s\S]{0,400}显示同环比/.test(modal);
    if (!invToggle) ok('库存子表不会出现该开关', '库存表本无同环比/目标');
    else fail('开关错误地出现在库存子表', '');
}

console.log(`\n${failures === 0 ? '全部通过' : '存在失败项'}：${checks - failures}/${checks} 项通过`);
process.exit(failures === 0 ? 0 : 1);
