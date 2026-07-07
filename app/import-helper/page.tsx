"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { BRAND_NAME, BRAND_SLOGAN } from "@/lib/brand";

type ImportPayload = {
  source?: string;
  title?: string;
  author?: string;
  publishedAt?: string;
  sourceUrl?: string;
  content?: string;
};

function normalizeText(value: string) {
  const seen = new Set<string>();
  return value
    .split(/\n+/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .filter((line) => {
      const key = line.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .join("\n\n");
}

function coercePayload(data: unknown): ImportPayload | null {
  if (!data || typeof data !== "object") return null;
  const record = data as Record<string, unknown>;
  if (record.source !== "seeu-wechat-import") return null;
  return {
    source: "seeu-wechat-import",
    title: typeof record.title === "string" ? record.title : "",
    author: typeof record.author === "string" ? record.author : "",
    publishedAt: typeof record.publishedAt === "string" ? record.publishedAt : "",
    sourceUrl: typeof record.sourceUrl === "string" ? record.sourceUrl : "",
    content: typeof record.content === "string" ? normalizeText(record.content) : ""
  };
}

export default function ImportHelperPage() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [publishedAt, setPublishedAt] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [content, setContent] = useState("");
  const [message, setMessage] = useState("正在等待公众号页面发送正文。如果没有自动填入，请回到公众号页面重新点击书签，或手动粘贴正文。");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      if (event.origin !== window.location.origin && !String(event.origin).includes("mp.weixin.qq.com")) {
        return;
      }
      const payload = coercePayload(event.data);
      if (!payload) return;
      setTitle(payload.title || "微信公众号导入");
      setAuthor(payload.author || "");
      setPublishedAt(payload.publishedAt || "");
      setSourceUrl(payload.sourceUrl || "");
      setContent(payload.content || "");
      setMessage(payload.content ? "已从公众号页面接收正文，请确认后导入。" : "已接收页面信息，但正文为空。请手动粘贴正文后导入。");
    }
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  const wordCount = useMemo(() => content.replace(/\s+/g, "").length, [content]);

  async function pasteFromClipboard() {
    try {
      const text = await navigator.clipboard.readText();
      const parsed = JSON.parse(text) as unknown;
      const payload = coercePayload(parsed);
      if (payload) {
        setTitle(payload.title || title || "微信公众号导入");
        setAuthor(payload.author || author);
        setPublishedAt(payload.publishedAt || publishedAt);
        setSourceUrl(payload.sourceUrl || sourceUrl);
        setContent(payload.content || content);
        setMessage("已从剪贴板读取公众号导入内容，请确认后保存。");
        return;
      }
      setContent(normalizeText(text));
      setMessage("已从剪贴板读取文本，请补充标题后导入。");
    } catch {
      setMessage("无法读取剪贴板。请手动粘贴公众号正文。");
    }
  }

  async function saveArticle() {
    if (wordCount < 20) {
      setMessage("正文至少需要 20 个字符。请重新点击书签导入，或手动粘贴正文。");
      return;
    }
    setSaving(true);
    const response = await fetch("/api/articles/manual", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: title.trim() || "微信公众号导入",
        content,
        sourcePlatform: "mp.weixin.qq.com",
        authorName: author,
        sourceUrl,
        importMethod: "wechat_bookmarklet"
      })
    });
    const data = await response.json().catch(() => ({}));
    setSaving(false);
    if (!response.ok) {
      setMessage(data.error || "导入失败。如果你尚未登录，请先登录后再回到本页确认导入。");
      return;
    }
    router.push(`/article/${data.articleId}`);
    router.refresh();
  }

  return (
    <main className="min-h-screen bg-paper px-4 py-6">
      <div className="mx-auto max-w-5xl space-y-5">
        <header className="rounded-xl border border-line bg-white p-5 shadow-soft">
          <Link href="/" className="inline-block">
            <div className="text-xl font-black text-coral">{BRAND_NAME}</div>
            <div className="mt-1 text-sm text-moss">{BRAND_SLOGAN}</div>
          </Link>
          <div className="mt-5 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div>
              <h1 className="text-2xl font-black text-ink">微信公众号导入确认</h1>
              <p className="mt-2 text-sm leading-6 text-moss">
                本页只接收公众号页面传来的可见正文。请确认内容后再保存，不会静默导入。
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link className="btn-secondary" href="/settings">查看导入助手说明</Link>
              <Link className="btn-secondary" href="/login">登录</Link>
            </div>
          </div>
          <div className="mt-4 rounded-md border border-sky/20 bg-paper px-3 py-2 text-sm text-ink">{message}</div>
        </header>

        <section className="grid gap-5 lg:grid-cols-[1fr_320px]">
          <div className="card">
            <div className="grid gap-3 md:grid-cols-2">
              <label className="grid gap-2 md:col-span-2">
                <span className="label">文章标题</span>
                <input className="input" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="公众号文章标题" />
              </label>
              <label className="grid gap-2">
                <span className="label">公众号名</span>
                <input className="input" value={author} onChange={(event) => setAuthor(event.target.value)} placeholder="公众号名称" />
              </label>
              <label className="grid gap-2">
                <span className="label">发布时间</span>
                <input className="input" value={publishedAt} onChange={(event) => setPublishedAt(event.target.value)} placeholder="发布时间" />
              </label>
              <label className="grid gap-2 md:col-span-2">
                <span className="label">来源链接</span>
                <input className="input" value={sourceUrl} onChange={(event) => setSourceUrl(event.target.value)} placeholder="https://mp.weixin.qq.com/s/..." />
              </label>
              <label className="grid gap-2 md:col-span-2">
                <span className="label">正文</span>
                <textarea
                  className="input min-h-[420px] resize-y leading-7"
                  value={content}
                  onChange={(event) => setContent(event.target.value)}
                  placeholder="如果没有自动填入，请回到公众号原文点击书签，或在这里手动粘贴正文。"
                />
              </label>
            </div>
          </div>

          <aside className="card h-fit border-t-4 border-t-leaf">
            <h2 className="section-title">导入预览</h2>
            <div className="mt-4 space-y-3 text-sm text-moss">
              <div className="rounded-md bg-paper p-3">
                <div className="font-bold text-ink">字数</div>
                <div className="mt-1">{wordCount} 字</div>
              </div>
              <div className="rounded-md bg-paper p-3">
                <div className="font-bold text-ink">来源</div>
                <div className="mt-1 break-all">{sourceUrl || "未填写"}</div>
              </div>
              <button type="button" className="btn-secondary w-full" onClick={pasteFromClipboard}>
                从剪贴板读取
              </button>
              <button type="button" className="btn w-full" onClick={saveArticle} disabled={saving || wordCount < 20}>
                {saving ? "正在导入..." : "确认导入"}
              </button>
              <p className="text-xs leading-5">
                如果保存时提示登录，请先登录，然后重新点击书签或从剪贴板读取内容。
              </p>
            </div>
          </aside>
        </section>
      </div>
    </main>
  );
}
