import React from 'react';

/**
 * 不确定时长的加载进度条（indeterminate）：一条光带循环滑动。
 * 用于「正在连接云端 / 读取数据」这种无法算百分比的等待，避免页面看起来卡死。
 */
export const LoadingBar: React.FC<{ className?: string; width?: string }> = ({ className = '', width = 'w-64' }) => (
    <div
        className={`loading-bar relative h-1.5 max-w-full overflow-hidden rounded-full bg-sky-100 ${width} ${className}`}
        role="progressbar"
        aria-label="加载中"
        aria-valuetext="加载中"
    >
        <span className="loading-bar-fill" />
    </div>
);
