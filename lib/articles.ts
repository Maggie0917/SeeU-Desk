import { prisma } from "@/lib/prisma";
import { generateArticleSummary, generateKeywords, generateMethodologyAndInsights, recommendTags } from "@/lib/services/ai";

export async function applyRecommendedTags(input: {
  userId: string;
  articleId: string;
  title: string;
  content: string;
}) {
  const tags = await prisma.tag.findMany({
    where: { userId: input.userId },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }]
  });
  const names = await recommendTags(
    input.title,
    input.content,
    tags.map((tag) => tag.name),
    { userId: input.userId }
  );
  const chosen = tags.filter((tag) => names.includes(tag.name)).slice(0, 3);

  if (chosen.length === 0 && tags[0]) chosen.push(tags[0]);

  await prisma.articleTag.deleteMany({
    where: { userId: input.userId, articleId: input.articleId }
  });

  for (const [index, tag] of chosen.entries()) {
    await prisma.articleTag.create({
      data: {
        userId: input.userId,
        articleId: input.articleId,
        tagId: tag.id,
        tagRole: index === 0 ? "primary" : "secondary"
      }
    });
  }

  return chosen;
}

export async function enrichArticleWithAi(input: {
  userId: string;
  articleId: string;
  title: string;
  content: string;
  myOpinion?: string | null;
}) {
  const highlights = await prisma.highlight.findMany({
    where: { userId: input.userId, articleId: input.articleId },
    select: { highlightText: true }
  });
  const article = {
    title: input.title,
    content: input.content,
    myOpinion: input.myOpinion
  };

  const tagNames = await prisma.articleTag.findMany({
    where: { userId: input.userId, articleId: input.articleId },
    include: { tag: true }
  });

  const [summary, methodologyAndInsights, keywords] = await Promise.all([
    generateArticleSummary(article, { userId: input.userId, tags: tagNames.map((item) => item.tag.name) }),
    generateMethodologyAndInsights(article, highlights, { userId: input.userId, tags: tagNames.map((item) => item.tag.name) }),
    generateKeywords(input.title, input.content)
  ]);

  const updated = await prisma.article.update({
    where: { id: input.articleId, userId: input.userId },
    data: { summary: summary.text, methodologyAndInsights: methodologyAndInsights.text, keywords }
  });

  return {
    article: updated,
    aiSource: summary.source === "real" && methodologyAndInsights.source === "real" ? "real" : "mock",
    warnings: [summary.warning, methodologyAndInsights.warning].filter(Boolean)
  };
}

export async function getArticleWithRelations(userId: string, articleId: string) {
  return prisma.article.findFirst({
    where: { id: articleId, userId, isDeleted: false },
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
  });
}
