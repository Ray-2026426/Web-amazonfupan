import React from 'react';
import {
  RotateCcw,
  MessageSquareText,
  Search,
  Calculator,
  Table2,
  Stethoscope,
  ArrowUpRight,
} from 'lucide-react';
import { SurfaceCard } from './ui/SurfaceCard';

interface TopicsHubProps {
  refundCount: number;
  reviewCount: number;
  keywordCount: number;
  onOpenRefund: () => void;
  onOpenReview: () => void;
  onOpenKeyword: () => void;
  onOpenSimulator: () => void;
  onOpenDetail: () => void;
  onOpenDoctor: () => void;
}

export const TopicsHub: React.FC<TopicsHubProps> = ({
  refundCount,
  reviewCount,
  keywordCount,
  onOpenRefund,
  onOpenReview,
  onOpenKeyword,
  onOpenSimulator,
  onOpenDetail,
  onOpenDoctor,
}) => {
  const cards = [
    {
      title: '退货分析',
      desc: '按 ASIN、店铺和退货原因拆解退货率与退款损失，快速定位质量或描述偏差款。',
      meta: refundCount > 0 ? `已载入 ${refundCount.toLocaleString()} 条退货记录` : '未导入退货表（可在右上角导入）',
      icon: RotateCcw,
      tone: 'bg-rose-50 text-rose-600 dark:bg-rose-500/15 dark:text-rose-300',
      onClick: onOpenRefund,
    },
    {
      title: '评论分析',
      desc: '星级分布、差评高频痛点与 AI 口碑洞察，联动当前筛选的 ASIN 列表。',
      meta: reviewCount > 0 ? `已载入 ${reviewCount.toLocaleString()} 条评论` : '未导入评论表（可在右上角导入）',
      icon: MessageSquareText,
      tone: 'bg-amber-50 text-amber-600 dark:bg-amber-500/15 dark:text-amber-300',
      onClick: onOpenReview,
    },
    {
      title: '搜索词分析',
      desc: '拆解广告搜索词花费、转化率与 ACoS，筛选高耗低转否定词与潜力出单词。',
      meta: keywordCount > 0 ? `已载入 ${keywordCount.toLocaleString()} 条搜索词` : '未导入搜索词报表',
      icon: Search,
      tone: 'bg-indigo-50 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300',
      onClick: onOpenKeyword,
    },
    {
      title: '利润模拟器',
      desc: '调整售价、头程、采购成本与广告占比，实时推演单品毛利率与盈亏平衡 ACoS。',
      meta: '实时试算工具',
      icon: Calculator,
      tone: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300',
      onClick: onOpenSimulator,
    },
    {
      title: '多维明细透视',
      desc: '按店铺、品牌、负责人、父/子 ASIN 自由分组下钻，支持一键复制到飞书汇报。',
      meta: '全量明细下钻',
      icon: Table2,
      tone: 'bg-violet-50 text-violet-600 dark:bg-violet-500/15 dark:text-violet-300',
      onClick: onOpenDetail,
    },
    {
      title: '数据体检',
      desc: '核对云端同步覆盖日、毛利对账差异与目标表缺失项，确保口径一致。',
      meta: '数据质量诊断',
      icon: Stethoscope,
      tone: 'bg-sky-50 text-sky-600 dark:bg-sky-500/15 dark:text-sky-300',
      onClick: onOpenDoctor,
    },
  ];

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
      {cards.map((card) => {
        const Icon = card.icon;
        return (
          <SurfaceCard
            key={card.title}
            hoverable
            onClick={card.onClick}
            className="group flex cursor-pointer flex-col justify-between"
          >
            <div>
              <div className="flex items-start justify-between">
                <div className={`flex h-11 w-11 items-center justify-center rounded-2xl ${card.tone}`}>
                  <Icon className="h-5 w-5" />
                </div>
                <ArrowUpRight className="h-4 w-4 text-[#aeaeb2] transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-[#4f46e5]" />
              </div>
              <h3 className="mt-4 text-[17px] font-semibold tracking-tight text-[#1d1d1f] dark:text-[#f5f5f7]">
                {card.title}
              </h3>
              <p className="mt-1.5 text-[13px] leading-relaxed text-[#86868b] dark:text-[#a7abb8]">{card.desc}</p>
            </div>
            <div className="mt-5 border-t border-black/[0.06] pt-3 text-xs font-medium text-[#424245] dark:border-white/[0.08] dark:text-[#c7c9d1]">
              {card.meta}
            </div>
          </SurfaceCard>
        );
      })}
    </div>
  );
};
