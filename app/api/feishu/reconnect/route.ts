import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createFeishuOAuthState } from "@/lib/feishu-oauth-state";
import { clearFeishuAuthorization, getFeishuAuthUrl } from "@/lib/services/feishu";

export async function GET(request: Request) {
  const user = await requireUser();
  await clearFeishuAuthorization(user.id);

  const state = await createFeishuOAuthState(user.id, true);
  try {
    const url = getFeishuAuthUrl(state);
    return NextResponse.redirect(url);
  } catch (error) {
    const message = error instanceof Error ? error.message : "飞书真实授权未完成";
    return NextResponse.redirect(new URL(`/settings?feishu=not_configured&reason=${encodeURIComponent(message)}`, request.url));
  }
}
