"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type ArticleActionsProps = {
  articleId: string;
  readingStatus: "unread" | "reading" | "finished";
  compact?: boolean;
  redirectAfterDelete?: string;
};

const DELETE_CONFIRM =
  "确认删除这篇文章吗？删除后，该文章及其高亮笔记、标签关联、飞书 mock 记录将不再出现在阅读库、笔记库、报告和数据统计中。";

export function ArticleActions({
  articleId,
  readingStatus,
  compact = false,
  redirectAfterDelete
}: ArticleActionsProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const finished = readingStatus === "finished";

  async function toggleFinished() {
    setLoading(true);
    await fetch(`/api/articles/${articleId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        readingStatus: finished ? "reading" : "finished",
        isInReadLater: finished
      })
    });
    setLoading(false);
    router.refresh();
  }

  async function deleteArticle() {
    if (!window.confirm(DELETE_CONFIRM)) return;
    setLoading(true);
    const response = await fetch(`/api/articles/${articleId}`, { method: "DELETE" });
    setLoading(false);
    if (!response.ok) {
      window.alert("删除失败，请稍后重试");
      return;
    }
    if (redirectAfterDelete) {
      router.push(redirectAfterDelete);
      return;
    }
    router.refresh();
  }

  return (
    <div className={compact ? "flex flex-wrap gap-2" : "flex flex-wrap items-center gap-2"}>
      <button
        type="button"
        className={compact ? "btn-secondary min-h-8 px-3 py-1.5 text-xs" : "btn-secondary"}
        disabled={loading}
        onClick={toggleFinished}
      >
        {finished ? "取消已读" : "标记为已读"}
      </button>
      <button
        type="button"
        className={
          compact
            ? "inline-flex min-h-8 items-center justify-center rounded-md border border-line bg-white px-3 py-1.5 text-xs font-semibold text-moss transition hover:border-coral hover:text-coral disabled:opacity-50"
            : "inline-flex min-h-10 items-center justify-center rounded-md border border-line bg-white px-4 py-2 text-sm font-semibold text-moss transition hover:border-coral hover:text-coral disabled:opacity-50"
        }
        disabled={loading}
        onClick={deleteArticle}
      >
        删除
      </button>
    </div>
  );
}
