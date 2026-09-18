/**
 * 子表显示项设置（localStorage 持久化）。
 *
 * 背景：子表（P&L 业绩 / 流量与广告）每个单元格会在「本期数值」下方再叠三行小字：
 * 环比、同比、目标。这是复盘时最需要的信息，但对数据密集的子表来说，这三行会把
 * 行高撑得很高，有时用户只想干净地看「本期到底是多少」。
 *
 * 所以提供一个总开关，**默认显示**（即完全不改变原有行为）；关掉后：
 *   · 屏幕表格每格只剩本期数值
 *   · 「复制 / 导出 Excel」同步跟随，所见即所得
 *     （避免出现「屏幕上看不到、粘贴出来又冒出来」的困惑）
 */

export type SubtableDisplaySettings = {
    /** 是否显示单元格下方的「环比 / 同比 / 目标」附注 */
    showCompare: boolean;
};

export const SUBTABLE_DISPLAY_DEFAULTS: SubtableDisplaySettings = {
    showCompare: true,
};

const STORAGE_KEY = 'subtable_display_v1';

export function loadSubtableDisplaySettings(): SubtableDisplaySettings {
    if (typeof window === 'undefined') return { ...SUBTABLE_DISPLAY_DEFAULTS };
    try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (!raw) return { ...SUBTABLE_DISPLAY_DEFAULTS };
        const parsed = JSON.parse(raw) as Partial<SubtableDisplaySettings>;
        // 只有明确存成 false 才关闭；字段缺失或脏数据一律回落到默认「显示」
        return { showCompare: parsed.showCompare !== false };
    } catch {
        return { ...SUBTABLE_DISPLAY_DEFAULTS };
    }
}

export function saveSubtableDisplaySettings(s: SubtableDisplaySettings): void {
    if (typeof window === 'undefined') return;
    try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
    } catch {}
}
