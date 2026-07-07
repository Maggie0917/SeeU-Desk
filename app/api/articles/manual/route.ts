import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { applyRecommendedTags, enrichArticleWithAi } from "@/lib/articles";
import { compactText } from "@/lib/text";

export async function POST(request: Request) {
  const user = await requireUser();
  const body = await request.json().catch(() => ({}));
  const title = String(body.title ?? "").trim() || "未命名文章";
  const content = compactText(String(body.content ?? ""));
  const sourcePlatform = String(body.sourcePlatform ?? "手动导入").trim() || "手动导入";
  const sourceUrl = String(body.sourceUrl ?? "").trim() || null;
  const importMethod = String(body.importMethod ?? "").trim();
  const authorName = String(body.authorName ?? "").trim() || null;

  if (content.length < 20) {
    return NextResponse.json({ error: "正文至少需要 20 个字符" }, { status: 400 });
  }

  const article = await prisma.article.create({
    data: {
      userId: user.id,
      title,
      content,
      sourcePlatform,
      sourceUrl,
      keywords: importMethod === "ocr" ? "import_method_ocr" : undefined,
      authorName,
      readingStatus: "unread",
      isInReadLater: true
    }
  });

  await applyRecommendedTags({
    userId: user.id,
    articleId: article.id,
    title: article.title,
    content: article.content
  });
  await enrichArticleWithAi({
    userId: user.id,
    articleId: article.id,
    title: article.title,
    content: article.content
  });

  return NextResponse.json({ ok: true, articleId: article.id });
}
