import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { NOTE_TYPE_LABELS } from "@/lib/constants";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await context.params;
  const body = await request.json().catch(() => ({}));
  let highlightText = String(body.highlightText ?? "").trim();
  const noteType = String(body.noteType ?? "uncategorized");
  const paragraphIndex = Number(body.paragraphIndex);
  const startOffset = Number(body.startOffset);
  const endOffset = Number(body.endOffset);

  if (highlightText.length < 2) {
    return NextResponse.json({ error: "请选择需要高亮的正文" }, { status: 400 });
  }
  if (!(noteType in NOTE_TYPE_LABELS)) {
    return NextResponse.json({ error: "笔记类型不正确" }, { status: 400 });
  }

  const article = await prisma.article.findFirst({ where: { id, userId: user.id, isDeleted: false } });
  if (!article) return NextResponse.json({ error: "文章不存在" }, { status: 404 });

  const paragraphs = article.content.split(/\n{2,}/).filter(Boolean);
  const hasPreciseLocation =
    Number.isInteger(paragraphIndex) &&
    Number.isInteger(startOffset) &&
    Number.isInteger(endOffset) &&
    paragraphIndex >= 0 &&
    paragraphIndex < paragraphs.length &&
    startOffset >= 0 &&
    endOffset > startOffset &&
    endOffset <= paragraphs[paragraphIndex].length;

  if (hasPreciseLocation) {
    const locatedText = paragraphs[paragraphIndex].slice(startOffset, endOffset).trim();
    if (locatedText.length >= 2) {
      highlightText = locatedText;
    }
  }

  const result = await prisma.$transaction(async (tx) => {
    const highlight = await tx.highlight.create({
      data: {
        userId: user.id,
        articleId: id,
        highlightText,
        paragraphIndex: hasPreciseLocation ? paragraphIndex : null,
        startOffset: hasPreciseLocation ? startOffset : null,
        endOffset: hasPreciseLocation ? endOffset : null
      }
    });
    const note = await tx.note.create({
      data: {
        userId: user.id,
        articleId: id,
        highlightId: highlight.id,
        noteType: noteType as keyof typeof NOTE_TYPE_LABELS
      }
    });
    if (article.readingStatus === "unread") {
      await tx.article.update({
        where: { id },
        data: { readingStatus: "reading" }
      });
    }
    return { highlight, note };
  });

  return NextResponse.json({ ok: true, ...result });
}
