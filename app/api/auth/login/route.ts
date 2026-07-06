import { NextResponse } from "next/server";
import { setSession, verifyPassword } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ensureUserDefaults } from "@/lib/user-bootstrap";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const email = String(body.email ?? "").toLowerCase().trim();
  const password = String(body.password ?? "");

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    return NextResponse.json({ error: "邮箱或密码不正确" }, { status: 401 });
  }

  await ensureUserDefaults(user.id);
  await setSession(user.id);
  return NextResponse.json({ ok: true });
}
