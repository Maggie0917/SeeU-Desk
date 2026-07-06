import "server-only";

import { cookies } from "next/headers";
import crypto from "node:crypto";

const FEISHU_STATE_COOKIE = "pkad_feishu_oauth_state";

export async function createFeishuOAuthState(userId: string, reauth = false) {
  const state = Buffer.from(JSON.stringify({
    userId,
    time: Date.now(),
    nonce: crypto.randomBytes(12).toString("base64url"),
    reauth
  })).toString("base64url");
  const cookieStore = await cookies();
  cookieStore.set(FEISHU_STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 10
  });
  return state;
}

export async function verifyFeishuOAuthState(state: string | null, userId: string) {
  const cookieStore = await cookies();
  const expected = cookieStore.get(FEISHU_STATE_COOKIE)?.value;
  cookieStore.delete(FEISHU_STATE_COOKIE);

  if (!state || !expected || state !== expected) {
    return { ok: false, reason: "飞书授权 state 校验失败，请从设置页重新点击连接飞书。" };
  }

  try {
    const parsed = JSON.parse(Buffer.from(state, "base64url").toString("utf8")) as { userId?: string; time?: number };
    if (parsed.userId !== userId) return { ok: false, reason: "飞书授权 state 用户不匹配，请重新授权。" };
    if (!parsed.time || Date.now() - parsed.time > 10 * 60 * 1000) {
      return { ok: false, reason: "飞书授权 state 已过期，请重新授权。" };
    }
  } catch {
    return { ok: false, reason: "飞书授权 state 格式无效，请重新授权。" };
  }

  return { ok: true };
}
