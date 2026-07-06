import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function DELETE(_request: Request, context: { params: Promise<{ id: string; underlineId: string }> }) {
  const user = await requireUser();
  const { id, underlineId } = await context.params;
  const underline = await prisma.reportUnderline.findFirst({
    where: { id: underlineId, reportId: id, userId: user.id }
  });
  if (!underline) return NextResponse.json({ error: "划线不存在" }, { status: 404 });

  await prisma.reportUnderline.delete({ where: { id: underlineId } });
  return NextResponse.json({ ok: true });
}
