#!/usr/bin/env node
/**
 * 把「要回补的日期」切成 Actions 任务块。
 *
 * 用法：
 *   node scripts/sync/plan-chunks.mjs --from 2026-10-01 --to 2026-10-14 --chunk 14
 *   node scripts/sync/plan-chunks.mjs --dates 2026-10-02,2026-10-05,2026-10-06 --chunk 14
 *
 * 输出：JSON 数组，元素形如 {"from":"2026-10-05","to":"2026-10-06"}
 * 规则：
 *   · --dates 优先；不连续的日期各自成块，连续的合并
 *   · 每块最多 --chunk 天（默认 14）
 *   · 任何非法日期直接报错退出（避免补错区间）
 */

import { pathToFileURL } from 'node:url';

const DAY = 86400000;
const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseDate(text, label) {
  if (!ISO_RE.test(String(text || ''))) throw new Error(`${label} 日期格式应为 YYYY-MM-DD：${text}`);
  const [y, m, d] = text.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) {
    throw new Error(`${label} 不是有效日期：${text}`);
  }
  return date;
}

const iso = (date) => date.toISOString().slice(0, 10);

export function expandRange(fromText, toText) {
  const from = parseDate(fromText, '起始');
  const to = parseDate(toText, '结束');
  if (from > to) throw new Error('起始日期晚于结束日期');
  const days = [];
  for (let t = from.getTime(); t <= to.getTime(); t += DAY) days.push(iso(new Date(t)));
  return days;
}

export function normalizeDates(list) {
  const unique = [...new Set(list)];
  const dates = unique.map((text) => ({ text, time: parseDate(text, '补数').getTime() }));
  dates.sort((a, b) => a.time - b.time);
  return dates;
}

/** 连续的日期合并成一块，每块最多 chunkSize 天 */
export function plan(days, chunkSize) {
  const chunks = [];
  let start = null;
  let prev = null;
  for (const day of days) {
    const time = parseDate(day, '补数').getTime();
    if (start === null) {
      start = day;
    } else if (time - prev !== DAY || (time - parseDate(start, '补数').getTime()) / DAY >= chunkSize) {
      // 断开时，上一块的结束是「上一个选中日」，不是当前日的前一天（零散多选时两者不同）
      chunks.push({ from: start, to: iso(new Date(prev)) });
      start = day;
    }
    prev = time;
  }
  if (start !== null) chunks.push({ from: start, to: iso(new Date(prev)) });
  return chunks;
}

function main(argv) {
  const arg = (name, fallback = null) => {
    const i = argv.indexOf(`--${name}`);
    return i !== -1 && argv[i + 1] ? argv[i + 1] : fallback;
  };
  const chunkSize = Number(arg('chunk', '14'));
  if (!Number.isInteger(chunkSize) || chunkSize < 1 || chunkSize > 31) throw new Error('--chunk 应为 1~31');

  const datesArg = arg('dates', '');
  let days;
  if (datesArg) {
    days = normalizeDates(datesArg.split(',').map((s) => s.trim()).filter(Boolean)).map((item) => item.text);
  } else {
    const from = arg('from', '');
    const to = arg('to', '');
    if (!from || !to) throw new Error('需要 --from/--to，或 --dates');
    days = expandRange(from, to);
  }
  if (!days.length) throw new Error('没有要补的日期');
  if (days.length > 400) throw new Error(`一次最多 400 天（当前 ${days.length}）`);

  process.stdout.write(JSON.stringify(plan(days, chunkSize)));
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  try {
    main(process.argv);
  } catch (error) {
    console.error(String(error.message || error));
    process.exit(1);
  }
}
