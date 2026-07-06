import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { NotesListClient } from "@/components/NotesListClient";
import { NOTE_TYPE_LABELS } from "@/lib/constants";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export default async function NotesPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const params = await searchParams;
  const q = String(params.q ?? "");
  const type = String(params.type ?? "");
  const tagId = String(params.tag ?? "");
  const articleId = String(params.article ?? "");
  const view = String(params.view ?? "card");

  const [tags, articles, notes] = await Promise.all([
    prisma.tag.findMany({ where: { userId: user.id }, orderBy: { createdAt: "asc" } }),
    prisma.article.findMany({ where: { userId: user.id, isDeleted: false }, select: { id: true, title: true }, orderBy: { createdAt: "desc" } }),
    prisma.note.findMany({
      where: {
        userId: user.id,
        article: { isDeleted: false },
        ...(type ? { noteType: type as any } : {}),
        ...(articleId ? { articleId } : {}),
        ...(tagId ? { article: { isDeleted: false, articleTags: { some: { userId: user.id, tagId } } } } : {}),
        ...(q
          ? {
              OR: [
                { userComment: { contains: q } },
                { highlight: { is: { highlightText: { contains: q } } } },
                { article: { title: { contains: q } } }
              ]
            }
          : {})
      },
      include: {
        highlight: true,
        article: {
          select: {
            id: true,
            title: true,
            articleTags: { include: { tag: true } }
          }
        }
      },
      orderBy: { createdAt: "desc" }
    })
  ]);

  const serialized = notes.map((note) => ({
    ...note,
    createdAt: note.createdAt.toISOString(),
    updatedAt: note.updatedAt.toISOString(),
    highlight: note.highlight
      ? {
          ...note.highlight,
          createdAt: note.highlight.createdAt.toISOString(),
          updatedAt: note.highlight.updatedAt.toISOString()
        }
      : null
  }));

  return (
    <AppShell>
      <div className="mx-auto max-w-7xl space-y-6">
        <div>
          <h1 className="text-3xl font-black text-ink">笔记库</h1>
          <p className="mt-2 text-sm text-moss">查看所有由高亮自动生成的笔记，并继续分类、补充想法。</p>
        </div>

        <form className="card grid gap-3 lg:grid-cols-6">
          <input className="input" name="q" defaultValue={q} placeholder="搜索笔记 / 文章" />
          <select className="input" name="type" defaultValue={type}>
            <option value="">全部笔记</option>
            {Object.entries(NOTE_TYPE_LABELS).map(([key, label]) => (
              <option key={key} value={key}>{label}</option>
            ))}
          </select>
          <select className="input" name="tag" defaultValue={tagId}>
            <option value="">全部标签</option>
            {tags.map((tag) => <option key={tag.id} value={tag.id}>{tag.name}</option>)}
          </select>
          <select className="input" name="article" defaultValue={articleId}>
            <option value="">全部文章</option>
            {articles.map((article) => <option key={article.id} value={article.id}>{article.title}</option>)}
          </select>
          <select className="input" name="view" defaultValue={view}>
            <option value="card">卡片视图</option>
            <option value="table">多维表格</option>
          </select>
          <div className="flex gap-2">
            <button className="btn flex-1">筛选</button>
            <Link href="/notes" className="btn-secondary">清空</Link>
          </div>
        </form>

        <NotesListClient notes={serialized as any} view={view} />
      </div>
    </AppShell>
  );
}
