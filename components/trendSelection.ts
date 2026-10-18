let persistedTrendMetrics: string[] | null = null;

export const getTrendMetricsSelection = () => persistedTrendMetrics;
export const setTrendMetricsSelection = (metrics: string[]) => { persistedTrendMetrics = metrics; };
export const resetTrendChartMetricsSelection = () => { persistedTrendMetrics = null; };
