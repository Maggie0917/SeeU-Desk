"use client";

import Link from "next/link";
import { ArticleActions } from "@/components/ArticleActions";
import { READING_STATUS_LABELS } from "@/lib/constants";
import { excerpt } from "@/lib/text";

export type ArticleCardData = {
  id: string;
  title: string;
  sourcePlatform: string | null;
  summary: string | null;
  keywords?: string | null;
  readingStatus: keyof typeof READING_STATUS_LABELS;
  isStarred: boolean;
  isInReadLater: boolean;
  createdAt: string;
  updatedAt?: string;
  counts?: { highlights?: number; notes?: number };
  myOpinion?: string | null;
  feishuDoc?: { syncStatus: string; feishuDocUrl: string | null } | null;
  articleTags: Array<{ tagRole: "primary" | "secondary"; tag: { id: string; name: string } }>;
};

export function getPrimaryTag(article: ArticleCardData) {
  return article.articleTags.find((item) => item.tagRole === "primary")?.tag;
}

export function getSecondaryTags(article: ArticleCardData) {
  return article.articleTags.filter((item) => item.tagRole === "secondary").map((item) => item.tag);
}

export function getFeishuSyncLabel(status?: string | null) {
  return {
    pending: "未同步",
    creating: "正在创建文档",
    document_created: "文档已创建",
    writing: "正在写入内容",
    synced: "同步成功",
    content_failed: "内容写入失败",
    failed: "同步失败"
  }[status || "pending"] || "未同步";
}

export function ArticleCard({ article, detailed = false }: { article: ArticleCardData; detailed?: boolean }) {
  const primary = getPrimaryTag(article);
  const secondary = getSecondaryTags(article);
  const isPendingImport = article.keywords?.includes("import_failed_pending") || article.summary?.startsWith("导入状态：待补正文");
  const statusClass = {
    unread: "border-line bg-paper text-ink",
    reading: "border-sky bg-sky text-white",
    finished: "border-leaf bg-leaf text-white"
  }[article.readingStatus];
  const readClass = article.readingStatus === "finished" ? "border-2 border-[#22C55E]" : "";

  return (
    <article className={`card-tight transition hover:-translate-y-0.5 hover:border-sky ${readClass}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <Link href={`/article/${article.id}`} className="text-base font-bold text-ink hover:text-leaf">
            {article.title}
          </Link>
          <div className="mt-2 flex flex-wrap gap-2">
            <span className="pill">{article.sourcePlatform || "未知来源"}</span>
            {isPendingImport ? <span className="pill border-coral bg-coral text-white">待补正文</span> : null}
            <span className={`pill ${statusClass}`}>{READING_STATUS_LABELS[article.readingStatus]}</span>
            <span className={article.feishuDoc?.syncStatus === "synced" ? "pill border-sky bg-sky text-white" : article.feishuDoc?.syncStatus === "content_failed" ? "pill border-coral bg-white text-coral" : "pill"}>
              {getFeishuSyncLabel(article.feishuDoc?.syncStatus)}
            </span>
          </div>
        </div>
        {article.isStarred ? <span className="text-lg text-coral">★</span> : null}
      </div>
      {detailed && article.summary ? <p className={`mt-3 text-sm leading-6 ${isPendingImport ? "rounded-md border border-coral/20 bg-paper p-3 text-ink" : "text-moss"}`}>{excerpt(article.summary, 160)}</p> : null}
      <div className="mt-4 flex flex-wrap gap-2">
        {primary ? <span className="rounded-full bg-leaf px-2.5 py-1 text-xs font-bold text-white">{primary.name}</span> : null}
        {secondary.map((tag) => (
          <span key={tag.id} className="pill border-sky bg-white text-sky">
            {tag.name}
          </span>
        ))}
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2 text-xs text-moss md:grid-cols-4">
        <span>高亮 {article.counts?.highlights ?? 0}</span>
        <span>笔记 {article.counts?.notes ?? 0}</span>
        <span>{article.myOpinion ? "已写观点" : "未写观点"}</span>
        <span>{new Date(article.createdAt).toLocaleDateString("zh-CN")}</span>
      </div>
      <div className="mt-4 border-t border-line pt-3">
        <ArticleActions articleId={article.id} readingStatus={article.readingStatus} compact />
      </div>
    </article>
  );
}
