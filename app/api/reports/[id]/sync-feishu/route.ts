import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { buildReportExportMarkdown, parseReportBlocks } from "@/lib/report-format";
import {
  createDividerBlock,
  createHeading1Block,
  createHeading2Block,
  createHeading3Block,
  createOrderedListBlock,
  createParagraphBlock,
  createStandaloneFeishuDocument,
  FeishuError,
  getFeishuTokenDiagnostic,
  isLikelyFeishuFolderToken,
  parseFeishuFolderToken,
  redactFeishuDebug,
  type FeishuBlock
} from "@/lib/services/feishu";

function pushParagraphs(blocks: FeishuBlock[], text?: string | null) {
  const lines = (text || "").split(/\n+/).map((line) => line.trim()).filter(Boolean);
  if (!lines.length) return;
  lines.forEach((line) => blocks.push(createParagraphBlock(line)));
}

function buildReportFeishuBlocks(input: {
  title: string;
  tagName: string;
  createdAt: Date;
  content: string;
  underlines: Array<{ selectedText: string }>;
  readingNote?: string | null;
  syncedAt: Date;
  useAdvancedBlocks?: boolean;
}) {
  const advanced = input.useAdvancedBlocks ?? true;
  const blocks: FeishuBlock[] = [];
  const h1 = advanced ? createHeading1Block : createParagraphBlock;
  const h2 = advanced ? createHeading2Block : createParagraphBlock;
  const h3 = advanced ? createHeading3Block : createParagraphBlock;
  const ordered = advanced ? createOrderedListBlock : createParagraphBlock;

  blocks.push(createParagraphBlock(`报告生成时间：${input.createdAt.toLocaleString("zh-CN")}`));
  blocks.push(createParagraphBlock(`关联标签 / 主题：${input.tagName}`));
  blocks.push(createParagraphBlock(`同步时间：${input.syncedAt.toLocaleString("zh-CN")}`));
  blocks.push(advanced ? createDividerBlock() : createParagraphBlock("────────────"));

  blocks.push(h1("一、洞察报告正文"));
  for (const block of parseReportBlocks(input.content)) {
    if (block.type === "heading") {
      blocks.push(block.level === 1 ? h2(block.text) : block.level === 2 ? h3(block.text) : createParagraphBlock(block.text));
    } else if (block.type === "list") {
      blocks.push(block.ordered ? ordered(block.text) : createParagraphBlock(`· ${block.text}`));
    } else {
      pushParagraphs(blocks, block.text);
    }
  }

  blocks.push(h1("二、报告内划线摘录"));
  if (input.underlines.length) {
    input.underlines.forEach((item, index) => {
      blocks.push(advanced ? createOrderedListBlock(item.selectedText) : createParagraphBlock(`${index + 1}. ${item.selectedText}`));
    });
  } else {
    blocks.push(createParagraphBlock("暂无划线摘录。"));
  }

  blocks.push(h1("三、随手笔记"));
  pushParagraphs(blocks, input.readingNote?.trim() || "暂无随手笔记。");

  return blocks.slice(0, 200);
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await context.params;
  const body = await request.json().catch(() => ({}));
  const folderName = String(body.folderName ?? "洞察报告").trim() || "洞察报告";
  const folderInput = String(body.folderToken ?? body.folderInput ?? "").trim();
  const bodyFolderToken = parseFeishuFolderToken(folderInput);

  const report = await prisma.report.findFirst({
    where: { id, userId: user.id },
    include: {
      tag: { include: { folderMapping: true } },
      underlines: { orderBy: { createdAt: "asc" } },
      readingNote: true
    }
  });
  if (!report) return NextResponse.json({ error: "报告不存在" }, { status: 404 });

  const tokenStatus = await getFeishuTokenDiagnostic(user.id);
  if (!tokenStatus.ok) {
    return NextResponse.json({ error: tokenStatus.message || "飞书授权已失效，请重新连接飞书后再同步。", stage: "token_validation" }, { status: 401 });
  }

  const settings = await prisma.userSettings.findUnique({ where: { userId: user.id } });
  const tagFolderToken = parseFeishuFolderToken(report.tag.folderMapping?.feishuFolderToken || "");
  const savedReportFolderToken = parseFeishuFolderToken(settings?.reportFeishuFolderToken || "");
  const folderToken = tagFolderToken && isLikelyFeishuFolderToken(tagFolderToken)
    ? tagFolderToken
    : savedReportFolderToken && isLikelyFeishuFolderToken(savedReportFolderToken)
      ? savedReportFolderToken
      : bodyFolderToken && isLikelyFeishuFolderToken(bodyFolderToken)
        ? bodyFolderToken
        : null;

  if (!folderToken) {
    return NextResponse.json({
      error: "请填写洞察报告要同步到的飞书文件夹链接或 folder_token。",
      needsFolder: true
    }, { status: 409 });
  }

  if (bodyFolderToken && isLikelyFeishuFolderToken(bodyFolderToken)) {
    await prisma.userSettings.upsert({
      where: { userId: user.id },
      update: {
        reportFeishuFolderToken: bodyFolderToken,
        reportFeishuFolderName: folderName
      },
      create: {
        userId: user.id,
        reportFeishuFolderToken: bodyFolderToken,
        reportFeishuFolderName: folderName
      }
    });
  }

  const syncedAt = new Date();
  const blockInput = {
    title: report.title,
    tagName: report.tag.name,
    createdAt: report.createdAt,
    content: report.content,
    underlines: report.underlines,
    readingNote: report.readingNote?.content ?? "",
    syncedAt
  };
  const fallbackContent = buildReportExportMarkdown({
    title: report.title,
    content: report.content,
    tagName: report.tag.name,
    createdAt: report.createdAt,
    underlines: report.underlines,
    readingNote: report.readingNote?.content ?? ""
  });

  try {
    const synced = await createStandaloneFeishuDocument({
      userId: user.id,
      title: report.title,
      folderToken,
      blocks: buildReportFeishuBlocks({ ...blockInput, useAdvancedBlocks: true }),
      outlineFallbackBlocks: buildReportFeishuBlocks({ ...blockInput, useAdvancedBlocks: false }),
      fallbackContent
    });

    await prisma.report.update({
      where: { id },
      data: {
        feishuDocToken: synced.token,
        feishuDocUrl: synced.url,
        feishuSyncedAt: syncedAt,
        isSyncedFeishu: synced.contentSynced
      }
    });

    return NextResponse.json({
      ok: true,
      url: synced.url,
      contentSynced: synced.contentSynced,
      warning: synced.warning,
      folderName: report.tag.folderMapping?.feishuFolderName || settings?.reportFeishuFolderName || folderName
    });
  } catch (error) {
    const isFeishuError = error instanceof FeishuError;
    return NextResponse.json({
      error: error instanceof Error ? error.message : "洞察报告同步飞书失败。",
      stage: isFeishuError ? error.stage : undefined,
      feishuResponse: isFeishuError ? redactFeishuDebug(error.raw) : undefined
    }, { status: 502 });
  }
}
