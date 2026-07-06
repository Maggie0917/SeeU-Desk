import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await context.params;
  const report = await prisma.report.findFirst({ where: { id, userId: user.id }, include: { readingNote: true } });
  if (!report) return NextResponse.json({ error: "报告不存在" }, { status: 404 });

  return NextResponse.json({ ok: true, content: report.readingNote?.content ?? "" });
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await context.params;
  const body = await request.json().catch(() => ({}));
  const content = typeof body.content === "string" ? body.content : "";

  const report = await prisma.report.findFirst({ where: { id, userId: user.id } });
  if (!report) return NextResponse.json({ error: "报告不存在" }, { status: 404 });

  const note = await prisma.reportReadingNote.upsert({
    where: { reportId: id },
    update: { content },
    create: { userId: user.id, reportId: id, content }
  });

  return NextResponse.json({ ok: true, content: note.content, updatedAt: note.updatedAt });
}
