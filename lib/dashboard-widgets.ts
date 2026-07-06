export const DASHBOARD_WIDGET_LABELS = {
  weeklyReadingTime: "本周阅读时间",
  monthlyReadingTime: "本月阅读时间",
  completedArticles: "已完成阅读文章",
  importedArticles: "累计导入文章",
  highlightCount: "高亮笔记总数",
  noteTypeDistribution: "各类笔记数量",
  tagDistribution: "标签阅读分布",
  readingTrend: "阅读趋势",
  feishuSyncCount: "飞书同步数量",
  reportCount: "生成洞察报告数量",
  monthlyTokenUsage: "本月 Token 消耗",
  totalTokenUsage: "累计 Token 消耗"
} as const;

export type DashboardWidgetKey = keyof typeof DASHBOARD_WIDGET_LABELS;

export type DashboardWidgetPreferences = Record<DashboardWidgetKey, boolean>;

export const DEFAULT_DASHBOARD_WIDGET_PREFERENCES: DashboardWidgetPreferences = {
  weeklyReadingTime: true,
  monthlyReadingTime: true,
  completedArticles: true,
  importedArticles: false,
  highlightCount: true,
  noteTypeDistribution: false,
  tagDistribution: true,
  readingTrend: true,
  feishuSyncCount: false,
  reportCount: true,
  monthlyTokenUsage: true,
  totalTokenUsage: false
};

export const DASHBOARD_WIDGET_ORDER = Object.keys(DASHBOARD_WIDGET_LABELS) as DashboardWidgetKey[];

export function normalizeDashboardWidgetPreferences(raw?: string | null): DashboardWidgetPreferences {
  if (!raw) return { ...DEFAULT_DASHBOARD_WIDGET_PREFERENCES };

  try {
    const parsed = JSON.parse(raw) as Partial<Record<string, unknown>>;
    return DASHBOARD_WIDGET_ORDER.reduce((preferences, key) => {
      preferences[key] = typeof parsed[key] === "boolean" ? parsed[key] : DEFAULT_DASHBOARD_WIDGET_PREFERENCES[key];
      return preferences;
    }, { ...DEFAULT_DASHBOARD_WIDGET_PREFERENCES });
  } catch {
    return { ...DEFAULT_DASHBOARD_WIDGET_PREFERENCES };
  }
}

export function sanitizeDashboardWidgetPreferences(input: unknown): DashboardWidgetPreferences {
  const source = input && typeof input === "object" ? input as Record<string, unknown> : {};
  return DASHBOARD_WIDGET_ORDER.reduce((preferences, key) => {
    preferences[key] = typeof source[key] === "boolean" ? source[key] as boolean : DEFAULT_DASHBOARD_WIDGET_PREFERENCES[key];
    return preferences;
  }, { ...DEFAULT_DASHBOARD_WIDGET_PREFERENCES });
}
