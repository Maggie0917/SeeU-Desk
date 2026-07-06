import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { applyRecommendedTags, enrichArticleWithAi } from "@/lib/articles";
import { detectSourcePlatform, parseArticleFromUrl, ParserError, type ParserDiagnostic } from "@/lib/services/parser";

function platformLabel(platform: ReturnType<typeof detectSourcePlatform>, url: string) {
  if (platform === "wechat_mp") return "mp.weixin.qq.com";
  if (platform === "xiaohongshu") return "xiaohongshu.com";
  if (platform === "douyin") return "douyin.com";
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "未知来源";
  }
}

export async function POST(request: Request) {
  const user = await requireUser();
  const body = await request.json().catch(() => ({}));
  const url = String(body.url ?? "").trim();
  const savePending = Boolean(body.savePending);

  if (!url) return NextResponse.json({ error: "请粘贴文章链接" }, { status: 400 });

  if (savePending && body.diagnostic) {
    const diagnostic = body.diagnostic as Partial<ParserDiagnostic>;
    const platform = diagnostic.platform || detectSourcePlatform(url);
    const title = String(diagnostic.title ?? "").trim() || `待补正文：${platformLabel(platform, url)}`;
    const failureReason = String(diagnostic.failureReason ?? "链接解析失败，等待补充正文。");
    const article = await prisma.article.create({
      data: {
        userId: user.id,
        title,
        sourceUrl: url,
        sourcePlatform: platformLabel(platform, url),
        content: `待补正文\n\n原链接：${url}\n失败原因：${failureReason}\n\n请通过手动粘贴正文或 OCR 补充正文后重新生成阅读内容。`,
        summary: `导入状态：待补正文\n失败类型：${diagnostic.failureType ?? "unknown"}\n失败原因：${failureReason}`,
        keywords: `import_failed_pending,${diagnostic.failureType ?? "unknown"}`,
        readingStatus: "unread",
        isInReadLater: true
      }
    });
    return NextResponse.json({ ok: true, articleId: article.id, pending: true, diagnostic });
  }

  try {
    const parsed = await parseArticleFromUrl(url);
    const article = await prisma.article.create({
      data: {
        userId: user.id,
        title: parsed.title,
        sourceUrl: url,
        sourcePlatform: parsed.sourcePlatform,
        authorName: parsed.authorName,
        content: parsed.content,
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

    return NextResponse.json({ ok: true, articleId: article.id, diagnostic: parsed.diagnostic });
  } catch (error) {
    const diagnostic: ParserDiagnostic = error instanceof ParserError
      ? error.diagnostic
      : {
          success: false,
          platform: detectSourcePlatform(url),
          failureType: "unknown" as const,
          failureReason: error instanceof Error ? error.message : "解析失败",
          fallbackOptions: ["manual_paste", "ocr", "save_pending"]
        };

    if (savePending) {
      const platform = diagnostic.platform || detectSourcePlatform(url);
      const title = String(diagnostic.title ?? "").trim() || `待补正文：${platformLabel(platform, url)}`;
      const failureReason = String(diagnostic.failureReason ?? "链接解析失败，等待补充正文。");
      const article = await prisma.article.create({
        data: {
          userId: user.id,
          title,
          sourceUrl: url,
          sourcePlatform: platformLabel(platform, url),
          content: `待补正文\n\n原链接：${url}\n失败原因：${failureReason}\n\n请通过手动粘贴正文或 OCR 补充正文后重新生成阅读内容。`,
          summary: `导入状态：待补正文\n失败类型：${diagnostic.failureType ?? "unknown"}\n失败原因：${failureReason}`,
          keywords: `import_failed_pending,${diagnostic.failureType ?? "unknown"}`,
          readingStatus: "unread",
          isInReadLater: true
        }
      });
      return NextResponse.json({ ok: true, articleId: article.id, pending: true, diagnostic });
    }

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "解析失败",
        fallbackRequired: true,
        diagnostic
      },
      { status: 422 }
    );
  }
}
