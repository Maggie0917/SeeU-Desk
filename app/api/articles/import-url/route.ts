import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { detectSourcePlatform, parseArticleFromUrl, ParserError, type ParserDiagnostic } from "@/lib/services/parser";

function safeHostname(input: string) {
  try {
    return new URL(input).hostname.replace(/^www\./, "");
  } catch {
    return "unknown";
  }
}

function importLog(data: {
  requestId: string;
  routeStage: "request" | "parse" | "create_article" | "tags" | "ai_summary" | "response";
  hostname?: string;
  finalHost?: string;
  parserType?: string;
  httpStatus?: number;
  htmlLength?: number;
  extractedTextLength?: number;
  extractorUsed?: string;
  failureType?: string;
  failureReason?: string;
  containsJsContent?: boolean;
  selectorJsContentHit?: boolean;
  wechatExtractedTextLength?: number;
  wechatQualityFailureReason?: string;
  imageCount?: number;
  invalidReason?: string;
  platformShellFailure?: string | null;
}) {
  console.info("[import-url]", data);
}

function sanitizeLogText(value: string) {
  return value
    .replace(/(api[_-]?key|token|secret|password)=([^&\s]+)/gi, "$1=[redacted]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [redacted]")
    .replace(/sk-[A-Za-z0-9_-]{8,}/gi, "sk-[redacted]")
    .slice(0, 240);
}

function safeErrorReason(error: unknown) {
  if (error instanceof Error) return sanitizeLogText(error.message);
  return "未知错误";
}

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
  const requestId = crypto.randomUUID();
  const user = await requireUser();
  const body = await request.json().catch(() => ({}));
  const url = String(body.url ?? "").trim();
  const savePending = Boolean(body.savePending);

  if (!url) return NextResponse.json({ error: "请粘贴文章链接", requestId }, { status: 400 });
  try {
    const parsedUrl = new URL(url);
    if (!["http:", "https:"].includes(parsedUrl.protocol)) {
      return NextResponse.json({ error: "请粘贴 http 或 https 开头的文章链接", requestId }, { status: 400 });
    }
  } catch {
    return NextResponse.json({ error: "链接格式不正确，请粘贴完整文章链接", requestId }, { status: 400 });
  }
  const hostname = safeHostname(url);
  importLog({ requestId, routeStage: "request", hostname, parserType: detectSourcePlatform(url) });

  const existingArticle = await prisma.article.findFirst({
    where: { userId: user.id, sourceUrl: url, isDeleted: false },
    select: { id: true }
  });
  if (existingArticle) {
    importLog({ requestId, routeStage: "response", hostname, parserType: detectSourcePlatform(url) });
    return NextResponse.json({
      ok: true,
      existing: true,
      articleId: existingArticle.id,
      detailPath: `/article/${existingArticle.id}`,
      message: "文章已存在，正在打开已有文章",
      requestId,
      routeStage: "response"
    });
  }

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
    importLog({
      requestId,
      routeStage: "create_article",
      hostname,
      parserType: platform,
      failureType: diagnostic.failureType,
      failureReason,
      extractedTextLength: article.content.length
    });
    return NextResponse.json({
      ok: true,
      created: true,
      articleId: article.id,
      detailPath: `/article/${article.id}`,
      pending: true,
      diagnostic,
      message: "待处理链接已保存",
      requestId,
      routeStage: "response"
    });
  }

  try {
    const parsed = await parseArticleFromUrl(url);
    importLog({
      requestId,
      routeStage: "parse",
      hostname,
      finalHost: parsed.diagnostic.finalHost,
      parserType: parsed.diagnostic.platform,
      httpStatus: parsed.diagnostic.httpStatus,
      htmlLength: parsed.diagnostic.htmlLength,
      extractedTextLength: parsed.content.length,
      extractorUsed: parsed.diagnostic.extractorUsed,
      containsJsContent: parsed.diagnostic.containsJsContent,
      selectorJsContentHit: parsed.diagnostic.selectorJsContentHit,
      wechatExtractedTextLength: parsed.diagnostic.wechatExtractedTextLength,
      wechatQualityFailureReason: parsed.diagnostic.wechatQualityFailureReason,
      imageCount: parsed.diagnostic.imageCount,
      invalidReason: parsed.diagnostic.invalidReason,
      platformShellFailure: parsed.diagnostic.platformShellFailure
    });
    let article;
    try {
      article = await prisma.article.create({
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
    } catch (createError) {
      const failureReason = safeErrorReason(createError);
      const diagnostic = { ...parsed.diagnostic, success: false, failureType: "unknown" as const, failureReason: "正文已解析，但保存文章失败，请稍后重试。", routeStage: "create_article" };
      importLog({
        requestId,
        routeStage: "create_article",
        hostname,
        finalHost: parsed.diagnostic.finalHost,
        parserType: parsed.diagnostic.platform,
        httpStatus: parsed.diagnostic.httpStatus,
        htmlLength: parsed.diagnostic.htmlLength,
        extractedTextLength: parsed.content.length,
        extractorUsed: parsed.diagnostic.extractorUsed,
        failureType: "create_article_failed",
        failureReason,
        containsJsContent: parsed.diagnostic.containsJsContent,
        selectorJsContentHit: parsed.diagnostic.selectorJsContentHit,
        wechatExtractedTextLength: parsed.diagnostic.wechatExtractedTextLength,
        wechatQualityFailureReason: parsed.diagnostic.wechatQualityFailureReason,
        imageCount: parsed.diagnostic.imageCount,
        invalidReason: parsed.diagnostic.invalidReason,
        platformShellFailure: parsed.diagnostic.platformShellFailure
      });
      return NextResponse.json({ error: diagnostic.failureReason, fallbackRequired: true, diagnostic, requestId, routeStage: "create_article" }, { status: 500 });
    }
    importLog({
      requestId,
      routeStage: "create_article",
      hostname,
      finalHost: parsed.diagnostic.finalHost,
      parserType: parsed.diagnostic.platform,
      httpStatus: parsed.diagnostic.httpStatus,
      htmlLength: parsed.diagnostic.htmlLength,
      extractedTextLength: parsed.content.length,
      extractorUsed: parsed.diagnostic.extractorUsed,
      containsJsContent: parsed.diagnostic.containsJsContent,
      selectorJsContentHit: parsed.diagnostic.selectorJsContentHit,
      wechatExtractedTextLength: parsed.diagnostic.wechatExtractedTextLength,
      wechatQualityFailureReason: parsed.diagnostic.wechatQualityFailureReason,
      imageCount: parsed.diagnostic.imageCount,
      invalidReason: parsed.diagnostic.invalidReason,
      platformShellFailure: parsed.diagnostic.platformShellFailure
    });

    importLog({
      requestId,
      routeStage: "response",
      hostname,
      finalHost: parsed.diagnostic.finalHost,
      parserType: parsed.diagnostic.platform,
      extractedTextLength: parsed.content.length,
      extractorUsed: parsed.diagnostic.extractorUsed,
      containsJsContent: parsed.diagnostic.containsJsContent,
      selectorJsContentHit: parsed.diagnostic.selectorJsContentHit,
      wechatExtractedTextLength: parsed.diagnostic.wechatExtractedTextLength,
      wechatQualityFailureReason: parsed.diagnostic.wechatQualityFailureReason,
      imageCount: parsed.diagnostic.imageCount,
      invalidReason: parsed.diagnostic.invalidReason,
      platformShellFailure: parsed.diagnostic.platformShellFailure
    });
    return NextResponse.json({
      ok: true,
      created: true,
      articleId: article.id,
      detailPath: `/article/${article.id}`,
      message: "导入成功",
      enrichmentWarning: "文章已导入，AI 摘要和方法论可在文章页稍后生成。",
      diagnostic: { ...parsed.diagnostic, routeStage: "response" },
      requestId,
      routeStage: "response"
    });
  } catch (error) {
    const diagnostic: ParserDiagnostic = error instanceof ParserError
      ? error.diagnostic
      : {
          success: false,
          platform: detectSourcePlatform(url),
          failureType: "unknown" as const,
          failureReason: error instanceof Error ? error.message : "解析失败",
          routeStage: "response",
          fallbackOptions: ["manual_paste", "ocr", "save_pending"]
        };
    const routeStage = error instanceof ParserError ? "parse" : "response";
    const responseDiagnostic = { ...diagnostic, routeStage };
    importLog({
      requestId,
      routeStage,
      hostname,
      finalHost: diagnostic.finalHost,
      parserType: diagnostic.platform,
      httpStatus: diagnostic.httpStatus,
      htmlLength: diagnostic.htmlLength,
      extractedTextLength: diagnostic.contentLength,
      extractorUsed: diagnostic.extractorUsed,
      failureType: diagnostic.failureType,
      failureReason: diagnostic.failureReason,
      containsJsContent: diagnostic.containsJsContent,
      selectorJsContentHit: diagnostic.selectorJsContentHit,
      wechatExtractedTextLength: diagnostic.wechatExtractedTextLength,
      wechatQualityFailureReason: diagnostic.wechatQualityFailureReason,
      imageCount: diagnostic.imageCount,
      invalidReason: diagnostic.invalidReason,
      platformShellFailure: diagnostic.platformShellFailure
    });

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
      importLog({
        requestId,
        routeStage: "create_article",
        hostname,
        parserType: platform,
        failureType: diagnostic.failureType,
        failureReason,
        extractedTextLength: article.content.length
      });
      return NextResponse.json({
        ok: true,
        created: true,
        articleId: article.id,
        detailPath: `/article/${article.id}`,
        pending: true,
        diagnostic,
        message: "待处理链接已保存",
        requestId,
        routeStage: "response"
      });
    }

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "解析失败",
        fallbackRequired: true,
        diagnostic: responseDiagnostic,
        requestId,
        routeStage
      },
      { status: 422 }
    );
  }
}
