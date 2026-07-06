import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { testAIConnection } from "@/lib/services/ai";

export async function POST() {
  const user = await requireUser();
  const result = await testAIConnection(user.id);
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
