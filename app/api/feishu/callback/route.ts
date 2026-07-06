import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { verifyFeishuOAuthState } from "@/lib/feishu-oauth-state";
import { exchangeFeishuCode } from "@/lib/services/feishu";

function queryToObject(url: URL) {
  return Object.fromEntries(url.searchParams.entries());
}

export async function GET(request: Request) {
  const user = await requireUser();
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");
  const state = url.searchParams.get("state");
  const query = queryToObject(url);

  console.info("飞书 OAuth callback query", query);

  if (error) {
    const description = url.searchParams.get("error_description") || error;
    return NextResponse.redirect(new URL(`/settings?feishu=failed&reason=${encodeURIComponent(description)}`, request.url));
  }
  if (!code) {
    const reason = `飞书回调未携带 code。Query 参数：${JSON.stringify(query)}`;
    console.warn(reason);
    return NextResponse.redirect(new URL(`/settings?feishu=missing_code&reason=${encodeURIComponent(reason)}`, request.url));
  }

  const stateResult = await verifyFeishuOAuthState(state, user.id);
  if (!stateResult.ok) {
    return NextResponse.redirect(new URL(`/settings?feishu=failed&reason=${encodeURIComponent(stateResult.reason || "飞书授权 state 校验失败")}`, request.url));
  }

  try {
    await exchangeFeishuCode(user.id, code);
    return NextResponse.redirect(new URL("/settings?feishu=connected", request.url));
  } catch (err) {
    const message = err instanceof Error ? err.message : "飞书授权失败";
    return NextResponse.redirect(new URL(`/settings?feishu=failed&reason=${encodeURIComponent(message)}`, request.url));
  }
}
