import { NextResponse } from "next/server";
import { hashPassword, setSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ensureUserDefaults } from "@/lib/user-bootstrap";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const email = String(body.email ?? "").toLowerCase().trim();
  const password = String(body.password ?? "");
  const name = String(body.name ?? "").trim();

  if (!email || !password || password.length < 6) {
    return NextResponse.json({ error: "请输入有效邮箱和至少 6 位密码" }, { status: 400 });
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return NextResponse.json({ error: "该邮箱已注册" }, { status: 409 });
  }

  const user = await prisma.user.create({
    data: {
      email,
      name: name || email.split("@")[0],
      passwordHash: await hashPassword(password)
    }
  });

  await ensureUserDefaults(user.id);
  await setSession(user.id);
  return NextResponse.json({ ok: true });
}
