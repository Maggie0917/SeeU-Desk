import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { generateTagReport } from "@/lib/services/ai";

export async function POST(request: Request) {
  const user = await requireUser();
  const body = await request.json().catch(() => ({}));
  const tagId = String(body.tagId ?? "");
  const start = String(body.start ?? "");
  const end = String(body.end ?? "");
  const save = Boolean(body.save);

  const tag = await prisma.tag.findFirst({ where: { id: tagId, userId: user.id } });
  if (!tag || !start || !end) {
    return NextResponse.json({ error: "请选择标签和时间范围" }, { status: 400 });
  }

  const startDate = new Date(`${start}T00:00:00.000Z`);
  const endDate = new Date(`${end}T23:59:59.999Z`);
  const articles = await prisma.article.findMany({
    where: {
      userId: user.id,
      isDeleted: false,
      createdAt: { gte: startDate, lte: endDate },
      articleTags: { some: { userId: user.id, tagId } }
    },
    include: {
      notes: { include: { highlight: true } }
    },
    orderBy: { createdAt: "desc" }
  });

  const generated = await generateTagReport({
    userId: user.id,
    tagName: tag.name,
    start,
    end,
    articles: articles.map((article) => ({
      title: article.title,
      content: article.content,
      myOpinion: article.myOpinion,
      methodologyAndInsights: article.methodologyAndInsights,
      notes: article.notes.map((note) => ({
        noteType: note.noteType,
        highlightText: note.highlight?.highlightText,
        userComment: note.userComment
      }))
    }))
  });
  const content = generated.text;

  let report = null;
  if (save) {
    report = await prisma.report.create({
      data: {
        userId: user.id,
        tagId,
        title: `${tag.name} 阅读洞察报告`,
        timeRangeStart: startDate,
        timeRangeEnd: endDate,
        content,
        articleCount: articles.length
      }
    });
  }

  return NextResponse.json({ ok: true, content, articleCount: articles.length, report, aiSource: generated.source, warning: generated.warning });
}
