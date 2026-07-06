import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await context.params;
  const body = await request.json().catch(() => ({}));
  const note = await prisma.note.findFirst({ where: { id, userId: user.id } });

  if (!note) return NextResponse.json({ error: "笔记不存在" }, { status: 404 });

  await prisma.note.update({
    where: { id, userId: user.id },
    data: {
      noteType: body.noteType,
      userComment: typeof body.userComment === "string" ? body.userComment : undefined
    }
  });

  return NextResponse.json({ ok: true });
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await context.params;
  const note = await prisma.note.findFirst({ where: { id, userId: user.id } });

  if (!note) return NextResponse.json({ error: "笔记不存在" }, { status: 404 });

  await prisma.$transaction([
    prisma.note.delete({ where: { id } }),
    ...(note.highlightId ? [prisma.highlight.deleteMany({ where: { id: note.highlightId, userId: user.id } })] : [])
  ]);

  return NextResponse.json({ ok: true });
}
