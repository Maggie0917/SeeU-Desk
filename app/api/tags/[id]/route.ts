import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await context.params;
  const tag = await prisma.tag.findFirst({ where: { id, userId: user.id } });
  if (!tag) return NextResponse.json({ error: "标签不存在" }, { status: 404 });

  const primaryCount = await prisma.articleTag.count({
    where: {
      userId: user.id,
      tagId: id,
      tagRole: "primary",
      article: { isDeleted: false }
    }
  });

  if (primaryCount > 0) {
    return NextResponse.json(
      { error: `该标签仍是 ${primaryCount} 篇文章的主标签，请先迁移这些文章的主标签后再删除。` },
      { status: 409 }
    );
  }

  await prisma.$transaction([
    prisma.tagFeishuFolderMapping.deleteMany({ where: { userId: user.id, tagId: id } }),
    prisma.articleTag.deleteMany({ where: { userId: user.id, tagId: id } }),
    prisma.tag.delete({ where: { id } })
  ]);

  return NextResponse.json({ ok: true });
}
