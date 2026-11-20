import React from 'react';

type Tone = 'brand' | 'partial' | 'success' | 'danger' | 'neutral';

const TONE_MAP: Record<Tone, string> = {
  brand: 'bg-[#eef2ff] text-[#4f46e5] dark:bg-indigo-500/15 dark:text-indigo-300',
  partial: 'bg-[#fff7ed] text-[#c2410c] dark:bg-amber-500/15 dark:text-amber-300',
  success: 'bg-[#ecfdf5] text-[#059669] dark:bg-emerald-500/15 dark:text-emerald-300',
  danger: 'bg-[#fef2f2] text-[#dc2626] dark:bg-rose-500/15 dark:text-rose-300',
  neutral: 'bg-black/[0.05] text-[#424245] dark:bg-white/[0.08] dark:text-[#c7c9d1]',
};

interface StatusPillProps {
  tone?: Tone;
  children: React.ReactNode;
  className?: string;
}

/** 胶囊状态标签（如「进行中 · 已有 4/7 天」「核心目标」「利润」） */
export const StatusPill: React.FC<StatusPillProps> = ({ tone = 'neutral', children, className = '' }) => (
  <span
    className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${TONE_MAP[tone]} ${className}`}
  >
    {children}
  </span>
);
