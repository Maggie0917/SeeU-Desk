import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { applyRecommendedTags, enrichArticleWithAi } from "@/lib/articles";
import { databaseUnavailableBody, isDatabaseUnavailableError, withDbRetry } from "@/lib/db-with-retry";
import { compactText } from "@/lib/text";

async function handlePost(request: Request) {
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

  const article = await withDbRetry(() => prisma.article.create({
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
  }));

  try {
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
  } catch {
    return NextResponse.json({
      ok: true,
      articleId: article.id,
      enrichmentWarning: "文章已导入，AI 摘要和方法论可在文章页稍后生成。"
    });
  }

  return NextResponse.json({ ok: true, articleId: article.id });
}

export async function POST(request: Request) {
  try {
    return await handlePost(request);
  } catch (error) {
    if (isDatabaseUnavailableError(error)) return NextResponse.json(databaseUnavailableBody(), { status: 503 });
    throw error;
  }
}
