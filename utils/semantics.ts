/**
 * 语义色 token —— 全站唯一来源（对应优化清单 P0#1）
 *
 * 背景：此前 emerald / amber / rose / sky 同时承载四种含义——
 *   · 总览卡：达标 / 落后 / 预算超支
 *   · 表格环比同比：上涨 / 下跌
 *   · 异常雷达：严重 / 预警 / 观察
 *   · 动作状态：待处理 / 处理中 / 已完成
 * 用户看到「红色」无法判断到底是「环比跌了」「超支了」还是「严重异常」。
 *
 * 解决：把颜色收敛为四套彼此独立的语义维度，并在**形态**上区分：
 *   · 涨跌  → 小箭头 + 带符号数值（无边框胶囊）
 *   · 达成  → 描边圆环 + 进度条 + 百分比
 *   · 严重度 → 实心圆点 + 带边框标签
 *   · 状态  → 带边框标签（流程态，不用红绿表达好坏）
 *
 * 注意：色值仍复用现有 Tailwind 调色板，因此 dark-theme.css 的覆盖规则继续生效，
 * 不需要额外维护暗色映射。
 */

export type ToneClasses = {
  /** 纯文字色 */
  text: string;
  /** 透明底 + 边框胶囊（用于标签） */
  chip: string;
  /** 卡片外描边 */
  ring: string;
  /** 进度条渐变 */
  bar: string;
  /** 卡片内光晕 */
  glow: string;
  /** 状态圆点背景 */
  dot: string;
};

const tone = (
  text: string,
  chip: string,
  ring: string,
  bar: string,
  glow: string,
  dot: string,
): ToneClasses => ({ text, chip, ring, bar, glow, dot });

export type TrendKey = 'up' | 'down' | 'flat';

/** 涨跌（环比 / 同比）：只表达方向，不表达严重度 */
export const TREND_TONE: Record<TrendKey, ToneClasses> = {
  up: tone(
    'text-emerald-600',
    'bg-emerald-500/10 text-emerald-700',
    'ring-emerald-200/80',
    'from-emerald-500 to-teal-400',
    'from-emerald-500/12 via-teal-400/10 to-transparent',
    'bg-emerald-500',
  ),
  down: tone(
    'text-rose-600',
    'bg-rose-500/10 text-rose-700',
    'ring-rose-200/80',
    'from-rose-500 to-red-400',
    'from-rose-500/12 via-red-400/10 to-transparent',
    'bg-rose-500',
  ),
  flat: tone(
    'text-slate-500',
    'bg-slate-100 text-slate-600',
    'ring-slate-200/80',
    'from-slate-400 to-slate-300',
    'from-slate-400/10 to-transparent',
    'bg-slate-400',
  ),
};

export type AchievementKey = 'achieved' | 'onTrack' | 'behind' | 'overBudget' | 'noTarget';

/** 目标达成（序时 / 距离目标）：表达「离目标多远」 */
export const ACHIEVEMENT_TONE: Record<AchievementKey, ToneClasses> = {
  achieved: tone(
    'text-emerald-700',
    'bg-emerald-500/10 text-emerald-700 border-emerald-200/80',
    'ring-emerald-200/80',
    'from-emerald-500 to-teal-400',
    'from-emerald-500/12 via-teal-400/10 to-transparent',
    'bg-emerald-500',
  ),
  onTrack: tone(
    'text-sky-700',
    'bg-sky-500/10 text-sky-700 border-sky-200/80',
    'ring-sky-200/80',
    'from-sky-500 to-cyan-400',
    'from-sky-500/12 via-cyan-400/10 to-transparent',
    'bg-sky-500',
  ),
  behind: tone(
    'text-amber-700',
    'bg-amber-500/10 text-amber-700 border-amber-200/80',
    'ring-amber-200/80',
    'from-amber-500 to-orange-400',
    'from-amber-500/12 via-orange-400/10 to-transparent',
    'bg-amber-500',
  ),
  overBudget: tone(
    'text-rose-700',
    'bg-rose-500/10 text-rose-700 border-rose-200/80',
    'ring-rose-200/80',
    'from-rose-500 to-red-400',
    'from-rose-500/12 via-red-400/10 to-transparent',
    'bg-rose-500',
  ),
  noTarget: tone(
    'text-slate-500',
    'bg-slate-100 text-slate-600 border-slate-200',
    'ring-slate-200/80',
    'from-slate-400 to-slate-300',
    'from-slate-400/10 to-transparent',
    'bg-slate-400',
  ),
};

/** 达成率 → 语义键。inverse=true 表示「越低越好」（如广告预算消耗） */
export function achievementForRatio(ratio: number, inverse = false): AchievementKey {
  if (!Number.isFinite(ratio)) return 'noTarget';
  if (inverse) {
    if (ratio > 1) return 'overBudget';
    if (ratio > 0.9) return 'behind';
    return 'onTrack';
  }
  if (ratio >= 1) return 'achieved';
  if (ratio >= 0.75) return 'onTrack';
  return 'behind';
}

/** 「实际 vs 目标」→ 语义键（用于率类指标的距离判断） */
export function achievementForGap(actual: number, target: number): AchievementKey {
  if (!target) return 'noTarget';
  if (actual >= target) return 'achieved';
  if (actual / target >= 0.9) return 'onTrack';
  return 'behind';
}

export type SeverityKey = 'critical' | 'warning' | 'info';

/** 异常严重度：表达「多紧急」，与涨跌无关 */
export const SEVERITY_TONE: Record<SeverityKey, ToneClasses> = {
  critical: tone(
    'text-rose-700',
    'border-rose-200 bg-rose-50 text-rose-700',
    'ring-rose-200/80',
    'from-rose-500 to-red-400',
    'from-rose-500/12 via-red-400/10 to-transparent',
    'bg-rose-500',
  ),
  warning: tone(
    'text-amber-700',
    'border-amber-200 bg-amber-50 text-amber-700',
    'ring-amber-200/80',
    'from-amber-500 to-orange-400',
    'from-amber-500/12 via-orange-400/10 to-transparent',
    'bg-amber-500',
  ),
  info: tone(
    'text-sky-700',
    'border-sky-200 bg-sky-50 text-sky-700',
    'ring-sky-200/80',
    'from-sky-500 to-cyan-400',
    'from-sky-500/12 via-cyan-400/10 to-transparent',
    'bg-sky-500',
  ),
};

export type ActionStatusKey = 'open' | 'doing' | 'done' | 'ignored';

/** 动作流程状态：不用红绿表达业务好坏，仅表达流程阶段 */
export const ACTION_STATUS_TONE: Record<ActionStatusKey, string> = {
  open: 'bg-amber-50 text-amber-700 border-amber-200',
  doing: 'bg-sky-50 text-sky-700 border-sky-200',
  done: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  ignored: 'bg-slate-100 text-slate-500 border-slate-200',
};

/** 涨跌方向与符号（供 delta chip 复用） */
export function trendKeyOf(delta: number): TrendKey {
  if (delta > 0) return 'up';
  if (delta < 0) return 'down';
  return 'flat';
}
