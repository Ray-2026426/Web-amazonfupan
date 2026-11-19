import React from 'react';

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
  disabled?: boolean;
  title?: string;
}

interface SegmentedControlProps<T extends string> {
  options: SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  size?: 'sm' | 'md';
  className?: string;
}

/** Apple 风格胶囊分段控制器 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  size = 'md',
  className = '',
}: SegmentedControlProps<T>) {
  return (
    <div
      role="tablist"
      className={`inline-flex items-center rounded-xl bg-black/[0.05] p-[3px] dark:bg-white/[0.08] ${className}`}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="tab"
            aria-selected={active}
            disabled={opt.disabled}
            title={opt.title}
            onClick={() => !opt.disabled && onChange(opt.value)}
            className={[
              'rounded-[9px] font-medium transition-[background-color,color,box-shadow] duration-150 disabled:cursor-not-allowed disabled:opacity-40',
              size === 'sm' ? 'h-7 px-3 text-xs' : 'h-[30px] px-4 text-[13px]',
              active
                ? 'bg-white font-semibold text-[#1d1d1f] shadow-[0_1px_3px_rgba(0,0,0,0.08)] dark:bg-[#252a36] dark:text-[#f5f5f7]'
                : 'text-[#424245] hover:text-[#1d1d1f] dark:text-[#a7abb8] dark:hover:text-[#f5f5f7]',
            ].join(' ')}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
