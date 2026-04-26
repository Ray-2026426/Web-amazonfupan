
export type UploadSlotKey = 'monthly' | 'weekly' | 'target' | 'inventory' | 'refund' | 'review';

export type UploadSlots = Record<UploadSlotKey, File | null>;

export const UPLOAD_SLOT_LABELS: Record<UploadSlotKey, string> = {
    monthly: '月度业绩表',
    weekly: '周度业绩表',
    target: '全年目标表',
    inventory: 'FBA 库存表',
    refund: '退货报告',
    review: '评论报告',
};

/**
 * 按文件名识别表类型。顺序很重要：退货须早于裸「fba」，周度须早于泛「业绩/销售」。
 */
export function classifyUploadFileName(fileName: string): UploadSlotKey | null {
    const raw = fileName.trim();
    const s = raw.toLowerCase();
    const base = raw.replace(/\.(xlsx|xls|csv)$/i, '');

    const hit = (re: RegExp) => re.test(raw) || re.test(base) || re.test(s);

    // 1. 退货 / 退款（含亚马逊常见命名，且优先于含 FBA 的其它文件）
    if (
        hit(
            /退货|退款|换货|赔偿|移除订单|removal|reimbursement|concession|customer\s*return|seller\s*flex|fba[\s._-]*(customer\s*)?returns?|returns?[\s._-]*(report|detail|order|订单)|return\s*report|退款报告|退货报告/i
        )
    ) {
        return 'refund';
    }

    // 2. 评论（含文件名中带 review，排除 preview；下划线连接也能命中）
    if (
        hit(
            /评论|买家之声|买家评论|评价反馈|评论表|\bvoc\b|feedback|\breviews?\b|review[\s._-]?(report|export|数据|明细|列表)|(^|[^a-z])reviews?([^a-z]|$)|(?<!pre)review/i
        )
    ) {
        return 'review';
    }

    // 3. 周度 / 周维度（避免依赖 \b 匹配中文「周」）
    if (
        hit(
            /周度|周报|周维度|周业绩|年周|按周|周序列|周明细|周销售|周数据|weekly|week[\s._-]?(report|data|sales|perf|业绩)|\d{4}[-_\/]?\s*w\s*\d{1,2}/i
        )
    ) {
        return 'weekly';
    }

    // 4. 目标（长短语优先；再匹配文件名中含「目标」或 target/kpi/goal）
    if (hit(/全年目标|销售目标|业绩目标|指标表|目标表|目标数据|目标|target|kpi|goal/i)) {
        return 'target';
    }

    // 5. 库存 / 库龄（强特征优先；裸 fba 放后）
    if (hit(/库龄|aged|inventory[\s._-]?(report|detail|aging)|仓储(报表|快照)|fba[\s._-]*(盘|库|库存|仓)|库存(报表|明细|快照)/i)) {
        return 'inventory';
    }

    // 6. 月度
    if (hit(/月度|月报|月业绩|monthly|month[\s._-]?(report|data|perf|业绩)|业绩月报|销售月报/i)) {
        return 'monthly';
    }

    // 7. 泛化：更像业绩主表
    if (hit(/业绩|performance|sales|销售报表|p&l|pl[\s._-]?报表|损益/i)) {
        return 'monthly';
    }

    // 8. 仅含 fba 且无退货语义时归为库存
    if (hit(/\bfba\b/i)) {
        return 'inventory';
    }

    return null;
}

export function assignFilesToSlots(files: File[]): { slots: UploadSlots; unrecognized: File[] } {
    const slots: UploadSlots = {
        monthly: null,
        weekly: null,
        target: null,
        inventory: null,
        refund: null,
        review: null,
    };
    const unrecognized: File[] = [];
    for (const file of files) {
        const cat = classifyUploadFileName(file.name);
        if (!cat) {
            unrecognized.push(file);
            continue;
        }
        slots[cat] = file;
    }
    return { slots, unrecognized };
}

export function listMissingOptionalSlots(slots: UploadSlots): string[] {
    const optional: UploadSlotKey[] = ['weekly', 'target', 'inventory', 'refund', 'review'];
    return optional.filter(k => !slots[k]).map(k => UPLOAD_SLOT_LABELS[k]);
}
