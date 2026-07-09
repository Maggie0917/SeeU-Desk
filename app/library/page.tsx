import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { LibraryBulkClient } from "@/components/LibraryBulkClient";
import { READING_STATUS_LABELS } from "@/lib/constants";
import { requireUser } from "@/lib/auth";
import { DatabaseUnavailableNotice } from "@/components/DatabaseUnavailableNotice";
import { isDatabaseUnavailableError, withDbRetry } from "@/lib/db-with-retry";
import { prisma } from "@/lib/prisma";

export default async function LibraryPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  try {
    return await LibraryContent({ searchParams });
  } catch (error) {
    if (isDatabaseUnavailableError(error)) return <DatabaseUnavailableNotice />;
    throw error;
  }
}

async function LibraryContent({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const params = await searchParams;
  const q = String(params.q ?? "");
  const tagId = String(params.tag ?? "");
  const status = String(params.status ?? "");
  const source = String(params.source ?? "");
  const view = String(params.view ?? "card");
  const starred = params.starred === "1";
  const readLater = params.readLater === "1";
  const feishu = String(params.feishu ?? "");

  const [tags, sources, articles] = await withDbRetry(() => Promise.all([
    prisma.tag.findMany({ where: { userId: user.id }, orderBy: { createdAt: "asc" } }),
    prisma.article.findMany({
      where: { userId: user.id, isDeleted: false, sourcePlatform: { not: null } },
      distinct: ["sourcePlatform"],
      select: { sourcePlatform: true }
    }),
    prisma.article.findMany({
      where: {
        userId: user.id,
        isDeleted: false,
        ...(q
          ? {
              OR: [
                { title: { contains: q } },
                { content: { contains: q } },
                { summary: { contains: q } },
                { myOpinion: { contains: q } }
              ]
            }
          : {}),
        ...(tagId ? { articleTags: { some: { tagId, userId: user.id } } } : {}),
        ...(status ? { readingStatus: status as any } : {}),
        ...(source ? { sourcePlatform: source } : {}),
        ...(starred ? { isStarred: true } : {}),
        ...(readLater ? { isInReadLater: true } : {}),
        ...(feishu === "synced" ? { feishuDoc: { is: { syncStatus: "synced" } } } : {}),
        ...(feishu === "unsynced" ? { feishuDoc: { is: null } } : {})
      },
      include: {
        articleTags: { include: { tag: true } },
        feishuDoc: true,
        _count: { select: { highlights: true, notes: true } }
      },
      orderBy: { createdAt: "desc" }
    })
  ]));

  const serialized = articles.map((article) => ({
    ...article,
    createdAt: article.createdAt.toISOString(),
    updatedAt: article.updatedAt.toISOString(),
    counts: { highlights: article._count.highlights, notes: article._count.notes }
  }));

  return (
    <AppShell>
      <div className="mx-auto max-w-7xl space-y-6">
        <div>
          <h1 className="text-3xl font-black text-ink">阅读库</h1>
          <p className="mt-2 text-sm text-moss">管理全部文章、筛选标签来源状态，并查看飞书同步情况。</p>
        </div>

        <form className="card grid gap-3 lg:grid-cols-7">
          <input className="input lg:col-span-2" name="q" defaultValue={q} placeholder="搜索文章和观点" />
          <select className="input" name="tag" defaultValue={tagId}>
            <option value="">全部标签</option>
            {tags.map((tag) => (
              <option key={tag.id} value={tag.id}>{tag.name}</option>
            ))}
          </select>
          <select className="input" name="source" defaultValue={source}>
            <option value="">全部来源</option>
            {sources.map((item) => (
              <option key={item.sourcePlatform || ""} value={item.sourcePlatform || ""}>{item.sourcePlatform}</option>
            ))}
          </select>
          <select className="input" name="status" defaultValue={status}>
            <option value="">全部状态</option>
            {Object.entries(READING_STATUS_LABELS).map(([key, label]) => (
              <option key={key} value={key}>{label}</option>
            ))}
          </select>
          <select className="input" name="feishu" defaultValue={feishu}>
            <option value="">全部同步</option>
            <option value="synced">已同步</option>
            <option value="unsynced">未同步</option>
          </select>
          <select className="input" name="view" defaultValue={view}>
            <option value="card">卡片视图</option>
            <option value="table">多维表格</option>
          </select>
          <div className="flex flex-wrap gap-2 lg:col-span-7">
            <label className="pill cursor-pointer">
              <input className="mr-2" name="starred" value="1" type="checkbox" defaultChecked={starred} />星标文章
            </label>
            <label className="pill cursor-pointer">
              <input className="mr-2" name="readLater" value="1" type="checkbox" defaultChecked={readLater} />待读文章
            </label>
            <button className="btn">应用筛选</button>
            <Link href="/library" className="btn-secondary">清空</Link>
          </div>
        </form>

        <LibraryBulkClient articles={serialized as any} view={view} />
      </div>
    </AppShell>
  );
}
