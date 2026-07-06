import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await context.params;
  const body = await request.json().catch(() => ({}));
  const selectedText = String(body.selectedText ?? "").trim();
  const blockIndex = Number(body.blockIndex);
  const startOffset = Number(body.startOffset);
  const endOffset = Number(body.endOffset);

  const report = await prisma.report.findFirst({ where: { id, userId: user.id } });
  if (!report) return NextResponse.json({ error: "报告不存在" }, { status: 404 });
  if (!selectedText || !Number.isInteger(blockIndex) || !Number.isInteger(startOffset) || !Number.isInteger(endOffset) || startOffset >= endOffset) {
    return NextResponse.json({ error: "划线范围无效" }, { status: 400 });
  }

  const underline = await prisma.reportUnderline.create({
    data: {
      userId: user.id,
      reportId: id,
      selectedText,
      blockIndex,
      startOffset,
      endOffset
    }
  });

  return NextResponse.json({ ok: true, underline });
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await context.params;
  const report = await prisma.report.findFirst({ where: { id, userId: user.id } });
  if (!report) return NextResponse.json({ error: "报告不存在" }, { status: 404 });

  const result = await prisma.reportUnderline.deleteMany({ where: { userId: user.id, reportId: id } });
  return NextResponse.json({ ok: true, count: result.count });
}
