import React, { useMemo, useState } from 'react';
import {
    AlertTriangle,
    ArrowRight,
    BookOpen,
    CalendarClock,
    Check,
    ChevronDown,
    ClipboardList,
    Filter,
    Gauge,
    ListChecks,
    Minimize2,
    UserRound,
} from 'lucide-react';
import { ActionItem, ActionStatus, BusinessIssue, BusinessIssueCategory, BusinessRule } from '../types';

interface BusinessCommandCenterProps {
    issues: BusinessIssue[];
    rules: BusinessRule[];
    actions: ActionItem[];
    onCreateAction: (issue: BusinessIssue) => void;
    onUpdateAction: (actionId: string, patch: Partial<ActionItem>) => void;
    onOpenDetail: (type: 'PL' | 'Traffic' | 'Inventory') => void;
    onOpenRefundAnalysis: () => void;
    onOpenReviewAnalysis: () => void;
    onOpenKeywordAnalysis: () => void;
}

const categoryLabel: Record<BusinessIssueCategory, string> = {
    goal: '目标',
    profit: '利润',
    ads: '广告',
    inventory: '库存',
    quality: '口碑',
    data: '数据',
};

const severityClass = {
    critical: 'border-rose-200 bg-rose-50 text-rose-700',
    warning: 'border-amber-200 bg-amber-50 text-amber-700',
    info: 'border-sky-200 bg-sky-50 text-sky-700',
};

const statusLabel: Record<ActionStatus, string> = {
    open: '待处理',
    doing: '处理中',
    done: '已完成',
    ignored: '暂不处理',
};

const statusClass: Record<ActionStatus, string> = {
    open: 'bg-amber-50 text-amber-700 border-amber-200',
    doing: 'bg-sky-50 text-sky-700 border-sky-200',
    done: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    ignored: 'bg-slate-100 text-slate-500 border-slate-200',
};

const getIssueAction = (actions: ActionItem[], issueId: string) =>
    actions.find(action => action.issueId === issueId && action.status !== 'ignored');

const RADAR_COLLAPSED_KEY = 'business_command_center_collapsed';

const loadInitialCollapsed = () => {
    if (typeof window === 'undefined') return false;
    try {
        return window.localStorage.getItem(RADAR_COLLAPSED_KEY) === '1';
    } catch {
        return false;
    }
};

const saveCollapsed = (collapsed: boolean) => {
    if (typeof window === 'undefined') return;
    try {
        window.localStorage.setItem(RADAR_COLLAPSED_KEY, collapsed ? '1' : '0');
    } catch {}
};

export const BusinessCommandCenter: React.FC<BusinessCommandCenterProps> = ({
    issues,
    rules,
    actions,
    onCreateAction,
    onUpdateAction,
    onOpenDetail,
    onOpenRefundAnalysis,
    onOpenReviewAnalysis,
    onOpenKeywordAnalysis,
}) => {
    const [selectedIssueId, setSelectedIssueId] = useState(issues[0]?.id || '');
    const [rulesOpen, setRulesOpen] = useState(false);
    const [isCollapsed, setIsCollapsed] = useState(loadInitialCollapsed);
    const selectedIssue = useMemo(
        () => issues.find(issue => issue.id === selectedIssueId) || issues[0],
        [issues, selectedIssueId],
    );
    const activeActions = actions.filter(action => action.status !== 'ignored');
    const criticalCount = issues.filter(issue => issue.severity === 'critical').length;
    const warningCount = issues.filter(issue => issue.severity === 'warning').length;

    if (!selectedIssue) return null;

    const linkedAction = getIssueAction(actions, selectedIssue.id);

    const setCollapsed = (collapsed: boolean) => {
        setIsCollapsed(collapsed);
        saveCollapsed(collapsed);
    };

    const openBestDrilldown = () => {
        if (selectedIssue.category === 'ads') onOpenDetail('Traffic');
        else if (selectedIssue.category === 'inventory') onOpenDetail('Inventory');
        else if (selectedIssue.category === 'quality') onOpenReviewAnalysis();
        else onOpenDetail('PL');
    };

    if (isCollapsed) {
        return (
            <section className="rounded-[24px] border border-slate-200 bg-white/85 px-4 py-3 shadow-[0_18px_50px_-35px_rgba(15,23,42,0.35)] ring-1 ring-white/70">
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                        <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-slate-950 text-sky-300">
                            <Gauge className="h-4 w-4" />
                        </div>
                        <div>
                            <div className="text-sm font-bold text-slate-900">经营异常雷达已隐藏</div>
                            <div className="mt-0.5 text-xs text-slate-500">
                                严重 {criticalCount} · 预警 {warningCount} · 动作 {activeActions.length}
                            </div>
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={() => setCollapsed(false)}
                        className="rounded-2xl bg-slate-950 px-3.5 py-2 text-xs font-bold text-white hover:bg-slate-800"
                    >
                        展开雷达
                    </button>
                </div>
            </section>
        );
    }

    return (
        <section className="overflow-hidden rounded-[28px] border border-white/80 bg-white shadow-[0_24px_70px_-42px_rgba(15,23,42,0.45)] ring-1 ring-slate-200/70">
            <div className="border-b border-slate-200 bg-slate-950 px-5 py-4 text-white">
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/10 ring-1 ring-white/15">
                            <Gauge className="h-5 w-5 text-sky-300" />
                        </div>
                        <div>
                            <div className="text-sm font-bold tracking-[0.12em]">经营异常雷达</div>
                            <div className="mt-1 text-xs text-slate-400">毛利额为核心目标，其余指标作为 KR 拆解到责任动作</div>
                        </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                        <span className="rounded-full border border-rose-400/30 bg-rose-400/10 px-3 py-1 font-semibold text-rose-100">
                            严重 {criticalCount}
                        </span>
                        <span className="rounded-full border border-amber-400/30 bg-amber-400/10 px-3 py-1 font-semibold text-amber-100">
                            预警 {warningCount}
                        </span>
                        <span className="rounded-full border border-sky-400/30 bg-sky-400/10 px-3 py-1 font-semibold text-sky-100">
                            动作 {activeActions.length}
                        </span>
                        <button
                            type="button"
                            onClick={() => setCollapsed(true)}
                            className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/10 px-3 py-1 font-semibold text-slate-200 transition-colors hover:bg-white/15"
                        >
                            <Minimize2 className="h-3 w-3" />
                            隐藏
                        </button>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-[minmax(260px,0.9fr)_minmax(360px,1.35fr)_minmax(280px,0.95fr)]">
                <div className="border-b border-slate-200 bg-slate-50/80 p-4 lg:border-b-0 lg:border-r">
                    <div className="mb-3 flex items-center justify-between">
                        <div className="flex items-center gap-2 text-sm font-bold text-slate-800">
                            <AlertTriangle className="h-4 w-4 text-amber-500" />
                            优先事项
                        </div>
                        <span className="text-xs font-mono text-slate-400">{issues.length}</span>
                    </div>
                    <div className="space-y-2">
                        {issues.map(issue => {
                            const isActive = issue.id === selectedIssue.id;
                            const action = getIssueAction(actions, issue.id);
                            return (
                                <button
                                    key={issue.id}
                                    type="button"
                                    onClick={() => setSelectedIssueId(issue.id)}
                                    className={`w-full rounded-2xl border p-3 text-left transition-all ${
                                        isActive
                                            ? 'border-sky-300 bg-white shadow-sm ring-2 ring-sky-100'
                                            : 'border-slate-200 bg-white/70 hover:bg-white'
                                    }`}
                                >
                                    <div className="flex items-start justify-between gap-2">
                                        <div className="min-w-0">
                                            <div className="flex flex-wrap items-center gap-1.5">
                                                <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${severityClass[issue.severity]}`}>
                                                    {issue.severity === 'critical' ? '严重' : issue.severity === 'warning' ? '预警' : '观察'}
                                                </span>
                                                <span className="rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500">
                                                    {categoryLabel[issue.category]}
                                                </span>
                                                {action && (
                                                    <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${statusClass[action.status]}`}>
                                                        {statusLabel[action.status]}
                                                    </span>
                                                )}
                                            </div>
                                            <div className="mt-2 truncate text-sm font-bold text-slate-900">{issue.title}</div>
                                            <div className="mt-1 line-clamp-2 text-xs leading-5 text-slate-500">{issue.evidence}</div>
                                        </div>
                                        <ArrowRight className={`mt-1 h-4 w-4 flex-shrink-0 ${isActive ? 'text-sky-500' : 'text-slate-300'}`} />
                                    </div>
                                </button>
                            );
                        })}
                    </div>
                </div>

                <div className="border-b border-slate-200 p-5 lg:border-b-0 lg:border-r">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                            <div className="flex flex-wrap items-center gap-2">
                                <span className={`rounded-full border px-2.5 py-1 text-xs font-bold ${severityClass[selectedIssue.severity]}`}>
                                    {selectedIssue.severity === 'critical' ? '严重异常' : selectedIssue.severity === 'warning' ? '经营预警' : '观察项'}
                                </span>
                                <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-500">
                                    {categoryLabel[selectedIssue.category]}
                                </span>
                            </div>
                            <h2 className="mt-3 text-xl font-bold tracking-tight text-slate-950">{selectedIssue.title}</h2>
                        </div>
                        <button
                            type="button"
                            onClick={openBestDrilldown}
                            className="inline-flex items-center gap-2 rounded-2xl bg-slate-950 px-3.5 py-2 text-xs font-bold text-white shadow-sm transition-colors hover:bg-slate-800"
                        >
                            <Filter className="h-3.5 w-3.5" />
                            下钻验证
                        </button>
                    </div>

                    <div className="mt-4 grid gap-3 sm:grid-cols-2">
                        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                            <div className="text-xs font-bold text-slate-500">证据</div>
                            <p className="mt-2 text-sm leading-6 text-slate-800">{selectedIssue.evidence}</p>
                        </div>
                        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                            <div className="text-xs font-bold text-slate-500">经营影响</div>
                            <p className="mt-2 text-sm leading-6 text-slate-800">{selectedIssue.impact}</p>
                        </div>
                    </div>

                    <div className="mt-4 rounded-2xl border border-sky-200 bg-sky-50 p-4">
                        <div className="flex items-center gap-2 text-sm font-bold text-sky-900">
                            <ListChecks className="h-4 w-4" />
                            诊断链路
                        </div>
                        <div className="mt-4 space-y-3">
                            {selectedIssue.diagnosticChain.map((step, idx) => (
                                <div key={step.id} className="grid grid-cols-[28px_1fr] gap-3">
                                    <div className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold ${
                                        step.status === 'triggered'
                                            ? 'bg-rose-500 text-white'
                                            : step.status === 'blocked'
                                                ? 'bg-slate-300 text-slate-700'
                                                : 'bg-white text-slate-500 ring-1 ring-slate-200'
                                    }`}>
                                        {idx + 1}
                                    </div>
                                    <div className="rounded-2xl border border-white bg-white/80 p-3">
                                        <div className="flex flex-wrap items-center justify-between gap-2">
                                            <div className="text-sm font-bold text-slate-900">{step.label}</div>
                                            <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">
                                                {step.status === 'triggered' ? '已触发' : step.status === 'blocked' ? '缺数据' : '待核对'}
                                            </span>
                                        </div>
                                        <div className="mt-1 text-xs leading-5 text-slate-600">{step.evidence}</div>
                                        <div className="mt-2 text-xs leading-5 text-slate-500">{step.nextAction}</div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="mt-4 flex flex-wrap gap-2">
                        <button
                            type="button"
                            onClick={() => onOpenDetail('PL')}
                            className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                        >
                            P&L 子表
                        </button>
                        <button
                            type="button"
                            onClick={() => onOpenDetail('Traffic')}
                            className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                        >
                            广告子表
                        </button>
                        <button
                            type="button"
                            onClick={() => onOpenDetail('Inventory')}
                            className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                        >
                            库存子表
                        </button>
                        <button
                            type="button"
                            onClick={onOpenRefundAnalysis}
                            className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                        >
                            退货专题
                        </button>
                        <button
                            type="button"
                            onClick={onOpenReviewAnalysis}
                            className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                        >
                            评论专题
                        </button>
                        <button
                            type="button"
                            onClick={onOpenKeywordAnalysis}
                            className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                        >
                            关键词专题
                        </button>
                    </div>
                </div>

                <div className="bg-white p-5">
                    <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2 text-sm font-bold text-slate-800">
                            <ClipboardList className="h-4 w-4 text-emerald-500" />
                            动作闭环
                        </div>
                        {!linkedAction && (
                            <button
                                type="button"
                                onClick={() => onCreateAction(selectedIssue)}
                                className="rounded-2xl bg-emerald-600 px-3 py-2 text-xs font-bold text-white shadow-sm hover:bg-emerald-500"
                            >
                                生成动作
                            </button>
                        )}
                    </div>

                    <div className="mt-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
                        <div className="text-xs font-bold text-emerald-800">建议动作</div>
                        <p className="mt-2 text-sm leading-6 text-slate-800">{selectedIssue.recommendation}</p>
                        <div className="mt-3 grid gap-2 text-xs text-slate-600">
                            <div className="flex items-center gap-2">
                                <UserRound className="h-3.5 w-3.5 text-emerald-600" />
                                负责人：{linkedAction?.owner || selectedIssue.suggestedOwner}
                            </div>
                            <div className="flex items-center gap-2">
                                <CalendarClock className="h-3.5 w-3.5 text-emerald-600" />
                                截止时间：{linkedAction?.dueDate || selectedIssue.suggestedDueDate}
                            </div>
                        </div>
                    </div>

                    {linkedAction && (
                        <div className="mt-3 rounded-2xl border border-slate-200 p-3">
                            <div className="mb-2 text-xs font-bold text-slate-500">当前动作状态</div>
                            <div className="grid grid-cols-2 gap-2">
                                {(['open', 'doing', 'done', 'ignored'] as ActionStatus[]).map(status => (
                                    <button
                                        key={status}
                                        type="button"
                                        onClick={() => onUpdateAction(linkedAction.id, { status })}
                                        className={`rounded-xl border px-2.5 py-2 text-xs font-semibold transition-colors ${
                                            linkedAction.status === status
                                                ? statusClass[status]
                                                : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50'
                                        }`}
                                    >
                                        {linkedAction.status === status && <Check className="mr-1 inline h-3 w-3" />}
                                        {statusLabel[status]}
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                    <div className="mt-5">
                        <button
                            type="button"
                            onClick={() => setRulesOpen(prev => !prev)}
                            className="flex w-full items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-bold text-slate-700"
                        >
                            <span className="flex items-center gap-2">
                                <BookOpen className="h-4 w-4 text-slate-500" />
                                经营规则库
                            </span>
                            <ChevronDown className={`h-4 w-4 transition-transform ${rulesOpen ? 'rotate-180' : ''}`} />
                        </button>
                        {rulesOpen && (
                            <div className="mt-2 max-h-72 space-y-2 overflow-y-auto pr-1">
                                {rules.map(rule => (
                                    <div key={rule.id} className="rounded-2xl border border-slate-200 bg-white p-3">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <span className="text-xs font-bold text-slate-900">{rule.name}</span>
                                            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500">
                                                {categoryLabel[rule.category]}
                                            </span>
                                        </div>
                                        <div className="mt-1 text-[11px] font-semibold text-slate-500">{rule.thresholdLabel}</div>
                                        <div className="mt-1 text-xs leading-5 text-slate-600">{rule.description}</div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </section>
    );
};
