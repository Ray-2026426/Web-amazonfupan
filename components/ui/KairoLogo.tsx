import React from 'react';

interface KairoLogoProps {
  size?: number;
  className?: string;
}

/** 复用 Kairo 品牌渐变放大镜 + 增长柱状图 Logo */
export const KairoLogo: React.FC<KairoLogoProps> = ({ size = 26, className = '' }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 64 64"
    fill="none"
    role="img"
    aria-label="Telos Kairo"
    className={className}
  >
    <defs>
      <linearGradient id="telosKairoGrad" x1="8" y1="10" x2="56" y2="54" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor="#3B82F6" />
        <stop offset="55%" stopColor="#6366F1" />
        <stop offset="100%" stopColor="#7C3AED" />
      </linearGradient>
    </defs>
    <circle cx="28" cy="28" r="18" stroke="url(#telosKairoGrad)" strokeWidth="5.5" fill="none" />
    <path d="M41.5 41.5 L54 54" stroke="url(#telosKairoGrad)" strokeWidth="6" strokeLinecap="round" />
    <rect x="18" y="30" width="5" height="10" rx="1.5" fill="url(#telosKairoGrad)" />
    <rect x="25.5" y="24" width="5" height="16" rx="1.5" fill="url(#telosKairoGrad)" />
    <rect x="33" y="18" width="5" height="22" rx="1.5" fill="url(#telosKairoGrad)" />
    <path d="M17 34 L35 20" stroke="#FFFFFF" strokeWidth="3.2" strokeLinecap="round" />
    <path
      d="M29.5 19.5 L35.5 19.2 L35.2 25.2"
      stroke="#FFFFFF"
      strokeWidth="3.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      fill="none"
    />
  </svg>
);
