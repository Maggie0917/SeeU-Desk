import { AppShell } from "@/components/AppShell";
import { DashboardCustomizer } from "@/components/DashboardCustomizer";
import { MetricCard } from "@/components/MetricCard";
import { NOTE_TYPE_LABELS } from "@/lib/constants";
import { normalizeDashboardWidgetPreferences } from "@/lib/dashboard-widgets";
import { requireUser } from "@/lib/auth";
import { DatabaseUnavailableNotice } from "@/components/DatabaseUnavailableNotice";
import { isDatabaseUnavailableError, withDbRetry } from "@/lib/db-with-retry";
import { prisma } from "@/lib/prisma";

function secondsToMinutes(seconds: number) {
  return `${Math.floor(seconds / 60)} min`;
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

function tokenMetricValue(totalTokens: number | null | undefined) {
  return typeof totalTokens === "number" ? `${formatNumber(totalTokens)} tokens` : "暂无 Token 数据";
}

function tokenMetricHint(inputTokens: number | null | undefined, outputTokens: number | null | undefined, unavailableCount: number) {
  if (typeof inputTokens === "number" || typeof outputTokens === "number") {
    return `输入 ${formatNumber(inputTokens ?? 0)} / 输出 ${formatNumber(outputTokens ?? 0)}`;
  }
  if (unavailableCount > 0) return "当前模型未返回 Token 用量";
  return "真实 AI 生成后显示";
}

function effectiveTotalTokens(totalTokens: number | null | undefined, inputTokens: number | null | undefined, outputTokens: number | null | undefined) {
  if (typeof totalTokens === "number") return totalTokens;
  if (typeof inputTokens === "number" || typeof outputTokens === "number") return (inputTokens ?? 0) + (outputTokens ?? 0);
  return null;
}

function BarChart({ items }: { items: Array<{ label: string; value: number }> }) {
  const max = Math.max(...items.map((item) => item.value), 1);
  return (
    <div className="space-y-3">
      {items.map((item) => (
        <div key={item.label}>
          <div className="mb-1 flex justify-between text-xs text-moss">
            <span>{item.label}</span>
            <span>{item.value}</span>
          </div>
          <div className="h-3 overflow-hidden rounded-full bg-paper">
            <div className="h-full rounded-full bg-leaf" style={{ width: `${(item.value / max) * 100}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

export default async function DashboardPage() {
  try {
    return await DashboardContent();
  } catch (error) {
    if (isDatabaseUnavailableError(error)) return <DatabaseUnavailableNotice />;
    throw error;
  }
}

async function DashboardContent() {
  const user = await requireUser();
  const now = new Date();
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - ((now.getDay() + 6) % 7));
  weekStart.setHours(0, 0, 0, 0);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const [
    articleCount,
    finishedArticleCount,
    highlightCount,
    noteCount,
    syncedCount,
    monthSessions,
    weekSessions,
    reportCount,
    notes,
    articleTags,
    articles,
    settings,
    monthlyTokenUsage,
    totalTokenUsage,
    monthlyUnavailableUsageCount,
    totalUnavailableUsageCount
  ] = await withDbRetry(() => Promise.all([
    prisma.article.count({ where: { userId: user.id, isDeleted: false } }),
    prisma.article.count({ where: { userId: user.id, isDeleted: false, readingStatus: "finished" } }),
    prisma.highlight.count({ where: { userId: user.id, article: { isDeleted: false } } }),
    prisma.note.count({ where: { userId: user.id, article: { isDeleted: false } } }),
    prisma.feishuDoc.count({ where: { userId: user.id, syncStatus: "synced", article: { isDeleted: false } } }),
    prisma.readingSession.findMany({ where: { userId: user.id, startedAt: { gte: monthStart }, article: { isDeleted: false } } }),
    prisma.readingSession.findMany({ where: { userId: user.id, startedAt: { gte: weekStart }, article: { isDeleted: false } } }),
    prisma.report.count({ where: { userId: user.id } }),
    prisma.note.findMany({ where: { userId: user.id, article: { isDeleted: false } }, select: { noteType: true } }),
    prisma.articleTag.findMany({ where: { userId: user.id, article: { isDeleted: false } }, include: { tag: true } }),
    prisma.article.findMany({ where: { userId: user.id, isDeleted: false }, select: { createdAt: true } }),
    prisma.userSettings.findUnique({ where: { userId: user.id }, select: { dashboardWidgetPreferences: true } }),
    prisma.aiUsageLog.aggregate({
      where: { userId: user.id, actionType: { not: "connection_test" }, usageAvailable: true, createdAt: { gte: monthStart } },
      _sum: { promptTokens: true, completionTokens: true, totalTokens: true }
    }),
    prisma.aiUsageLog.aggregate({
      where: { userId: user.id, actionType: { not: "connection_test" }, usageAvailable: true },
      _sum: { promptTokens: true, completionTokens: true, totalTokens: true }
    }),
    prisma.aiUsageLog.count({
      where: { userId: user.id, actionType: { not: "connection_test" }, usageAvailable: false, createdAt: { gte: monthStart } }
    }),
    prisma.aiUsageLog.count({
      where: { userId: user.id, actionType: { not: "connection_test" }, usageAvailable: false }
    })
  ]));

  const noteTypeItems = Object.entries(NOTE_TYPE_LABELS).map(([key, label]) => ({
    label,
    value: notes.filter((note) => note.noteType === key).length
  }));

  const tagItems = Array.from(
    articleTags.reduce((map, item) => {
      map.set(item.tag.name, (map.get(item.tag.name) || 0) + 1);
      return map;
    }, new Map<string, number>())
  ).map(([label, value]) => ({ label, value }));

  const trendItems = Array.from({ length: 7 }).map((_, index) => {
    const date = new Date(now);
    date.setDate(now.getDate() - (6 - index));
    const key = date.toISOString().slice(5, 10);
    return {
      label: key,
      value: articles.filter((article) => article.createdAt.toISOString().slice(5, 10) === key).length
    };
  });

  const monthSeconds = monthSessions.reduce((sum, session) => sum + session.durationSeconds, 0);
  const weekSeconds = weekSessions.reduce((sum, session) => sum + session.durationSeconds, 0);
  const monthlyTotalTokens = effectiveTotalTokens(monthlyTokenUsage._sum.totalTokens, monthlyTokenUsage._sum.promptTokens, monthlyTokenUsage._sum.completionTokens);
  const allTimeTotalTokens = effectiveTotalTokens(totalTokenUsage._sum.totalTokens, totalTokenUsage._sum.promptTokens, totalTokenUsage._sum.completionTokens);
  const preferences = normalizeDashboardWidgetPreferences(settings?.dashboardWidgetPreferences);
  const visibleMetricCount = [
    preferences.weeklyReadingTime,
    preferences.monthlyReadingTime,
    preferences.completedArticles,
    preferences.importedArticles,
    preferences.highlightCount,
    preferences.feishuSyncCount,
    preferences.reportCount,
    preferences.monthlyTokenUsage,
    preferences.totalTokenUsage
  ].filter(Boolean).length;
  const visibleChartCount = [
    preferences.readingTrend,
    preferences.tagDistribution,
    preferences.noteTypeDistribution
  ].filter(Boolean).length;

  return (
    <AppShell>
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-3xl font-black text-ink">数据看板</h1>
            <p className="mt-2 text-sm text-moss">查看个人阅读资产的积累规模、分布、趋势和 AI Token 消耗。</p>
          </div>
          <DashboardCustomizer preferences={preferences} />
        </div>

        {visibleMetricCount ? (
          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {preferences.weeklyReadingTime ? <MetricCard label="本周阅读时间" value={secondsToMinutes(weekSeconds)} hint="来自未删除文章的阅读会话" tone="blue" /> : null}
            {preferences.monthlyReadingTime ? <MetricCard label="本月阅读时间" value={secondsToMinutes(monthSeconds)} hint="按本月阅读会话统计" tone="cream" /> : null}
            {preferences.completedArticles ? <MetricCard label="已完成阅读文章" value={finishedArticleCount} hint={`累计导入 ${articleCount} 篇`} tone="primary" /> : null}
            {preferences.importedArticles ? <MetricCard label="累计导入文章" value={articleCount} hint="仅统计未删除文章" tone="white" /> : null}
            {preferences.highlightCount ? <MetricCard label="高亮笔记总数" value={highlightCount + noteCount} tone="white" /> : null}
            {preferences.monthlyTokenUsage ? (
              <MetricCard
                label="本月 Token 消耗"
                value={tokenMetricValue(monthlyTotalTokens)}
                hint={tokenMetricHint(monthlyTokenUsage._sum.promptTokens, monthlyTokenUsage._sum.completionTokens, monthlyUnavailableUsageCount)}
                tone="cream"
              />
            ) : null}
            {preferences.totalTokenUsage ? (
              <MetricCard
                label="累计 Token 消耗"
                value={tokenMetricValue(allTimeTotalTokens)}
                hint={tokenMetricHint(totalTokenUsage._sum.promptTokens, totalTokenUsage._sum.completionTokens, totalUnavailableUsageCount)}
                tone="white"
              />
            ) : null}
            {preferences.feishuSyncCount ? <MetricCard label="飞书同步数量" value={syncedCount} hint="仅统计未删除文章" tone="blue" /> : null}
            {preferences.reportCount ? <MetricCard label="生成洞察报告数量" value={`${reportCount} 份`} tone="cream" /> : null}
          </section>
        ) : null}

        {visibleChartCount ? (
          <section className="grid gap-5 xl:grid-cols-2">
            {preferences.readingTrend ? (
              <div className="card">
                <h2 className="section-title">阅读趋势</h2>
                <div className="mt-5 flex h-56 items-end gap-3">
                  {trendItems.map((item) => {
                    const max = Math.max(...trendItems.map((trend) => trend.value), 1);
                    return (
                      <div key={item.label} className="flex flex-1 flex-col items-center gap-2">
                        <div className="w-full rounded-t-md bg-sky" style={{ height: `${Math.max((item.value / max) * 190, 8)}px` }} />
                        <span className="text-xs text-moss">{item.label}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : null}
            {preferences.tagDistribution ? (
              <div className="card">
                <h2 className="section-title">标签阅读分布</h2>
                <div className="mt-5">
                  <BarChart items={tagItems.length ? tagItems : [{ label: "暂无标签数据", value: 0 }]} />
                </div>
              </div>
            ) : null}
            {preferences.noteTypeDistribution ? (
              <div className="card">
                <h2 className="section-title">各类笔记数量</h2>
                <div className="mt-5">
                  <BarChart items={noteTypeItems} />
                </div>
              </div>
            ) : null}
          </section>
        ) : null}

        {visibleMetricCount || visibleChartCount ? (
          <div className="rounded-lg border border-sky/20 bg-white px-4 py-3 text-sm text-moss">
            你可以在“自定义看板”中随时开启或隐藏数据模块。
          </div>
        ) : (
          <div className="card text-center">
            <h2 className="section-title">当前没有显示的数据模块</h2>
            <p className="mt-2 text-sm text-moss">请点击右上角“自定义看板”开启需要的卡片。</p>
          </div>
        )}
      </div>
    </AppShell>
  );
}
