import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { applyRecommendedTags, enrichArticleWithAi, getArticleWithRelations } from "@/lib/articles";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await context.params;
  const article = await getArticleWithRelations(user.id, id);
  if (!article) return NextResponse.json({ error: "文章不存在" }, { status: 404 });
  return NextResponse.json(article);
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await context.params;
  const body = await request.json().catch(() => ({}));

  const article = await prisma.article.findFirst({ where: { id, userId: user.id, isDeleted: false } });
  if (!article) return NextResponse.json({ error: "文章不存在" }, { status: 404 });

  const updated = await prisma.article.update({
    where: { id },
    data: {
      title: typeof body.title === "string" ? body.title : undefined,
      summary: typeof body.summary === "string" ? body.summary : undefined,
      methodologySummary: typeof body.methodologySummary === "string" ? body.methodologySummary : undefined,
      reusableInsights: typeof body.reusableInsights === "string" ? body.reusableInsights : undefined,
      methodologyAndInsights: typeof body.methodologyAndInsights === "string" ? body.methodologyAndInsights : undefined,
      myOpinion: typeof body.myOpinion === "string" ? body.myOpinion : undefined,
      readingStatus: body.readingStatus,
      isStarred: typeof body.isStarred === "boolean" ? body.isStarred : undefined,
      isInReadLater: typeof body.isInReadLater === "boolean" ? body.isInReadLater : undefined
    }
  });

  if (body.regenerateAi) {
    await enrichArticleWithAi({
      userId: user.id,
      articleId: id,
      title: updated.title,
      content: updated.content,
      myOpinion: updated.myOpinion
    });
  }

  return NextResponse.json({ ok: true });
}

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await context.params;
  const body = await request.json().catch(() => ({}));
  const primaryTagId = String(body.primaryTagId ?? "");
  const secondaryTagIds: string[] = Array.isArray(body.secondaryTagIds)
    ? Array.from(new Set<string>(body.secondaryTagIds.map(String).filter(Boolean))).filter((tagId) => tagId !== primaryTagId)
    : [];

  const article = await prisma.article.findFirst({ where: { id, userId: user.id, isDeleted: false } });
  if (!article) return NextResponse.json({ error: "文章不存在" }, { status: 404 });

  const tagIds = [primaryTagId, ...secondaryTagIds].filter(Boolean);
  const tags = await prisma.tag.findMany({ where: { userId: user.id, id: { in: tagIds } } });
  if (!primaryTagId || !tags.some((tag) => tag.id === primaryTagId)) {
    return NextResponse.json({ error: "必须选择一个主标签" }, { status: 400 });
  }

  await prisma.articleTag.deleteMany({ where: { userId: user.id, articleId: id } });
  for (const tagId of tagIds) {
    await prisma.articleTag.create({
      data: {
        userId: user.id,
        articleId: id,
        tagId,
        tagRole: tagId === primaryTagId ? "primary" : "secondary"
      }
    });
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await context.params;
  const article = await prisma.article.findFirst({ where: { id, userId: user.id, isDeleted: false } });
  if (!article) return NextResponse.json({ error: "文章不存在" }, { status: 404 });

  await prisma.article.update({
    where: { id },
    data: {
      isDeleted: true,
      deletedAt: new Date(),
      isInReadLater: false
    }
  });

  return NextResponse.json({ ok: true });
}
