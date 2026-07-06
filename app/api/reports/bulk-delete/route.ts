import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function POST(request: Request) {
  const user = await requireUser();
  const body = await request.json().catch(() => ({}));
  const ids: string[] = Array.isArray(body.ids) ? Array.from(new Set(body.ids.map(String).filter(Boolean))) : [];

  if (!ids.length) return NextResponse.json({ error: "请选择要删除的洞察报告" }, { status: 400 });

  const result = await prisma.report.deleteMany({
    where: { userId: user.id, id: { in: ids } }
  });

  return NextResponse.json({ ok: true, count: result.count });
}
