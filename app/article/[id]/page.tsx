import { notFound } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { ArticleReaderClient } from "@/components/ArticleReaderClient";
import { requireUser } from "@/lib/auth";
import { getArticleWithRelations } from "@/lib/articles";
import { prisma } from "@/lib/prisma";

export default async function ArticlePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const [article, tags, settings] = await Promise.all([
    getArticleWithRelations(user.id, id),
    prisma.tag.findMany({ where: { userId: user.id }, orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }] }),
    prisma.userSettings.findUnique({ where: { userId: user.id } })
  ]);

  if (!article) notFound();

  const visibleArticle =
    article.readingStatus === "unread"
      ? await prisma.article.update({
          where: { id: article.id },
          data: { readingStatus: "reading" },
          include: {
            articleTags: {
              include: { tag: true },
              orderBy: { tagRole: "asc" }
            },
            highlights: { orderBy: { createdAt: "desc" } },
            notes: {
              include: { highlight: true },
              orderBy: { createdAt: "desc" }
            },
            feishuDoc: true
          }
        })
      : article;

  const serialized = {
    ...visibleArticle,
    createdAt: visibleArticle.createdAt.toISOString(),
    updatedAt: visibleArticle.updatedAt.toISOString(),
    highlights: visibleArticle.highlights.map((highlight) => ({
      ...highlight,
      createdAt: highlight.createdAt.toISOString(),
      updatedAt: highlight.updatedAt.toISOString()
    })),
    notes: visibleArticle.notes.map((note) => ({
      ...note,
      createdAt: note.createdAt.toISOString(),
      updatedAt: note.updatedAt.toISOString(),
      highlight: note.highlight
        ? {
            ...note.highlight,
            createdAt: note.highlight.createdAt.toISOString(),
            updatedAt: note.highlight.updatedAt.toISOString()
          }
        : null
    })),
    feishuDoc: visibleArticle.feishuDoc
      ? {
          ...visibleArticle.feishuDoc,
          createdAt: visibleArticle.feishuDoc.createdAt.toISOString(),
          updatedAt: visibleArticle.feishuDoc.updatedAt.toISOString(),
          lastSyncedAt: visibleArticle.feishuDoc.lastSyncedAt?.toISOString() ?? null
        }
      : null
  };

  return (
    <AppShell>
      <div className="mx-auto max-w-7xl">
        <ArticleReaderClient
          article={serialized as any}
          tags={tags.map((tag) => ({ id: tag.id, name: tag.name }))}
          aiSettings={{
            enabled: Boolean(settings?.aiEnabled && settings.aiApiKeyEncrypted && settings.aiBaseUrl && settings.aiModel),
            connectionStatus: settings?.aiConnectionStatus || "not_configured",
            model: settings?.aiModel || null
          }}
        />
      </div>
    </AppShell>
  );
}
