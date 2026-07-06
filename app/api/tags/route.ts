import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const user = await requireUser();
  const tags = await prisma.tag.findMany({
    where: { userId: user.id },
    include: { folderMapping: true },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }]
  });
  return NextResponse.json(tags);
}

export async function POST(request: Request) {
  const user = await requireUser();
  const body = await request.json().catch(() => ({}));
  const name = String(body.name ?? "").trim();
  if (!name) return NextResponse.json({ error: "请输入标签名称" }, { status: 400 });

  const tag = await prisma.tag.upsert({
    where: { userId_name: { userId: user.id, name } },
    update: {},
    create: { userId: user.id, name, isDefault: false }
  });

  return NextResponse.json({ ok: true, tag });
}
