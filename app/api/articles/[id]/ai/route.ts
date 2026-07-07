import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { applyRecommendedTags, enrichArticleWithAi } from "@/lib/articles";
import { generateArticleSummary, generateKeywords, generateMethodologyAndInsights } from "@/lib/services/ai";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await context.params;
  const body = await request.json().catch(() => ({}));
  const target = String(body.target ?? "all");
  const article = await prisma.article.findFirst({
    where: { id, userId: user.id, isDeleted: false },
    include: {
      articleTags: { include: { tag: true } },
      highlights: { select: { highlightText: true } }
    }
  });
  if (!article) return NextResponse.json({ error: "文章不存在" }, { status: 404 });
  const tagNames = article.articleTags.map((item) => item.tag.name);

  if (target === "summary") {
    const summary = await generateArticleSummary(article, { userId: user.id, tags: tagNames });
    const updated = await prisma.article.update({
      where: { id: article.id, userId: user.id },
      data: { summary: summary.text, keywords: await generateKeywords(article.title, article.content) }
    });
    return NextResponse.json({
      ok: true,
      aiSource: summary.source,
      summary: updated.summary,
      methodologyAndInsights: updated.methodologyAndInsights,
      warnings: [summary.warning].filter(Boolean)
    });
  }

  if (target === "methodology") {
    const methodologyAndInsights = await generateMethodologyAndInsights(article, article.highlights, { userId: user.id, tags: tagNames });
    const updated = await prisma.article.update({
      where: { id: article.id, userId: user.id },
      data: { methodologyAndInsights: methodologyAndInsights.text }
    });
    return NextResponse.json({
      ok: true,
      aiSource: methodologyAndInsights.source,
      summary: updated.summary,
      methodologyAndInsights: updated.methodologyAndInsights,
      warnings: [methodologyAndInsights.warning].filter(Boolean)
    });
  }

  const result = await enrichArticleWithAi({
    userId: user.id,
    articleId: id,
    title: article.title,
    content: article.content,
    myOpinion: article.myOpinion
  });
  const warnings = [...result.warnings];
  try {
    await applyRecommendedTags({
      userId: user.id,
      articleId: id,
      title: article.title,
      content: article.content
    });
  } catch {
    warnings.push("标签推荐失败，可稍后手动调整标签。");
  }

  return NextResponse.json({
    ok: true,
    aiSource: result.aiSource,
    summary: result.article.summary,
    methodologyAndInsights: result.article.methodologyAndInsights,
    warnings
  });
}
