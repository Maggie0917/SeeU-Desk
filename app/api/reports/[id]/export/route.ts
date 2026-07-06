import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { buildReportDocx } from "@/lib/docx-export";
import { prisma } from "@/lib/prisma";
import { buildReportExportMarkdown, parseReportBlocks, safeExportFileName } from "@/lib/report-format";

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildPrintableHtml(input: {
  title: string;
  createdAt: Date;
  tagName: string;
  content: string;
  underlines: Array<{ selectedText: string }>;
  readingNote: string;
}) {
  const body = parseReportBlocks(input.content).map((block) => {
    const text = escapeHtml(block.text);
    if (block.type === "heading") return `<h${Math.min(block.level + 1, 3)}>${text}</h${Math.min(block.level + 1, 3)}>`;
    if (block.type === "list") return `<li>${text}</li>`;
    return `<p>${text}</p>`;
  }).join("\n");
  const underlines = input.underlines.length
    ? `<ol>${input.underlines.map((item) => `<li>${escapeHtml(item.selectedText)}</li>`).join("")}</ol>`
    : "<p>暂无划线摘录。</p>";
  const note = input.readingNote.trim() ? escapeHtml(input.readingNote).replace(/\n/g, "<br/>") : "暂无随手笔记。";

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(input.title)}</title>
  <style>
    body { margin: 0; background: #fff; color: #25313a; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    main { max-width: 860px; margin: 0 auto; padding: 42px 28px 72px; }
    h1 { font-size: 30px; line-height: 1.3; margin: 0 0 16px; }
    h2 { font-size: 24px; margin: 34px 0 14px; }
    h3 { font-size: 20px; margin: 26px 0 12px; }
    p, li { font-size: 15px; line-height: 1.85; }
    .meta { color: #60717b; border-bottom: 1px solid #e8edf0; padding-bottom: 18px; margin-bottom: 28px; }
    .toolbar { position: sticky; top: 0; background: #fff7e6; border-bottom: 1px solid #e8edf0; padding: 12px 20px; text-align: right; }
    button { border: 0; border-radius: 8px; background: #fd6d2e; color: #fff; padding: 10px 14px; font-weight: 700; cursor: pointer; }
    @media print { .toolbar { display: none; } main { max-width: none; padding: 0; } }
  </style>
</head>
<body>
  <div class="toolbar"><button onclick="window.print()">打印 / 保存为 PDF</button></div>
  <main>
    <h1>${escapeHtml(input.title)}</h1>
    <div class="meta">
      <div>生成时间：${input.createdAt.toLocaleString("zh-CN")}</div>
      <div>关联标签 / 主题：${escapeHtml(input.tagName)}</div>
    </div>
    <h2>一、洞察报告正文</h2>
    ${body || "<p>暂无报告正文。</p>"}
    <h2>二、报告内划线摘录</h2>
    ${underlines}
    <h2>三、随手笔记</h2>
    <p>${note}</p>
  </main>
</body>
</html>`;
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await context.params;
  const { searchParams } = new URL(request.url);
  const format = searchParams.get("format") || "markdown";

  const report = await prisma.report.findFirst({
    where: { id, userId: user.id },
    include: {
      tag: true,
      underlines: { orderBy: { createdAt: "asc" } },
      readingNote: true
    }
  });
  if (!report) return NextResponse.json({ error: "报告不存在" }, { status: 404 });

  const exportInput = {
    title: report.title,
    content: report.content,
    tagName: report.tag.name,
    createdAt: report.createdAt,
    underlines: report.underlines,
    readingNote: report.readingNote?.content ?? ""
  };

  if (format === "docx") {
    const buffer = buildReportDocx(exportInput);
    return new Response(buffer, {
      headers: {
        "content-type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(safeExportFileName(report.title, "docx"))}`
      }
    });
  }

  if (format === "pdf") {
    return new Response(buildPrintableHtml({
      title: report.title,
      createdAt: report.createdAt,
      tagName: report.tag.name,
      content: report.content,
      underlines: report.underlines,
      readingNote: report.readingNote?.content ?? ""
    }), {
      headers: { "content-type": "text/html; charset=utf-8" }
    });
  }

  const markdown = buildReportExportMarkdown(exportInput);
  return new Response(markdown, {
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(safeExportFileName(report.title, "md"))}`
    }
  });
}
