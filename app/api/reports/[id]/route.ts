import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await context.params;
  const body = await request.json().catch(() => ({}));
  const title = typeof body.title === "string" ? body.title.trim() : undefined;
  const content = typeof body.content === "string" ? body.content.trim() : undefined;

  const report = await prisma.report.findFirst({ where: { id, userId: user.id } });
  if (!report) return NextResponse.json({ error: "报告不存在" }, { status: 404 });

  await prisma.report.update({
    where: { id },
    data: {
      title: title || undefined,
      content: content || undefined
    }
  });

  return NextResponse.json({ ok: true });
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await context.params;
  const report = await prisma.report.findFirst({ where: { id, userId: user.id } });
  if (!report) return NextResponse.json({ error: "报告不存在" }, { status: 404 });

  await prisma.report.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
