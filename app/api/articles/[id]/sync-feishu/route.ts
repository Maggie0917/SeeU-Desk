import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  buildFallbackParagraphBlocks,
  buildFeishuDocumentContent,
  buildStructuredFeishuBlocks,
  createFeishuDocument,
  FeishuError,
  getFeishuTokenDiagnostic,
  isLikelyFeishuFolderToken,
  markFeishuSyncFailed,
  parseFeishuFolderToken,
  redactFeishuDebug
} from "@/lib/services/feishu";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await context.params;
  const body = await request.json().catch(() => ({}));
  const folderName = String(body.folderName ?? "").trim();
  const folderInput = String(body.folderToken ?? body.folderInput ?? "").trim();
  const folderToken = parseFeishuFolderToken(folderInput);

  const article = await prisma.article.findFirst({
    where: { id, userId: user.id, isDeleted: false },
    include: {
      articleTags: { include: { tag: { include: { folderMapping: true } } } },
      notes: { include: { highlight: true } }
    }
  });
  if (!article) return NextResponse.json({ error: "文章不存在" }, { status: 404 });

  const tokenStatus = await getFeishuTokenDiagnostic(user.id);
  if (!tokenStatus.ok) {
    return NextResponse.json(
      {
        error: tokenStatus.message || "飞书授权已失效，请重新连接飞书后再同步。",
        stage: "token_validation",
        tokenStatus
      },
      { status: 401 }
    );
  }

  const primary = article.articleTags.find((item) => item.tagRole === "primary")?.tag;
  if (!primary) return NextResponse.json({ error: "请先设置主标签" }, { status: 400 });

  let mapping = primary.folderMapping;
  if (!mapping) {
    if (!folderName) {
      return NextResponse.json(
        { error: "首次同步该主标签时需要填写飞书文件夹链接或 folder_token", needsFolder: true, tagName: primary.name },
        { status: 409 }
      );
    }
    if (!folderToken) {
      return NextResponse.json({ error: "请输入飞书文件夹链接或有效 folder_token。不能只填写文件夹名称。飞书 API 需要文件夹 token。" }, { status: 400 });
    }
    mapping = await prisma.tagFeishuFolderMapping.create({
      data: {
        userId: user.id,
        tagId: primary.id,
        feishuFolderToken: folderToken,
        feishuFolderName: folderName
      }
    });
  }

  const parsedMappingToken = parseFeishuFolderToken(mapping.feishuFolderToken);
  if (!parsedMappingToken || !isLikelyFeishuFolderToken(parsedMappingToken)) {
    return NextResponse.json(
      {
        error: "当前标签的飞书文件夹位置不是有效 folder_token，请重新填写飞书文件夹链接或 folder_token。",
        needsFolder: true,
        tagName: primary.name
      },
      { status: 409 }
    );
  }

  const tagNames = article.articleTags.map((item) => item.tag.name);
  const buildInput = {
    articleTitle: article.title,
    sourceUrl: article.sourceUrl,
    sourcePlatform: article.sourcePlatform,
    tags: tagNames,
    summary: article.summary,
    notes: article.notes,
    methodologyAndInsights: article.methodologyAndInsights,
    methodologySummary: article.methodologySummary,
    myOpinion: article.myOpinion,
    reusableInsights: article.reusableInsights
  };
  const blocks = buildStructuredFeishuBlocks(buildInput);
  const outlineFallbackBlocks = buildFallbackParagraphBlocks(buildInput);
  const content = buildFeishuDocumentContent(buildInput);

  try {
    const synced = await createFeishuDocument({
      userId: user.id,
      articleId: article.id,
      title: article.title,
      folderToken: parsedMappingToken,
      blocks,
      outlineFallbackBlocks,
      fallbackContent: content
    });

    await prisma.tagFeishuFolderMapping.update({
      where: { tagId: primary.id },
      data: { lastSyncedAt: new Date() }
    });

    return NextResponse.json({
      ok: true,
      url: synced.url,
      folderName: mapping.feishuFolderName,
      contentSynced: synced.contentSynced,
      warning: synced.warning,
      syncStatus: synced.contentSynced ? "synced" : "content_failed"
    });
  } catch (error) {
    await markFeishuSyncFailed(user.id, article.id);
    const isFeishuError = error instanceof FeishuError;
    return NextResponse.json(
      {
        error: error instanceof Error
          ? error.message
          : "飞书同步失败：请检查授权状态 / 文件夹权限 / API 配置。",
        stage: isFeishuError ? error.stage : undefined,
        feishuResponse: isFeishuError ? redactFeishuDebug(error.raw) : undefined
      },
      { status: 502 }
    );
  }
}
