import { AppShell } from "@/components/AppShell";
import { ArticleCard, ArticleCardData } from "@/components/ArticleCards";
import { ArticleImportPanel } from "@/components/ArticleImportPanel";
import { requireUser } from "@/lib/auth";
import { DatabaseUnavailableNotice } from "@/components/DatabaseUnavailableNotice";
import { isDatabaseUnavailableError, withDbRetry } from "@/lib/db-with-retry";
import { prisma } from "@/lib/prisma";

function serializeArticle(article: any): ArticleCardData {
  return {
    ...article,
    createdAt: article.createdAt.toISOString(),
    updatedAt: article.updatedAt?.toISOString()
  };
}

export default async function ReadingDeskPage() {
  try {
    return await ReadingDeskContent();
  } catch (error) {
    if (isDatabaseUnavailableError(error)) return <DatabaseUnavailableNotice />;
    throw error;
  }
}

async function ReadingDeskContent() {
  const user = await requireUser();
  const [readLater, recent] = await withDbRetry(() => Promise.all([
    prisma.article.findMany({
      where: { userId: user.id, isInReadLater: true, isDeleted: false },
      include: {
        articleTags: { include: { tag: true } },
        feishuDoc: true,
        _count: { select: { highlights: true, notes: true } }
      },
      orderBy: { createdAt: "desc" },
      take: 6
    }),
    prisma.article.findMany({
      where: { userId: user.id, isDeleted: false },
      include: {
        articleTags: { include: { tag: true } },
        feishuDoc: true,
        _count: { select: { highlights: true, notes: true } }
      },
      orderBy: { createdAt: "desc" },
      take: 6
    })
  ]));

  const normalize = (article: any) =>
    serializeArticle({
      ...article,
      counts: { highlights: article._count.highlights, notes: article._count.notes }
    });

  return (
    <AppShell>
      <div className="mx-auto max-w-7xl space-y-6">
        <div>
          <h1 className="text-3xl font-black text-ink">阅读台</h1>
          <p className="mt-2 text-sm text-moss">导入、兜底解析、沉淀为可阅读页面，从这里开始。</p>
        </div>
        <ArticleImportPanel />
        <div className="grid gap-5 xl:grid-cols-2">
          <section className="card bg-paper/70">
            <div className="flex items-center justify-between gap-4">
              <h2 className="section-title">待读清单</h2>
              <span className="pill">{readLater.length} 篇</span>
            </div>
            <div className="mt-4 grid gap-3">
              {readLater.length ? (
                readLater.map((article) => <ArticleCard key={article.id} article={normalize(article)} />)
              ) : (
                <div className="rounded-md border border-dashed border-line p-6 text-sm text-moss">暂无待读文章</div>
              )}
            </div>
          </section>
          <section className="card border-t-4 border-t-sky">
            <div className="flex items-center justify-between gap-4">
              <h2 className="section-title">最近导入文章</h2>
              <span className="pill">{recent.length} 篇</span>
            </div>
            <div className="mt-4 grid gap-3">
              {recent.length ? (
                recent.map((article) => <ArticleCard key={article.id} article={normalize(article)} />)
              ) : (
                <div className="rounded-md border border-dashed border-line p-6 text-sm text-moss">导入第一篇文章后会显示在这里</div>
              )}
            </div>
          </section>
        </div>
      </div>
    </AppShell>
  );
}
