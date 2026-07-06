export type ReportBlock =
  | { type: "heading"; level: 1 | 2 | 3; text: string; index: number }
  | { type: "paragraph"; text: string; index: number }
  | { type: "list"; ordered: boolean; text: string; index: number };

export type ReportExportInput = {
  title: string;
  content: string;
  tagName?: string | null;
  createdAt?: Date | string | null;
  underlines?: Array<{ selectedText: string }>;
  readingNote?: string | null;
};

export function cleanReportMarkdown(content: string) {
  return content
    .replace(/\r\n/g, "\n")
    .replace(/```[\s\S]*?```/g, (match) => match.replace(/```[a-zA-Z]*\n?/g, "").replace(/```/g, ""))
    .replace(/^(\s*#{1,6})\s*\*\*([^*\n]+)\*\*\s*$/gm, "$1 $2")
    .replace(/\*\*([^*\n]+)\*\*/g, "$1")
    .replace(/__([^_\n]+)__/g, "$1")
    .replace(/\*{2,}/g, "")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^\s*>\s?/gm, "")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function cleanLineText(line: string) {
  return cleanReportMarkdown(line)
    .replace(/^\s{0,3}#{1,6}\s*/, "")
    .replace(/^\s*[-*+]\s+/, "")
    .trim();
}

function headingLevelFromLine(line: string): 1 | 2 | 3 | null {
  const trimmed = line.trim();
  if (/^#{1,6}\s+/.test(trimmed)) {
    const level = Math.min((trimmed.match(/^#+/)?.[0].length ?? 1), 3) as 1 | 2 | 3;
    return level;
  }
  if (/^[一二三四五六七八九十]+、/.test(trimmed)) return 1;
  if (/^\d+[.、]\s*(本期阅读概览|高频关键词|主要趋势|代表文章|可复用方法论|我的观点沉淀|后续值得追踪的问题)/.test(trimmed)) return 2;
  if (/^[（(]?\d+[）).、]\s*[^。！？!?]{2,40}$/.test(trimmed)) return 2;
  return null;
}

function isListLine(line: string) {
  return /^\s*(?:[-*+]\s+|\d+[.、）)]\s+)/.test(line);
}

export function parseReportBlocks(content: string): ReportBlock[] {
  const cleaned = cleanReportMarkdown(content);
  const blocks: ReportBlock[] = [];
  let paragraph: string[] = [];

  function pushParagraph() {
    const text = paragraph.join("\n").trim();
    if (text) blocks.push({ type: "paragraph", text, index: blocks.length });
    paragraph = [];
  }

  for (const rawLine of cleaned.split("\n")) {
    const line = rawLine.trim();
    if (!line) {
      pushParagraph();
      continue;
    }

    const level = headingLevelFromLine(line);
    if (level) {
      pushParagraph();
      blocks.push({ type: "heading", level, text: cleanLineText(line), index: blocks.length });
      continue;
    }

    if (isListLine(line)) {
      pushParagraph();
      const ordered = /^\s*\d+[.、）)]/.test(line);
      blocks.push({
        type: "list",
        ordered,
        text: cleanLineText(line.replace(/^\s*(?:[-*+]\s+|\d+[.、）)]\s*)/, "")),
        index: blocks.length
      });
      continue;
    }

    paragraph.push(cleanLineText(line));
  }

  pushParagraph();
  return blocks.map((block, index) => ({ ...block, index }));
}

export function getReportPlainText(content: string) {
  return parseReportBlocks(content).map((block) => block.text).join("\n\n");
}

export function formatReportDate(value?: Date | string | null) {
  if (!value) return "-";
  return new Date(value).toLocaleString("zh-CN");
}

export function safeExportFileName(title: string, extension: string) {
  const base = cleanLineText(title || "洞察报告")
    .replace(/[\\/:*?"<>|]/g, "")
    .replace(/\s+/g, "-")
    .slice(0, 60) || "洞察报告";
  const date = new Date().toISOString().slice(0, 10);
  return `${base}-${date}.${extension}`;
}

export function buildReportExportMarkdown(input: ReportExportInput) {
  const underlineLines = input.underlines?.length
    ? input.underlines.map((item, index) => `${index + 1}. ${cleanLineText(item.selectedText)}`).join("\n")
    : "暂无划线摘录。";
  const readingNote = cleanReportMarkdown(input.readingNote || "") || "暂无随手笔记。";
  const body = parseReportBlocks(input.content)
    .map((block) => {
      if (block.type === "heading") return `${"#".repeat(block.level + 1)} ${block.text}`;
      if (block.type === "list") return `${block.ordered ? "1." : "-"} ${block.text}`;
      return block.text;
    })
    .join("\n\n");

  return [
    `# ${cleanLineText(input.title || "洞察报告")}`,
    "",
    `生成时间：${formatReportDate(input.createdAt)}`,
    `关联标签 / 主题：${input.tagName || "-"}`,
    "",
    "## 一、洞察报告正文",
    "",
    body || "暂无报告正文。",
    "",
    "## 二、报告内划线摘录",
    "",
    underlineLines,
    "",
    "## 三、随手笔记",
    "",
    readingNote
  ].join("\n");
}
