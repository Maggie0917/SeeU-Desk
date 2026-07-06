"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { NOTE_TYPE_LABELS } from "@/lib/constants";

type NoteItem = {
  id: string;
  noteType: keyof typeof NOTE_TYPE_LABELS;
  userComment: string | null;
  createdAt: string;
  highlight: { highlightText: string } | null;
  article: {
    id: string;
    title: string;
    articleTags: Array<{ tagRole: "primary" | "secondary"; tag: { id: string; name: string } }>;
  };
};

export function NotesListClient({ notes, view }: { notes: NoteItem[]; view: string }) {
  const router = useRouter();
  const [selecting, setSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const selectedCount = selectedIds.length;

  function toggleSelected(id: string) {
    setSelectedIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  }

  function cancelSelection() {
    setSelecting(false);
    setSelectedIds([]);
  }

  async function bulkDelete() {
    if (!selectedCount) return;
    if (!window.confirm(`确认删除选中的 ${selectedCount} 条笔记吗？删除后不会删除原文章，但这些笔记将不再出现在笔记库、文章详情页、飞书同步内容和洞察报告中。`)) return;
    const response = await fetch("/api/notes/bulk-delete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ids: selectedIds })
    });
    const data = await response.json().catch(() => ({}));
    setMessage(response.ok ? `已删除 ${data.count ?? selectedCount} 条笔记` : data.error || "批量删除失败");
    cancelSelection();
    router.refresh();
  }

  const toolbar = (
    <div className="card flex flex-wrap items-center gap-2">
      <button className="btn-secondary" type="button" onClick={() => selecting ? cancelSelection() : setSelecting(true)}>
        {selecting ? "取消选择" : "选择"}
      </button>
      {selecting ? (
        <>
          <span className="pill">已选择 {selectedCount} 项</span>
          <button className="btn" type="button" onClick={bulkDelete} disabled={!selectedCount}>批量删除</button>
        </>
      ) : null}
      {message ? <span className="text-sm text-moss">{message}</span> : null}
    </div>
  );

  if (!notes.length) {
    return (
      <>
        {toolbar}
        <div className="card text-sm text-moss">没有找到符合条件的笔记。</div>
      </>
    );
  }

  if (view === "table") {
    return (
      <>
        {toolbar}
        <section className="card overflow-x-auto">
          <table className="table min-w-[980px]">
            <thead>
              <tr>
                {selecting ? <th>选择</th> : null}
                <th>高亮原文</th>
                <th>所属文章</th>
                <th>笔记类型</th>
                <th>用户补充</th>
                <th>主标签</th>
                <th>副标签</th>
                <th>创建时间</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {notes.map((note) => {
                const primary = note.article.articleTags.find((item) => item.tagRole === "primary")?.tag.name || "-";
                const secondary = note.article.articleTags.filter((item) => item.tagRole === "secondary").map((item) => item.tag.name).join("、") || "-";
                return (
                  <tr key={note.id}>
                    {selecting ? (
                      <td><input type="checkbox" checked={selectedIds.includes(note.id)} onChange={() => toggleSelected(note.id)} /></td>
                    ) : null}
                    <td className="max-w-xs truncate">{note.highlight?.highlightText || "无高亮原文"}</td>
                    <td><Link className="font-semibold text-leaf" href={`/article/${note.article.id}`}>{note.article.title}</Link></td>
                    <td>{NOTE_TYPE_LABELS[note.noteType]}</td>
                    <td className="max-w-xs truncate">{note.userComment || "-"}</td>
                    <td>{primary}</td>
                    <td>{secondary}</td>
                    <td>{new Date(note.createdAt).toLocaleDateString("zh-CN")}</td>
                    <td><DeleteNoteButton noteId={note.id} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      </>
    );
  }

  return (
    <>
      {toolbar}
      <div className="grid gap-4 lg:grid-cols-2">
        {notes.map((note) => (
          <div key={note.id} className="relative">
            {selecting ? (
              <label className="absolute left-3 top-3 z-10 rounded-full bg-white px-2 py-1 text-xs font-bold text-ink shadow-soft">
                <input className="mr-1" type="checkbox" checked={selectedIds.includes(note.id)} onChange={() => toggleSelected(note.id)} />
                选择
              </label>
            ) : null}
            <NoteCard note={note} />
          </div>
        ))}
      </div>
    </>
  );
}

function NoteCard({ note }: { note: NoteItem }) {
  const router = useRouter();
  const [noteType, setNoteType] = useState(note.noteType);
  const [comment, setComment] = useState(note.userComment || "");
  const [saving, setSaving] = useState(false);
  const primary = note.article.articleTags.find((item) => item.tagRole === "primary")?.tag;
  const secondary = note.article.articleTags.filter((item) => item.tagRole === "secondary").map((item) => item.tag);
  const typeClass = {
    key_viewpoint: "border-l-leaf",
    quote: "border-l-sky",
    methodology: "border-l-paper",
    case: "border-l-ink",
    data: "border-l-coral",
    uncategorized: "border-l-line"
  }[noteType];
  const badgeClass = {
    key_viewpoint: "border-leaf bg-leaf text-white",
    quote: "border-sky bg-sky text-white",
    methodology: "border-line bg-paper text-ink",
    case: "border-ink bg-ink text-white",
    data: "border-coral bg-white text-coral",
    uncategorized: "border-line bg-white text-moss"
  }[noteType];

  async function save() {
    setSaving(true);
    await fetch(`/api/notes/${note.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ noteType, userComment: comment })
    });
    setSaving(false);
    router.refresh();
  }

  return (
    <article className={`card border-l-4 ${typeClass}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <Link href={`/article/${note.article.id}`} className="text-sm font-semibold text-leaf">
            {note.article.title}
          </Link>
          <div className="mt-2 flex flex-wrap gap-2">
            {primary ? <span className="rounded-full bg-leaf px-2.5 py-1 text-xs font-bold text-white">{primary.name}</span> : null}
            {secondary.map((tag) => <span key={tag.id} className="pill border-sky bg-white text-sky">{tag.name}</span>)}
          </div>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <span className={`pill ${badgeClass}`}>{NOTE_TYPE_LABELS[noteType]}</span>
          <span className="pill">{new Date(note.createdAt).toLocaleDateString("zh-CN")}</span>
        </div>
      </div>
      <blockquote className="mt-4 rounded-md border-l-4 border-leaf bg-paper p-3 text-sm leading-6 text-ink">
        {note.highlight?.highlightText || "无高亮原文"}
      </blockquote>
      <div className="mt-4 grid gap-3">
        <select className="input" value={noteType} onChange={(event) => setNoteType(event.target.value as keyof typeof NOTE_TYPE_LABELS)}>
          {Object.entries(NOTE_TYPE_LABELS).map(([key, label]) => (
            <option key={key} value={key}>{label}</option>
          ))}
        </select>
        <textarea className="input min-h-24" value={comment} onChange={(event) => setComment(event.target.value)} placeholder="用户补充内容" />
        <div className="flex flex-wrap gap-2">
          <button className="btn-secondary" onClick={save} disabled={saving}>{saving ? "保存中..." : "保存笔记"}</button>
          <DeleteNoteButton noteId={note.id} />
        </div>
      </div>
    </article>
  );
}

function DeleteNoteButton({ noteId }: { noteId: string }) {
  const router = useRouter();

  async function deleteNote() {
    if (!window.confirm("确认删除这条笔记吗？删除后不会删除原文章，但该高亮笔记将不再出现在笔记库和飞书同步内容中。")) return;
    const response = await fetch(`/api/notes/${noteId}`, { method: "DELETE" });
    if (!response.ok) {
      window.alert("删除笔记失败");
      return;
    }
    router.refresh();
  }

  return (
    <button className="btn-secondary" type="button" onClick={deleteNote}>
      删除
    </button>
  );
}
