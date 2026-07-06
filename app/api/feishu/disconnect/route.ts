import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { clearFeishuAuthorization } from "@/lib/services/feishu";

export async function GET(request: Request) {
  const user = await requireUser();
  await clearFeishuAuthorization(user.id);
  return NextResponse.redirect(new URL("/settings?feishu=disconnected&reason=飞书授权已清除", request.url));
}
