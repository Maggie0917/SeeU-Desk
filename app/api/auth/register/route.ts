import { NextResponse } from "next/server";
import { hashPassword, setSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ensureUserDefaults } from "@/lib/user-bootstrap";
import { databaseUnavailableBody, isDatabaseUnavailableError, withDbRetry } from "@/lib/db-with-retry";

export const runtime = "nodejs";

function logAuthError(stage: string, error: unknown) {
  const record = error && typeof error === "object" ? error as { name?: string; code?: string; message?: string } : {};
  console.error("auth_register_failed", {
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
    const name = String(body.name ?? "").trim();

    if (!email || !password || password.length < 6) {
      return NextResponse.json({ error: "请输入有效邮箱和至少 6 位密码" }, { status: 400 });
    }

    stage = "check_existing_user";
    const existing = await withDbRetry(() => prisma.user.findUnique({ where: { email } }));
    if (existing) {
      return NextResponse.json({ error: "该邮箱已注册" }, { status: 409 });
    }

    stage = "create_user";
    const passwordHash = await hashPassword(password);
    const user = await withDbRetry(() => prisma.user.create({
      data: {
        email,
        name: name || email.split("@")[0],
        passwordHash
      }
    }));

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
