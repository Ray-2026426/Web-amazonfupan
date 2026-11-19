import React from 'react';

interface SurfaceCardProps extends React.HTMLAttributes<HTMLDivElement> {
  hoverable?: boolean;
  padded?: boolean;
}

/** Apple × Kairo 白色大圆角卡片（24px 圆角 + 极淡 1px 描边） */
export const SurfaceCard: React.FC<SurfaceCardProps> = ({
  hoverable = false,
  padded = true,
  className = '',
  children,
  ...rest
}) => (
  <div
    className={[
      'rounded-[24px] border border-black/[0.06] bg-white dark:border-white/[0.08] dark:bg-[#191c24]',
      padded ? 'p-5 sm:p-6' : '',
      hoverable
        ? 'transition-[transform,box-shadow,border-color] duration-200 hover:-translate-y-0.5 hover:border-indigo-500/20 hover:shadow-[0_18px_40px_-24px_rgba(15,23,42,0.22)]'
        : '',
      className,
    ]
      .filter(Boolean)
      .join(' ')}
    {...rest}
  >
    {children}
  </div>
);
