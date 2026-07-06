"use client";

import { FormEvent, MouseEvent, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { parseReportBlocks, type ReportBlock } from "@/lib/report-format";

type Tag = { id: string; name: string };
type ReportUnderline = {
  id: string;
  selectedText: string;
  blockIndex: number;
  startOffset: number;
  endOffset: number;
  createdAt: string;
};
type Report = {
  id: string;
  title: string;
  content: string;
  articleCount: number;
  timeRangeStart: string;
  timeRangeEnd: string;
  createdAt: string;
  isSyncedFeishu: boolean;
  feishuDocUrl: string | null;
  feishuSyncedAt: string | null;
  tag: Tag;
  underlines: ReportUnderline[];
  readingNote: { content: string; updatedAt: string } | null;
};

type SelectionToolbar = {
  reportId: string;
  blockIndex: number;
  startOffset: number;
  endOffset: number;
  selectedText: string;
  x: number;
  y: number;
} | null;

export function ReportsClient({ tags, reports }: { tags: Tag[]; reports: Report[] }) {
  const router = useRouter();
  const [content, setContent] = useState("");
  const [articleCount, setArticleCount] = useState(0);
  const [form, setForm] = useState({
    tagId: tags[0]?.id || "",
    start: new Date(Date.now() - 1000 * 60 * 60 * 24 * 30).toISOString().slice(0, 10),
    end: new Date().toISOString().slice(0, 10)
  });
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [selecting, setSelecting] = useState(false);
  const [selectedReportIds, setSelectedReportIds] = useState<string[]>([]);
  const selectedReportCount = selectedReportIds.length;

  async function generate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    const response = await fetch("/api/reports/generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...form, save: false })
    });
    const data = await response.json().catch(() => ({}));
    setLoading(false);
    if (!response.ok) {
      setMessage(data.error || "生成失败");
      return;
    }
    setContent(data.content);
    setArticleCount(data.articleCount);
    setMessage("报告已生成，确认后可以保存到历史报告");
  }

  async function saveReport() {
    setLoading(true);
    const response = await fetch("/api/reports/generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...form, save: true })
    });
    setLoading(false);
    setMessage(response.ok ? "报告已保存" : "保存失败");
    router.refresh();
  }

  async function deleteReport(reportId: string) {
    if (!window.confirm("确认删除这份洞察报告吗？删除后不会影响原文章和笔记。")) return;
    const response = await fetch(`/api/reports/${reportId}`, { method: "DELETE" });
    setMessage(response.ok ? "报告已删除" : "删除报告失败");
    router.refresh();
  }

  function toggleReport(reportId: string) {
    setSelectedReportIds((current) => current.includes(reportId) ? current.filter((id) => id !== reportId) : [...current, reportId]);
  }

  function cancelReportSelection() {
    setSelecting(false);
    setSelectedReportIds([]);
  }

  async function bulkDeleteReports() {
    if (!selectedReportCount) return;
    if (!window.confirm(`确认删除选中的 ${selectedReportCount} 份洞察报告吗？删除报告不会影响原文章和笔记。`)) return;
    const response = await fetch("/api/reports/bulk-delete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ids: selectedReportIds })
    });
    const data = await response.json().catch(() => ({}));
    setMessage(response.ok ? `已删除 ${data.count ?? selectedReportCount} 份洞察报告` : data.error || "批量删除报告失败");
    cancelReportSelection();
    router.refresh();
  }

  return (
    <div className="grid gap-5 xl:grid-cols-[420px_minmax(0,1fr)]">
      <section className="space-y-5">
        <form onSubmit={generate} className="card bg-paper">
          <h2 className="section-title">报告生成卡片</h2>
          <div className="mt-4 space-y-3">
            <div>
              <label className="label">选择标签</label>
              <select className="input" value={form.tagId} onChange={(event) => setForm({ ...form, tagId: event.target.value })}>
                {tags.map((tag) => <option key={tag.id} value={tag.id}>{tag.name}</option>)}
              </select>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="label">开始日期</label>
                <input className="input" type="date" value={form.start} onChange={(event) => setForm({ ...form, start: event.target.value })} />
              </div>
              <div>
                <label className="label">结束日期</label>
                <input className="input" type="date" value={form.end} onChange={(event) => setForm({ ...form, end: event.target.value })} />
              </div>
            </div>
            <button className="btn w-full" disabled={loading || !form.tagId}>{loading ? "生成中..." : "生成报告"}</button>
          </div>
          {message ? <div className="mt-4 rounded-md border border-sky/30 bg-white px-3 py-2 text-sm text-ink">{message}</div> : null}
        </form>

        <section className="card border-t-4 border-t-sky">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="section-title">历史报告</h2>
            <div className="flex flex-wrap items-center gap-2">
              <button className="btn-secondary min-h-8 px-3 py-1.5 text-xs" type="button" onClick={() => selecting ? cancelReportSelection() : setSelecting(true)}>
                {selecting ? "取消选择" : "选择"}
              </button>
              {selecting ? (
                <>
                  <span className="pill">已选择 {selectedReportCount} 项</span>
                  <button className="btn min-h-8 px-3 py-1.5 text-xs" type="button" disabled={!selectedReportCount} onClick={bulkDeleteReports}>批量删除</button>
                </>
              ) : null}
            </div>
          </div>
          <div className="mt-4 space-y-3">
            {reports.length ? reports.map((report) => (
              <div key={report.id} className="rounded-lg border border-line bg-white p-3 hover:border-leaf">
                {selecting ? (
                  <label className="mb-2 inline-flex items-center rounded-full bg-paper px-2 py-1 text-xs font-bold text-ink">
                    <input className="mr-1" type="checkbox" checked={selectedReportIds.includes(report.id)} onChange={() => toggleReport(report.id)} />
                    选择
                  </label>
                ) : null}
                <div className="font-bold text-ink">{report.title}</div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <span className="pill border-leaf bg-leaf text-white">{report.tag.name}</span>
                  <span className="pill">{new Date(report.timeRangeStart).toLocaleDateString("zh-CN")} - {new Date(report.timeRangeEnd).toLocaleDateString("zh-CN")}</span>
                  <span className="pill">{report.articleCount} 篇文章</span>
                  <span className="pill">{report.isSyncedFeishu ? "已同步飞书" : "未同步飞书"}</span>
                </div>
                <div className="mt-2 text-xs text-moss">生成于 {new Date(report.createdAt).toLocaleString("zh-CN")}</div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <a className="btn-secondary min-h-8 px-3 py-1.5 text-xs" href={`#report-${report.id}`}>查看</a>
                  <a className="btn-secondary min-h-8 px-3 py-1.5 text-xs" href={`#report-${report.id}`}>编辑</a>
                  <button className="btn-secondary min-h-8 px-3 py-1.5 text-xs" onClick={() => deleteReport(report.id)}>删除</button>
                </div>
              </div>
            )) : <div className="rounded-md border border-dashed border-line p-4 text-sm text-moss">暂无历史报告</div>}
          </div>
        </section>
      </section>

      <section className="space-y-5">
        {content ? (
          <div className="card border-t-4 border-t-leaf">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="section-title">新生成报告</h2>
                <p className="mt-1 text-sm text-moss">涉及 {articleCount} 篇文章</p>
              </div>
              <button className="btn" onClick={saveReport} disabled={loading}>保存报告</button>
            </div>
            <ReportReader reportId="preview" content={content} underlines={[]} readonly />
          </div>
        ) : null}

        {reports.map((report) => <ReportEditor key={report.id} report={report} onDelete={deleteReport} />)}
      </section>
    </div>
  );
}

function ReportEditor({ report, onDelete }: { report: Report; onDelete: (reportId: string) => Promise<void> }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(report.title);
  const [content, setContent] = useState(report.content);
  const [underlines, setUnderlines] = useState(report.underlines);
  const [note, setNote] = useState(report.readingNote?.content ?? "");
  const [saving, setSaving] = useState(false);
  const [noteStatus, setNoteStatus] = useState("");
  const [syncStatus, setSyncStatus] = useState("");

  async function save() {
    setSaving(true);
    const response = await fetch(`/api/reports/${report.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title, content })
    });
    setSaving(false);
    if (response.ok) {
      setEditing(false);
      router.refresh();
    }
  }

  function cancel() {
    setTitle(report.title);
    setContent(report.content);
    setEditing(false);
  }

  async function createUnderline(input: Omit<ReportUnderline, "id" | "createdAt">) {
    const response = await fetch(`/api/reports/${report.id}/underlines`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input)
    });
    const data = await response.json().catch(() => ({}));
    if (response.ok && data.underline) {
      setUnderlines((current) => [...current, {
        id: data.underline.id,
        selectedText: data.underline.selectedText,
        blockIndex: data.underline.blockIndex,
        startOffset: data.underline.startOffset,
        endOffset: data.underline.endOffset,
        createdAt: data.underline.createdAt
      }]);
    }
  }

  async function deleteUnderline(underlineId: string) {
    const response = await fetch(`/api/reports/${report.id}/underlines/${underlineId}`, { method: "DELETE" });
    if (response.ok) setUnderlines((current) => current.filter((item) => item.id !== underlineId));
  }

  async function clearUnderlines() {
    if (!underlines.length) return;
    if (!window.confirm("确认清除这份报告中的全部划线吗？")) return;
    const response = await fetch(`/api/reports/${report.id}/underlines`, { method: "DELETE" });
    if (response.ok) setUnderlines([]);
  }

  async function saveNote() {
    setNoteStatus("保存中...");
    const response = await fetch(`/api/reports/${report.id}/reading-note`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: note })
    });
    setNoteStatus(response.ok ? "已保存" : "保存失败");
  }

  async function syncFeishu(folderInput?: string, folderName?: string) {
    setSyncStatus("正在同步飞书...");
    const response = await fetch(`/api/reports/${report.id}/sync-feishu`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ folderInput, folderName })
    });
    const data = await response.json().catch(() => ({}));
    if (response.status === 409 && data.needsFolder) {
      const nextFolder = window.prompt("请输入洞察报告要同步到的飞书文件夹链接或 folder_token", "");
      if (!nextFolder) {
        setSyncStatus("已取消同步");
        return;
      }
      const nextName = window.prompt("请输入这个文件夹的展示名称", "洞察报告") || "洞察报告";
      await syncFeishu(nextFolder, nextName);
      return;
    }
    if (response.ok) {
      setSyncStatus(data.warning || "已同步飞书");
      router.refresh();
    } else {
      setSyncStatus(data.error || "洞察报告同步飞书失败");
    }
  }

  return (
    <article id={`report-${report.id}`} className="card scroll-mt-6 border-t-4 border-t-sky">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          {editing ? (
            <input className="input text-lg font-bold" value={title} onChange={(event) => setTitle(event.target.value)} />
          ) : (
            <h2 className="section-title">{report.title}</h2>
          )}
          <div className="mt-2 flex flex-wrap gap-2">
            <span className="pill border-leaf bg-leaf text-white">{report.tag.name}</span>
            <span className="pill">{report.articleCount} 篇文章</span>
            <span className="pill">{report.isSyncedFeishu ? "已同步飞书" : "未同步飞书"}</span>
            {report.feishuDocUrl ? <a className="pill border-sky bg-white text-sky" href={report.feishuDocUrl} target="_blank">打开飞书文档</a> : null}
          </div>
        </div>
        <span className="pill">{new Date(report.createdAt).toLocaleDateString("zh-CN")}</span>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        {editing ? (
          <>
            <button className="btn" onClick={save} disabled={saving}>{saving ? "保存中..." : "保存修改"}</button>
            <button className="btn-secondary" onClick={cancel}>取消编辑</button>
          </>
        ) : (
          <button className="btn-secondary" onClick={() => setEditing(true)}>编辑报告</button>
        )}
        <a className="btn-secondary" href={`/api/reports/${report.id}/export?format=markdown`}>导出 Markdown</a>
        <a className="btn-secondary" href={`/api/reports/${report.id}/export?format=docx`}>导出 Word</a>
        <a className="btn-secondary" href={`/api/reports/${report.id}/export?format=pdf`} target="_blank">导出 PDF</a>
        <button className="btn-secondary" onClick={() => void syncFeishu()}>同步飞书</button>
        <button className="btn-secondary" onClick={clearUnderlines} disabled={!underlines.length}>清除全部划线</button>
        <button className="btn-secondary" onClick={() => onDelete(report.id)}>删除报告</button>
      </div>
      {syncStatus ? <div className="mt-3 rounded-md border border-sky/30 bg-paper px-3 py-2 text-sm text-ink">{syncStatus}</div> : null}
      {editing ? (
        <textarea className="input mt-5 min-h-[420px] font-mono leading-6" value={content} onChange={(event) => setContent(event.target.value)} />
      ) : (
        <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
          <ReportReader reportId={report.id} content={report.content} underlines={underlines} onCreateUnderline={createUnderline} onDeleteUnderline={deleteUnderline} />
          <aside className="rounded-xl border border-sky/20 bg-paper p-4 lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto">
            <h3 className="text-lg font-black text-ink">随手笔记</h3>
            <p className="mt-1 text-xs text-moss">只属于当前洞察报告，不进入全局笔记库。</p>
            <textarea className="input mt-4 min-h-64 leading-6" value={note} onChange={(event) => {
              setNote(event.target.value);
              setNoteStatus("");
            }} placeholder="写下阅读这份报告时的想法、追问或下一步行动。" />
            <div className="mt-3 flex items-center gap-3">
              <button className="btn" onClick={saveNote}>保存笔记</button>
              {noteStatus ? <span className="text-sm text-moss">{noteStatus}</span> : null}
            </div>
          </aside>
        </div>
      )}
    </article>
  );
}

function getTextOffset(root: HTMLElement, target: Node, offset: number) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let total = 0;
  let node = walker.nextNode();
  while (node) {
    if (node === target) return total + offset;
    total += node.textContent?.length ?? 0;
    node = walker.nextNode();
  }
  return total;
}

function ReportReader({
  reportId,
  content,
  underlines,
  readonly = false,
  onCreateUnderline,
  onDeleteUnderline
}: {
  reportId: string;
  content: string;
  underlines: ReportUnderline[];
  readonly?: boolean;
  onCreateUnderline?: (input: Omit<ReportUnderline, "id" | "createdAt">) => Promise<void>;
  onDeleteUnderline?: (underlineId: string) => Promise<void>;
}) {
  const blocks = useMemo(() => parseReportBlocks(content), [content]);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [toolbar, setToolbar] = useState<SelectionToolbar>(null);
  const [toast, setToast] = useState("");

  function showToast(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(""), 1800);
  }

  function handleMouseUp() {
    if (readonly || !onCreateUnderline) return;
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !selection.rangeCount) {
      setToolbar(null);
      return;
    }
    const range = selection.getRangeAt(0);
    const startElement = range.startContainer.parentElement?.closest<HTMLElement>("[data-report-block]");
    const endElement = range.endContainer.parentElement?.closest<HTMLElement>("[data-report-block]");
    if (!startElement || !endElement || startElement !== endElement) {
      setToolbar(null);
      return;
    }
    const selectedText = selection.toString().trim();
    if (!selectedText) {
      setToolbar(null);
      return;
    }
    const blockIndex = Number(startElement.dataset.reportBlock);
    const startOffset = getTextOffset(startElement, range.startContainer, range.startOffset);
    const endOffset = getTextOffset(startElement, range.endContainer, range.endOffset);
    const rect = range.getBoundingClientRect();
    setToolbar({
      reportId,
      blockIndex,
      startOffset: Math.min(startOffset, endOffset),
      endOffset: Math.max(startOffset, endOffset),
      selectedText,
      x: Math.min(Math.max(rect.left + rect.width / 2, 80), window.innerWidth - 120),
      y: Math.max(rect.top - 48, 12)
    });
  }

  async function createUnderline() {
    if (!toolbar || !onCreateUnderline) return;
    await onCreateUnderline({
      selectedText: toolbar.selectedText,
      blockIndex: toolbar.blockIndex,
      startOffset: toolbar.startOffset,
      endOffset: toolbar.endOffset
    });
    window.getSelection()?.removeAllRanges();
    setToolbar(null);
  }

  return (
    <div className="relative">
      {toolbar ? (
        <button
          type="button"
          className="fixed z-50 rounded-full bg-leaf px-3 py-2 text-xs font-bold text-white shadow-lg"
          style={{ left: toolbar.x, top: toolbar.y, transform: "translateX(-50%)" }}
          onMouseDown={(event) => event.preventDefault()}
          onClick={createUnderline}
        >
          红线划线
        </button>
      ) : null}
      {toast ? (
        <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-full bg-ink px-4 py-2 text-sm font-bold text-white shadow-lg">
          {toast}
        </div>
      ) : null}
      <div ref={rootRef} onMouseUp={handleMouseUp} className="rounded-xl border border-line bg-white px-5 py-6">
        <div className="space-y-4">
          {blocks.map((block) => (
            <ReportBlockView
              key={`${block.index}-${block.type}`}
              block={block}
              underlines={underlines.filter((item) => item.blockIndex === block.index)}
              onDeleteUnderline={onDeleteUnderline}
              onToast={showToast}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function ReportBlockView({
  block,
  underlines,
  onDeleteUnderline,
  onToast
}: {
  block: ReportBlock;
  underlines: ReportUnderline[];
  onDeleteUnderline?: (underlineId: string) => Promise<void>;
  onToast?: (message: string) => void;
}) {
  const children = renderUnderlinedText(block.text, underlines, onDeleteUnderline, onToast);
  const commonProps = { "data-report-block": block.index };

  if (block.type === "heading") {
    if (block.level === 1) return <h1 {...commonProps} className="pt-3 text-2xl font-black leading-tight text-ink">{children}</h1>;
    if (block.level === 2) return <h2 {...commonProps} className="pt-2 text-xl font-extrabold leading-snug text-ink">{children}</h2>;
    return <h3 {...commonProps} className="pt-1 text-lg font-bold leading-snug text-ink">{children}</h3>;
  }
  if (block.type === "list") {
    return <p {...commonProps} className="pl-4 text-[15px] leading-8 text-moss before:mr-2 before:text-leaf before:content-['•']">{children}</p>;
  }
  return <p {...commonProps} className="whitespace-pre-wrap text-[15px] leading-8 text-moss">{children}</p>;
}

async function copyTextWithFallback(text: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  document.body.removeChild(textarea);
}

function ReportUnderlineText({
  underline,
  children,
  onDeleteUnderline,
  onToast
}: {
  underline: ReportUnderline;
  children: string;
  onDeleteUnderline?: (underlineId: string) => Promise<void>;
  onToast?: (message: string) => void;
}) {
  const clickTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (clickTimerRef.current) window.clearTimeout(clickTimerRef.current);
    };
  }, []);

  function clearClickTimer() {
    if (clickTimerRef.current) {
      window.clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
    }
  }

  function handleClick(event: MouseEvent) {
    event.stopPropagation();
    event.preventDefault();
    if (clickTimerRef.current) {
      clearClickTimer();
      return;
    }

    clickTimerRef.current = window.setTimeout(() => {
      clickTimerRef.current = null;
      void copyTextWithFallback(underline.selectedText).then(() => {
        onToast?.("✔ 已复制划线内容");
      }).catch(() => {
        onToast?.("复制失败，请手动选择复制");
      });
    }, 280);
  }

  function handleDoubleClick(event: MouseEvent) {
    event.stopPropagation();
    event.preventDefault();
    clearClickTimer();
    void onDeleteUnderline?.(underline.id).then(() => {
      onToast?.("✔ 已取消划线");
    });
  }

  return (
    <span
      className="cursor-pointer decoration-[#FD6D2E] decoration-2 underline underline-offset-4"
      title="单击复制，双击取消划线"
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
    >
      {children}
    </span>
  );
}

function renderUnderlinedText(
  text: string,
  underlines: ReportUnderline[],
  onDeleteUnderline?: (underlineId: string) => Promise<void>,
  onToast?: (message: string) => void
) {
  const ranges = underlines
    .map((item) => ({
      ...item,
      startOffset: Math.max(0, Math.min(item.startOffset, text.length)),
      endOffset: Math.max(0, Math.min(item.endOffset, text.length))
    }))
    .filter((item) => item.startOffset < item.endOffset)
    .sort((a, b) => a.startOffset - b.startOffset);

  if (!ranges.length) return text;

  const parts: ReactNode[] = [];
  let cursor = 0;
  ranges.forEach((range) => {
    if (range.startOffset < cursor) return;
    if (range.startOffset > cursor) parts.push(text.slice(cursor, range.startOffset));
    parts.push(
      <ReportUnderlineText
        key={range.id}
        underline={range}
        onDeleteUnderline={onDeleteUnderline}
        onToast={onToast}
      >
        {text.slice(range.startOffset, range.endOffset)}
      </ReportUnderlineText>
    );
    cursor = range.endOffset;
  });
  if (cursor < text.length) parts.push(text.slice(cursor));
  return parts;
}
