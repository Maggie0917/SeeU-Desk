import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function POST(request: Request) {
  const user = await requireUser();
  const body = await request.json().catch(() => ({}));
  const ids: string[] = Array.isArray(body.ids) ? Array.from(new Set(body.ids.map(String).filter(Boolean))) : [];

  if (!ids.length) return NextResponse.json({ error: "请选择要删除的笔记" }, { status: 400 });

  const notes = await prisma.note.findMany({
    where: { userId: user.id, id: { in: ids } },
    select: { id: true, highlightId: true }
  });
  const highlightIds = notes.map((note) => note.highlightId).filter(Boolean) as string[];

  const [result] = await prisma.$transaction([
    prisma.note.deleteMany({
      where: { userId: user.id, id: { in: notes.map((note) => note.id) } }
    }),
    prisma.highlight.deleteMany({
      where: { userId: user.id, id: { in: highlightIds } }
    })
  ]);

  return NextResponse.json({ ok: true, count: result.count });
}
