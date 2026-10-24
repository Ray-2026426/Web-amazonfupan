import test from 'node:test';
import assert from 'node:assert/strict';
import { expandRange, normalizeDates, plan } from './sync/plan-chunks.mjs';

test('连续区间按块切分，最后一块收尾', () => {
  assert.deepEqual(plan(expandRange('2026-09-01', '2026-09-30'), 14), [
    { from: '2026-09-01', to: '2026-09-14' },
    { from: '2026-09-15', to: '2026-09-28' },
    { from: '2026-09-29', to: '2026-09-30' },
  ]);
});

test('零散日期各自成块，相邻日期合并', () => {
  const days = normalizeDates(['2026-10-20', '2026-10-02', '2026-10-06', '2026-10-05']).map(item => item.text);
  assert.deepEqual(plan(days, 14), [
    { from: '2026-10-02', to: '2026-10-02' },
    { from: '2026-10-05', to: '2026-10-06' },
    { from: '2026-10-20', to: '2026-10-20' },
  ]);
});

test('单天、重复日期与非法日期', () => {
  assert.deepEqual(plan(normalizeDates(['2026-10-03', '2026-10-03']).map(item => item.text), 14), [
    { from: '2026-10-03', to: '2026-10-03' },
  ]);
  assert.throws(() => expandRange('2026-02-30', '2026-03-01'), /不是有效日期/);
  assert.throws(() => expandRange('2026-03-02', '2026-03-01'), /起始日期晚于结束日期/);
});
