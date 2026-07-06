import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { parseFeishuFolderToken } from "@/lib/services/feishu";

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await context.params;
  const body = await request.json().catch(() => ({}));
  const folderName = String(body.folderName ?? "").trim();
  const folderInput = String(body.folderToken ?? body.folderInput ?? "").trim();
  const folderToken = parseFeishuFolderToken(folderInput);

  const tag = await prisma.tag.findFirst({ where: { id, userId: user.id } });
  if (!tag) return NextResponse.json({ error: "标签不存在" }, { status: 404 });
  if (!folderName) return NextResponse.json({ error: "请输入飞书文件夹展示名称" }, { status: 400 });
  if (!folderToken) return NextResponse.json({ error: "请输入飞书文件夹链接或有效 folder_token。不能只填写文件夹名称。飞书 API 需要文件夹 token。" }, { status: 400 });

  const mapping = await prisma.tagFeishuFolderMapping.upsert({
    where: { tagId: id },
    update: { feishuFolderName: folderName, feishuFolderToken: folderToken },
    create: { userId: user.id, tagId: id, feishuFolderName: folderName, feishuFolderToken: folderToken }
  });

  return NextResponse.json({ ok: true, mapping });
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await context.params;
  const tag = await prisma.tag.findFirst({ where: { id, userId: user.id } });
  if (!tag) return NextResponse.json({ error: "标签不存在" }, { status: 404 });
  await prisma.tagFeishuFolderMapping.deleteMany({ where: { userId: user.id, tagId: id } });
  return NextResponse.json({ ok: true });
}
