import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await context.params;
  const body = await request.json().catch(() => ({}));
  const durationSeconds = Math.min(Math.max(Number(body.durationSeconds ?? 0), 0), 60 * 60 * 6);
  const startedAt = body.startedAt ? new Date(String(body.startedAt)) : new Date(Date.now() - durationSeconds * 1000);
  const endedAt = body.endedAt ? new Date(String(body.endedAt)) : new Date();

  if (!Number.isFinite(durationSeconds) || durationSeconds < 5) {
    return NextResponse.json({ ok: true, skipped: true });
  }

  const article = await prisma.article.findFirst({ where: { id, userId: user.id, isDeleted: false }, select: { id: true } });
  if (!article) return NextResponse.json({ error: "文章不存在" }, { status: 404 });

  await prisma.readingSession.create({
    data: {
      userId: user.id,
      articleId: id,
      startedAt,
      endedAt,
      durationSeconds: Math.floor(durationSeconds)
    }
  });

  return NextResponse.json({ ok: true });
}
