"use client";

import { useRouter } from "next/navigation";
import type React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArticleActions } from "@/components/ArticleActions";
import { NOTE_TYPE_LABELS, READING_STATUS_LABELS } from "@/lib/constants";

type Tag = { id: string; name: string };
type NoteType = keyof typeof NOTE_TYPE_LABELS;
type Article = {
  id: string;
  title: string;
  sourceUrl: string | null;
  sourcePlatform: string | null;
  content: string;
  summary: string | null;
  methodologySummary: string | null;
  reusableInsights: string | null;
  methodologyAndInsights: string | null;
  myOpinion: string | null;
  readingStatus: keyof typeof READING_STATUS_LABELS;
  isStarred: boolean;
  isInReadLater: boolean;
  feishuDoc: { syncStatus: string; feishuDocUrl: string | null } | null;
  articleTags: Array<{ tagRole: "primary" | "secondary"; tag: Tag }>;
  notes: Array<{
    id: string;
    noteType: NoteType;
    userComment: string | null;
    createdAt: string;
    highlight: {
      highlightText: string;
      paragraphIndex: number | null;
      startOffset: number | null;
      endOffset: number | null;
    } | null;
  }>;
};

const FEISHU_SYNC_LABELS: Record<string, string> = {
  pending: "未同步",
  creating: "正在创建飞书文档",
  document_created: "文档已创建，正在写入内容",
  writing: "文档已创建，正在写入内容",
  synced: "同步成功",
  content_failed: "文档已创建，但内容写入失败",
  failed: "同步失败"
};

function formatFeishuSyncError(data: any) {
  const stage = data?.stage ? `失败接口：${data.stage}` : "";
  const raw = data?.feishuResponse?.msg || data?.feishuResponse?.error_description || data?.feishuResponse?.error;
  const rawText = raw ? `飞书返回：${raw}` : "";
  const tokenText = data?.tokenStatus?.message ? data.tokenStatus.message : "";
  const advice = /invalid param/i.test(raw || data?.error || "") && /blocks/i.test(data?.stage || "")
    ? "建议：检查 block 结构或内容是否为空、超长、格式不合法。"
    : "";
  return [data?.error, stage, rawText, tokenText, advice].filter(Boolean).join("；") || "飞书同步失败";
}

type SelectionMenu = {
  open: boolean;
  text: string;
  x: number;
  y: number;
  mobile: boolean;
  placement: "above" | "below";
  paragraphIndex: number | null;
  startOffset: number | null;
  endOffset: number | null;
};

export function ArticleReaderClient({
  article,
  tags,
  aiSettings
}: {
  article: Article;
  tags: Tag[];
  aiSettings: { enabled: boolean; connectionStatus: string; model: string | null };
}) {
  const router = useRouter();
  const startedAtRef = useRef(new Date());
  const savedRef = useRef(false);
  const [menu, setMenu] = useState<SelectionMenu>({
    open: false,
    text: "",
    x: 0,
    y: 0,
    mobile: false,
    placement: "above",
    paragraphIndex: null,
    startOffset: null,
    endOffset: null
  });
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [aiSource, setAiSource] = useState<"real" | "mock">(aiSettings.enabled ? "real" : "mock");
  const [feishuSyncStatus, setFeishuSyncStatus] = useState(article.feishuDoc?.syncStatus || "pending");
  const [myOpinion, setMyOpinion] = useState(article.myOpinion || "");
  const [summary, setSummary] = useState(article.summary || "");
  const [methodologyAndInsights, setMethodologyAndInsights] = useState(article.methodologyAndInsights || [article.methodologySummary, article.reusableInsights].filter(Boolean).join("\n\n"));
  const [primaryTagId, setPrimaryTagId] = useState(article.articleTags.find((item) => item.tagRole === "primary")?.tag.id || tags[0]?.id || "");
  const [secondaryTagIds, setSecondaryTagIds] = useState(article.articleTags.filter((item) => item.tagRole === "secondary").map((item) => item.tag.id));
  const paragraphs = useMemo(() => article.content.split(/\n{2,}/).filter(Boolean), [article.content]);
  const highlights = useMemo(
    () => article.notes.map((note) => note.highlight).filter(Boolean) as NonNullable<Article["notes"][number]["highlight"]>[],
    [article.notes]
  );
  const statusClass = {
    unread: "border-line bg-paper text-ink",
    reading: "border-sky bg-sky text-white",
    finished: "border-leaf bg-leaf text-white"
  }[article.readingStatus];

  useEffect(() => {
    function saveReadingSession() {
      if (savedRef.current) return;
      savedRef.current = true;
      const endedAt = new Date();
      const durationSeconds = Math.floor((endedAt.getTime() - startedAtRef.current.getTime()) / 1000);
      const payload = JSON.stringify({
        startedAt: startedAtRef.current.toISOString(),
        endedAt: endedAt.toISOString(),
        durationSeconds
      });

      if (navigator.sendBeacon) {
        navigator.sendBeacon(
          `/api/articles/${article.id}/reading-session`,
          new Blob([payload], { type: "application/json" })
        );
        return;
      }

      void fetch(`/api/articles/${article.id}/reading-session`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: payload,
        keepalive: true
      });
    }

    function handleVisibilityChange() {
      if (document.visibilityState === "hidden") saveReadingSession();
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("pagehide", saveReadingSession);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("pagehide", saveReadingSession);
      saveReadingSession();
    };
  }, [article.id]);

  function getParagraphElement(node: Node | null) {
    if (!node) return null;
    const element = node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement;
    return element?.closest<HTMLElement>("[data-paragraph-index]") ?? null;
  }

  function getSelectionPayload(event?: React.MouseEvent<HTMLElement> | React.TouchEvent<HTMLElement>) {
    const selection = window.getSelection();
    const text = selection?.toString() || "";
    if (!selection || selection.rangeCount === 0 || text.trim().length < 2) return null;

    const range = selection.getRangeAt(0);
    const startParagraph = getParagraphElement(range.startContainer);
    const endParagraph = getParagraphElement(range.endContainer);
    if (!startParagraph || !endParagraph || startParagraph !== endParagraph) {
      return {
        text: text.trim(),
        paragraphIndex: null,
        startOffset: null,
        endOffset: null,
        range
      };
    }

    const preRange = document.createRange();
    preRange.selectNodeContents(startParagraph);
    preRange.setEnd(range.startContainer, range.startOffset);
    const startOffset = preRange.toString().length;
    const endOffset = startOffset + text.length;
    const paragraphIndex = Number(startParagraph.dataset.paragraphIndex);

    const clientX = "clientX" in (event ?? {}) ? (event as React.MouseEvent).clientX : undefined;
    const clientY = "clientY" in (event ?? {}) ? (event as React.MouseEvent).clientY : undefined;

    return {
      text,
      paragraphIndex: Number.isInteger(paragraphIndex) ? paragraphIndex : null,
      startOffset,
      endOffset,
      range,
      clientX,
      clientY
    };
  }

  function captureSelection(event?: React.MouseEvent<HTMLElement> | React.TouchEvent<HTMLElement>) {
    window.setTimeout(() => {
      const payload = getSelectionPayload(event);
      if (!payload) {
        setMenu((current) => ({ ...current, open: false }));
        return;
      }

      const rect = payload.range.getBoundingClientRect();
      const mobile = window.innerWidth < 768;
      const estimatedMenuHeight = 98;
      const preferredAbove = rect.top > estimatedMenuHeight + 16;
      const x = Math.min(Math.max(rect.left + rect.width / 2, 18), window.innerWidth - 18);
      const y = preferredAbove ? rect.top - 8 : rect.bottom + 10;
      setMenu({
        open: true,
        text: payload.text.trim(),
        x,
        y: Math.min(Math.max(y, 16), window.innerHeight - 16),
        mobile,
        placement: preferredAbove ? "above" : "below",
        paragraphIndex: payload.paragraphIndex,
        startOffset: payload.startOffset,
        endOffset: payload.endOffset
      });
    }, 20);
  }

  function handleContextMenu(event: React.MouseEvent<HTMLElement>) {
    const payload = getSelectionPayload(event);
    if (!payload) return;
    event.preventDefault();
    setMenu({
      open: true,
      text: payload.text.trim(),
      x: event.clientX,
      y: event.clientY,
      mobile: window.innerWidth < 768,
      placement: event.clientY > 120 ? "above" : "below",
      paragraphIndex: payload.paragraphIndex,
      startOffset: payload.startOffset,
      endOffset: payload.endOffset
    });
  }

  async function createHighlight(noteType: NoteType) {
    if (!menu.text) {
      setMessage("请先选择需要沉淀的正文");
      return;
    }
    setLoading(true);
    const response = await fetch(`/api/articles/${article.id}/highlight`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        highlightText: menu.text,
        noteType,
        paragraphIndex: menu.paragraphIndex,
        startOffset: menu.startOffset,
        endOffset: menu.endOffset
      })
    });
    setLoading(false);
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      setMessage(data.error || "高亮失败");
      return;
    }
    window.getSelection()?.removeAllRanges();
    setMenu({
      open: false,
      text: "",
      x: 0,
      y: 0,
      mobile: false,
      placement: "above",
      paragraphIndex: null,
      startOffset: null,
      endOffset: null
    });
    setMessage(`已保存为「${NOTE_TYPE_LABELS[noteType]}」笔记`);
    router.refresh();
  }

  async function updateArticle(extra: Record<string, unknown> = {}) {
    setLoading(true);
    const response = await fetch(`/api/articles/${article.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        myOpinion,
        summary,
        methodologyAndInsights,
        ...extra
      })
    });
    setLoading(false);
    setMessage(response.ok ? "已保存" : "保存失败");
    router.refresh();
  }

  function selectPrimaryTag(tagId: string) {
    setPrimaryTagId(tagId);
    setSecondaryTagIds((current) => current.filter((id) => id !== tagId));
  }

  function toggleSecondaryTag(tagId: string) {
    if (tagId === primaryTagId) return;
    setSecondaryTagIds((current) =>
      current.includes(tagId) ? current.filter((id) => id !== tagId) : [...current, tagId]
    );
  }

  async function updateTags() {
    const response = await fetch(`/api/articles/${article.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ primaryTagId, secondaryTagIds })
    });
    setMessage(response.ok ? "标签已更新" : "标签更新失败");
    router.refresh();
  }

  async function updateNote(noteId: string, noteType: string, userComment?: string) {
    await fetch(`/api/notes/${noteId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ noteType, userComment })
    });
    router.refresh();
  }

  async function generateAi(target: "summary" | "methodology" | "all" = "all") {
    setLoading(true);
    const response = await fetch(`/api/articles/${article.id}/ai`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ target })
    });
    const data = await response.json().catch(() => ({}));
    setLoading(false);
    if (response.ok) {
      const source = data.aiSource === "real" ? "real" : "mock";
      setAiSource(source);
      if (typeof data.summary === "string") setSummary(data.summary);
      if (typeof data.methodologyAndInsights === "string") setMethodologyAndInsights(data.methodologyAndInsights);
      setMessage(source === "real"
        ? "真实 AI 内容已重新生成"
        : data.warnings?.[0] || "当前未配置真实大模型 API，系统已使用 mock 结果。你可以在设置页配置 API 后重新生成。");
    } else {
      setAiSource("mock");
      setMessage(data.error || "真实 AI 调用失败，已使用 fallback 结果。请检查设置页中的 API Key、Base URL 和模型名称。");
    }
    router.refresh();
  }

  async function syncFeishu() {
    setLoading(true);
    setFeishuSyncStatus("creating");
    const response = await fetch(`/api/articles/${article.id}/sync-feishu`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({})
    });
    if (response.status === 409) {
      const data = await response.json().catch(() => ({}));
      const folderName = window.prompt(`首次同步「${data.tagName || "该标签"}」文章，请输入飞书文件夹展示名称`, `${data.tagName || "默认"}阅读笔记`) || "";
      const folderInput = folderName
        ? window.prompt("请输入飞书文件夹链接或 folder_token。不能只填写文件夹名称，飞书 API 需要文件夹 token。", "") || ""
        : "";
      if (!folderName || !folderInput) {
        setLoading(false);
        setFeishuSyncStatus(article.feishuDoc?.syncStatus || "pending");
        setMessage("已取消同步：真实飞书同步需要文件夹展示名称，以及飞书文件夹链接或 folder_token。");
        return;
      }
      const retry = await fetch(`/api/articles/${article.id}/sync-feishu`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ folderName, folderInput })
      });
      const retryData = await retry.json().catch(() => ({}));
      setFeishuSyncStatus(retryData.syncStatus || (retry.ok ? "synced" : "failed"));
      setMessage(retry.ok
        ? `${FEISHU_SYNC_LABELS[retryData.syncStatus || "synced"] || "同步成功"}：${retryData.url || ""}${retryData.warning ? `；${retryData.warning}` : ""}`
        : formatFeishuSyncError(retryData));
    } else {
      const data = await response.json().catch(() => ({}));
      setFeishuSyncStatus(data.syncStatus || (response.ok ? "synced" : "failed"));
      setMessage(response.ok
        ? `${FEISHU_SYNC_LABELS[data.syncStatus || "synced"] || "同步成功"}：${data.url || ""}${data.warning ? `；${data.warning}` : ""}`
        : formatFeishuSyncError(data));
    }
    setLoading(false);
    router.refresh();
  }

  return (
    <div className="grid gap-5 xl:h-[calc(100vh-3rem)] xl:grid-cols-[minmax(0,1fr)_380px] xl:overflow-hidden">
      {menu.open ? <SelectionTypeMenu menu={menu} loading={loading} onPick={createHighlight} /> : null}
      <section className="min-h-0 space-y-5 xl:overflow-y-auto xl:overscroll-contain xl:pr-2">
        <div className="card">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <h1 className="text-3xl font-black leading-tight text-ink sm:text-4xl">{article.title}</h1>
              <div className="mt-3 flex flex-wrap gap-2">
                <span className="pill">{article.sourcePlatform || "未知来源"}</span>
                {article.sourceUrl ? <a className="pill hover:text-leaf" href={article.sourceUrl} target="_blank">原文链接</a> : null}
                <span className={`pill ${statusClass}`}>{READING_STATUS_LABELS[article.readingStatus]}</span>
                <span className={feishuSyncStatus === "synced" ? "pill border-sky bg-sky text-white" : feishuSyncStatus === "content_failed" ? "pill border-coral bg-white text-coral" : "pill"}>
                  {FEISHU_SYNC_LABELS[feishuSyncStatus] || "未同步"}
                </span>
                {article.feishuDoc?.feishuDocUrl ? (
                  <a className="pill border-leaf bg-leaf text-white hover:bg-sky" href={article.feishuDoc.feishuDocUrl} target="_blank">
                    打开飞书文档
                  </a>
                ) : null}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <ArticleActions articleId={article.id} readingStatus={article.readingStatus} compact redirectAfterDelete="/library" />
              <button className="btn-secondary" onClick={() => updateArticle({ isStarred: !article.isStarred })}>{article.isStarred ? "取消星标" : "星标"}</button>
              <button className="btn-secondary" onClick={() => updateArticle({ isInReadLater: !article.isInReadLater })}>{article.isInReadLater ? "移出待读" : "加入待读"}</button>
              <button className="btn-secondary" onClick={() => generateAi("all")} disabled={loading}>生成 AI 总结</button>
              <button className="btn" onClick={syncFeishu} disabled={loading}>同步飞书</button>
            </div>
          </div>

          <div className="mt-5 rounded-lg border border-line bg-white p-4">
            <div className="flex flex-col gap-4">
              <TagChipRow
                label="主标签"
                helper="只能选择 1 个，决定飞书文件夹"
                tags={tags}
                selectedIds={[primaryTagId].filter(Boolean)}
                selectedClassName="border-leaf bg-leaf text-white"
                onPick={selectPrimaryTag}
              />
              <TagChipRow
                label="副标签"
                helper="用于检索和文档内标签"
                tags={tags.filter((tag) => tag.id !== primaryTagId)}
                selectedIds={secondaryTagIds}
                selectedClassName="border-sky bg-sky text-white"
                onPick={toggleSecondaryTag}
              />
            </div>
            <button className="btn-secondary mt-4" onClick={updateTags}>保存标签</button>
          </div>
          {message ? <div className="mt-4 rounded-md border border-sky/30 bg-aqua px-3 py-2 text-sm text-ink">{message}</div> : null}
        </div>

        <div className="card">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="section-title">正文阅读区</h2>
            <span className="pill">选中文字后直接选择笔记类型</span>
          </div>
          <article
            className="mt-5 max-w-none text-[17px] leading-8 text-ink sm:text-[18px]"
            onMouseUp={captureSelection}
            onTouchEnd={captureSelection}
            onContextMenu={handleContextMenu}
          >
            {paragraphs.map((paragraph, index) => (
              <p key={index} data-paragraph-index={index} className="mb-5">{renderHighlightedText(paragraph, index, highlights)}</p>
            ))}
          </article>
        </div>
      </section>

      <aside className="min-h-0 space-y-5 xl:overflow-y-auto xl:overscroll-contain xl:pr-1">
        <details className="card xl:hidden" open={article.notes.length > 0}>
          <summary className="cursor-pointer list-none text-xl font-bold text-ink">高亮笔记区</summary>
          <NotesPanel article={article} onSave={updateNote} compact />
        </details>
        <div className="card hidden xl:block">
          <h2 className="section-title">高亮笔记区</h2>
          <NotesPanel article={article} onSave={updateNote} />
        </div>

        <div className="card">
          <h2 className="section-title">我的观点</h2>
          <textarea className="input mt-4 min-h-32" value={myOpinion} onChange={(event) => setMyOpinion(event.target.value)} />
          <button className="btn mt-3 w-full" onClick={() => updateArticle({ regenerateAi: true })} disabled={loading}>保存观点并更新启发</button>
        </div>

        <EditableAiBlock
          title="文章摘要"
          value={summary}
          onChange={setSummary}
          onSave={(nextValue) => updateArticle({ summary: nextValue ?? summary })}
        />
        <EditableAiBlock
          title="方法论和启示"
          value={methodologyAndInsights}
          onChange={setMethodologyAndInsights}
          onSave={(nextValue) => updateArticle({ methodologyAndInsights: nextValue ?? methodologyAndInsights })}
        />
        <div className="card">
          <h2 className="section-title">AI 生成</h2>
          <div className={aiSource === "real" ? "mt-4 rounded-md border border-leaf/30 bg-white px-3 py-2 text-sm text-ink" : "mt-4 rounded-md border border-sky/30 bg-paper px-3 py-2 text-sm text-ink"}>
            当前生成方式：{aiSource === "real" ? `真实 AI${aiSettings.model ? `（${aiSettings.model}）` : ""}` : "Mock fallback"}
          </div>
          {aiSource === "mock" ? (
            <p className="mt-3 rounded-md bg-paper p-3 text-sm leading-6 text-moss">
              当前未连接真实大模型，生成内容仅为占位结果。请到设置页配置 API 以获得真实 AI 阅读分析。
            </p>
          ) : null}
          <div className="mt-4 grid gap-2">
            <button className="btn" onClick={() => generateAi("summary")} disabled={loading}>重新生成文章摘要</button>
            <button className="btn-secondary" onClick={() => generateAi("methodology")} disabled={loading}>重新生成方法论和启示</button>
          </div>
        </div>
      </aside>
    </div>
  );
}

function SelectionTypeMenu({
  menu,
  loading,
  onPick
}: {
  menu: SelectionMenu;
  loading: boolean;
  onPick: (noteType: NoteType) => Promise<void>;
}) {
  const style = menu.mobile
    ? undefined
    : {
        left: menu.x,
        top: menu.y,
        transform: menu.placement === "above" ? "translate(-50%, -100%)" : "translate(-50%, 0)"
      };

  return (
    <div
      className={
        menu.mobile
          ? "fixed inset-x-3 bottom-4 z-50 rounded-lg border border-line bg-white p-3 shadow-soft"
          : "fixed z-50 max-w-[min(520px,calc(100vw-32px))] rounded-lg border border-line bg-white p-2 shadow-soft"
      }
      style={style}
    >
      <div className="mb-2 line-clamp-2 text-xs text-moss">{menu.text}</div>
      <div className="grid grid-cols-3 gap-2 sm:flex">
        {Object.entries(NOTE_TYPE_LABELS).map(([key, label]) => (
          <button
            key={key}
            className="rounded-md bg-paper px-3 py-2 text-xs font-bold text-ink transition hover:bg-leaf hover:text-white disabled:opacity-50"
            disabled={loading}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onPick(key as NoteType)}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

function TagChipRow({
  label,
  helper,
  tags,
  selectedIds,
  selectedClassName,
  onPick
}: {
  label: string;
  helper: string;
  tags: Tag[];
  selectedIds: string[];
  selectedClassName: string;
  onPick: (tagId: string) => void;
}) {
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-baseline gap-2">
        <span className="text-sm font-bold text-ink">{label}</span>
        <span className="text-xs text-moss">{helper}</span>
      </div>
      <div className="flex flex-wrap gap-2">
        {tags.map((tag) => {
          const selected = selectedIds.includes(tag.id);
          return (
            <button
              key={tag.id}
              type="button"
              className={
                selected
                  ? `rounded-full border px-3 py-1.5 text-xs font-bold transition ${selectedClassName}`
                  : "rounded-full border border-sky bg-white px-3 py-1.5 text-xs font-bold text-sky transition hover:bg-aqua"
              }
              onClick={() => onPick(tag.id)}
            >
              {tag.name}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function NotesPanel({
  article,
  onSave,
  compact = false
}: {
  article: Article;
  onSave: (noteId: string, noteType: string, userComment?: string) => Promise<void>;
  compact?: boolean;
}) {
  return (
    <div className={compact ? "mt-4 space-y-3" : "mt-4 space-y-3"}>
      {article.notes.length ? article.notes.map((note) => (
        <NoteEditor key={note.id} note={note} article={article} onSave={onSave} />
      )) : <div className="rounded-md border border-dashed border-line p-4 text-sm text-moss">选中正文后，在选区菜单里选择笔记类型即可自动生成笔记。</div>}
    </div>
  );
}

function NoteEditor({
  note,
  article,
  onSave
}: {
  note: Article["notes"][number];
  article: Article;
  onSave: (noteId: string, noteType: string, userComment?: string) => Promise<void>;
}) {
  const [noteType, setNoteType] = useState(note.noteType);
  const [comment, setComment] = useState(note.userComment || "");
  const [editing, setEditing] = useState(false);
  const primary = article.articleTags.find((item) => item.tagRole === "primary")?.tag;

  async function changeType(value: NoteType) {
    setNoteType(value);
    await onSave(note.id, value, note.userComment || "");
  }

  return (
    <div className="rounded-lg border border-line bg-paper/60 p-3">
      <div className="text-sm leading-6 text-ink">{note.highlight?.highlightText}</div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <select className="input max-w-36 py-1.5" value={noteType} onChange={(event) => changeType(event.target.value as NoteType)}>
          {Object.entries(NOTE_TYPE_LABELS).map(([key, label]) => (
            <option key={key} value={key}>{label}</option>
          ))}
        </select>
        {primary ? <span className="pill border-leaf bg-leaf text-white">{primary.name}</span> : null}
        <span className="pill">{new Date(note.createdAt).toLocaleDateString("zh-CN")}</span>
        <button className="btn-secondary px-3 py-1.5 text-xs" onClick={() => setEditing((value) => !value)}>
          {editing ? "收起" : "编辑"}
        </button>
      </div>
      {editing ? (
        <div className="mt-3 grid gap-2">
          <textarea className="input min-h-20" value={comment} onChange={(event) => setComment(event.target.value)} placeholder="用户补充内容" />
          <button className="btn-secondary" onClick={() => onSave(note.id, noteType, comment)}>保存补充内容</button>
        </div>
      ) : null}
    </div>
  );
}

function EditableAiBlock({
  title,
  value,
  onChange,
  onSave
}: {
  title: string;
  value: string;
  onChange: (value: string) => void;
  onSave: (nextValue?: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    if (!editing) setDraft(value);
  }, [editing, value]);

  async function saveDraft() {
    onChange(draft);
    await onSave(draft);
    setEditing(false);
  }

  return (
    <>
      <div className="card">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="section-title">{title}</h2>
          <button
            type="button"
            className="btn-secondary px-3 py-1.5 text-xs"
            onClick={() => {
              setDraft(value);
              setEditing(false);
              setOpen(true);
            }}
          >
            大屏查看
          </button>
        </div>
        <textarea className="input mt-4 min-h-36" value={value} onChange={(event) => onChange(event.target.value)} />
        <button className="btn-secondary mt-3 w-full" onClick={() => onSave(value)}>保存</button>
      </div>

      {open ? (
        <div className="fixed inset-0 z-[80] flex items-end bg-ink/45 p-0 sm:items-center sm:justify-center sm:p-5" role="dialog" aria-modal="true" aria-label={title}>
          <div className="flex h-[94vh] w-full flex-col overflow-hidden rounded-t-2xl border border-line bg-white shadow-soft sm:h-[86vh] sm:max-w-5xl sm:rounded-2xl lg:w-[78vw]">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3 sm:px-6">
              <div>
                <h2 className="text-xl font-black text-ink sm:text-2xl">{title}</h2>
                <p className="mt-1 text-xs text-moss">大屏阅读与编辑</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {editing ? (
                  <>
                    <button type="button" className="btn-secondary px-3 py-2 text-xs" onClick={() => {
                      setDraft(value);
                      setEditing(false);
                    }}>
                      取消
                    </button>
                    <button type="button" className="btn px-3 py-2 text-xs" onClick={saveDraft}>
                      保存
                    </button>
                  </>
                ) : (
                  <button type="button" className="btn-secondary px-3 py-2 text-xs" onClick={() => setEditing(true)}>
                    编辑
                  </button>
                )}
                <button type="button" className="btn-secondary px-3 py-2 text-xs" onClick={() => {
                  setEditing(false);
                  setOpen(false);
                }}>
                  关闭
                </button>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-8">
              {editing ? (
                <textarea
                  className="input min-h-[68vh] w-full resize-y text-[15px] leading-8 sm:text-base"
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                />
              ) : (
                <AiLargeText value={value} />
              )}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function AiLargeText({ value }: { value: string }) {
  const lines = value.split("\n");
  return (
    <div className="max-w-none text-[15px] leading-8 text-ink sm:text-base sm:leading-9">
      {lines.length ? lines.map((line, index) => {
        const trimmed = line.trim();
        if (!trimmed) return <div key={index} className="h-4" />;
        const isHeading = /^([一二三四五六七八九十]、|\d+[.、])/.test(trimmed) || /^(核心问题链条|可迁移的分析框架|可复用的方法|关键洞察|后续追踪方向)/.test(trimmed);
        return (
          <p
            key={index}
            className={isHeading ? "mt-5 rounded-md bg-paper px-3 py-2 font-black text-ink" : "mb-3 whitespace-pre-wrap"}
          >
            {trimmed}
          </p>
        );
      }) : <p className="text-moss">暂无内容</p>}
    </div>
  );
}

function renderHighlightedText(
  paragraph: string,
  paragraphIndex: number,
  highlights: Array<{
    highlightText: string;
    paragraphIndex: number | null;
    startOffset: number | null;
    endOffset: number | null;
  }>
) {
  const preciseMatches = highlights
    .filter((highlight) =>
      highlight.paragraphIndex === paragraphIndex &&
      Number.isInteger(highlight.startOffset) &&
      Number.isInteger(highlight.endOffset) &&
      (highlight.startOffset ?? -1) >= 0 &&
      (highlight.endOffset ?? 0) > (highlight.startOffset ?? 0) &&
      (highlight.endOffset ?? 0) <= paragraph.length
    )
    .map((highlight) => ({
      text: paragraph.slice(highlight.startOffset ?? 0, highlight.endOffset ?? 0),
      index: highlight.startOffset ?? 0,
      end: highlight.endOffset ?? 0,
      precise: true
    }));

  const fallbackMatches = highlights
    .filter((highlight) => highlight.paragraphIndex === null || highlight.startOffset === null || highlight.endOffset === null)
    .map((highlight) => ({ text: highlight.highlightText, index: paragraph.indexOf(highlight.highlightText), end: paragraph.indexOf(highlight.highlightText) + highlight.highlightText.length, precise: false }))
    .filter((item) => item.index >= 0);

  const matches = [...preciseMatches, ...fallbackMatches]
    .sort((a, b) => a.index - b.index || b.text.length - a.text.length);

  if (!matches.length) return paragraph;

  const nodes: React.ReactNode[] = [];
  let cursor = 0;
  for (const match of matches) {
    if (match.index < cursor) continue;
    if (match.index > cursor) nodes.push(paragraph.slice(cursor, match.index));
    nodes.push(
      <span className="article-highlight" key={`${match.index}-${match.end}-${match.text}`}>
        {paragraph.slice(match.index, match.end)}
      </span>
    );
    cursor = match.end;
  }
  if (cursor < paragraph.length) nodes.push(paragraph.slice(cursor));
  return nodes;
}
