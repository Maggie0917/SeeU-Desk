"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArticleActions } from "@/components/ArticleActions";
import { ArticleCard, getFeishuSyncLabel, type ArticleCardData } from "@/components/ArticleCards";
import { READING_STATUS_LABELS } from "@/lib/constants";

type LibraryArticle = ArticleCardData & {
  updatedAt: string;
  counts: { highlights: number; notes: number };
};

export function LibraryBulkClient({
  articles,
  view
}: {
  articles: LibraryArticle[];
  view: string;
}) {
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
    if (!window.confirm(`确认删除选中的 ${selectedCount} 篇文章吗？删除后，这些文章及其相关高亮笔记、标签关联、飞书同步记录将不再出现在阅读库、笔记库、报告和数据统计中。`)) return;
    const response = await fetch("/api/articles/bulk-delete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ids: selectedIds })
    });
    const data = await response.json().catch(() => ({}));
    setMessage(response.ok ? `已删除 ${data.count ?? selectedCount} 篇文章` : data.error || "批量删除失败");
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

  if (!articles.length) {
    return (
      <>
        {toolbar}
        <div className="card text-sm text-moss">没有找到符合条件的文章。</div>
      </>
    );
  }

  if (view === "table") {
    return (
      <>
        {toolbar}
        <section className="card overflow-x-auto">
          <table className="table min-w-[1040px]">
            <thead>
              <tr>
                {selecting ? <th>选择</th> : null}
                <th>标题</th>
                <th>来源</th>
                <th>主标签</th>
                <th>副标签</th>
                <th>阅读状态</th>
                <th>高亮数</th>
                <th>笔记数</th>
                <th>我的观点</th>
                <th>飞书同步</th>
                <th>创建时间</th>
                <th>更新时间</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {articles.map((article) => {
                const primary = article.articleTags.find((item) => item.tagRole === "primary")?.tag.name || "-";
                const secondary = article.articleTags.filter((item) => item.tagRole === "secondary").map((item) => item.tag.name).join("、") || "-";
                const isPendingImport = article.keywords?.includes("import_failed_pending") || article.summary?.startsWith("导入状态：待补正文");
                return (
                  <tr key={article.id}>
                    {selecting ? (
                      <td>
                        <input type="checkbox" checked={selectedIds.includes(article.id)} onChange={() => toggleSelected(article.id)} />
                      </td>
                    ) : null}
                    <td><Link className="font-semibold text-leaf" href={`/article/${article.id}`}>{article.title}</Link></td>
                    <td>{article.sourcePlatform || "-"}</td>
                    <td>{primary}</td>
                    <td>{secondary}</td>
                    <td>{isPendingImport ? "待补正文" : READING_STATUS_LABELS[article.readingStatus]}</td>
                    <td>{article.counts.highlights}</td>
                    <td>{article.counts.notes}</td>
                    <td>{article.myOpinion ? "已填写" : "未填写"}</td>
                    <td>
                      {article.feishuDoc?.syncStatus === "synced" ? (
                        article.feishuDoc.feishuDocUrl ? (
                          <a className="font-semibold text-leaf underline underline-offset-4" href={article.feishuDoc.feishuDocUrl} target="_blank">同步成功，打开</a>
                        ) : "同步成功"
                      ) : getFeishuSyncLabel(article.feishuDoc?.syncStatus)}
                    </td>
                    <td>{new Date(article.createdAt).toLocaleDateString("zh-CN")}</td>
                    <td>{new Date(article.updatedAt).toLocaleDateString("zh-CN")}</td>
                    <td><ArticleActions articleId={article.id} readingStatus={article.readingStatus} compact /></td>
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
      <section className="grid gap-4 lg:grid-cols-2">
        {articles.map((article) => (
          <div key={article.id} className="relative">
            {selecting ? (
              <label className="absolute left-3 top-3 z-10 rounded-full bg-white px-2 py-1 text-xs font-bold text-ink shadow-soft">
                <input className="mr-1" type="checkbox" checked={selectedIds.includes(article.id)} onChange={() => toggleSelected(article.id)} />
                选择
              </label>
            ) : null}
            <ArticleCard article={article} detailed />
          </div>
        ))}
      </section>
    </>
  );
}
