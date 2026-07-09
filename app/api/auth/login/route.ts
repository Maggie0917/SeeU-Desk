import { NextResponse } from "next/server";
import { setSession, verifyPassword } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ensureUserDefaults } from "@/lib/user-bootstrap";
import { databaseUnavailableBody, isDatabaseUnavailableError, withDbRetry } from "@/lib/db-with-retry";

export const runtime = "nodejs";

function logAuthError(stage: string, error: unknown) {
  const record = error && typeof error === "object" ? error as { name?: string; code?: string; message?: string } : {};
  console.error("auth_login_failed", {
    stage,
    name: record.name || "UnknownError",
    code: record.code || "unknown",
    message: record.message || "未知错误"
  });
}

export async function POST(request: Request) {
  let stage = "parse_request";

  try {
    const body = await request.json().catch(() => ({}));
    const email = String(body.email ?? "").toLowerCase().trim();
    const password = String(body.password ?? "");

    stage = "verify_credentials";
    const user = await withDbRetry(() => prisma.user.findUnique({ where: { email } }));
    if (!user || !(await verifyPassword(password, user.passwordHash))) {
      return NextResponse.json({ error: "邮箱或密码不正确" }, { status: 401 });
    }

    stage = "ensure_user_defaults";
    await ensureUserDefaults(user.id);

    stage = "set_session";
    await setSession(user.id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (isDatabaseUnavailableError(error)) {
      return NextResponse.json(databaseUnavailableBody(), { status: 503 });
    }
    logAuthError(stage, error);
    return NextResponse.json({ error: "认证服务暂时不可用，请稍后重试" }, { status: 500 });
  }
}
