import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withDbRetry } from "@/lib/db-with-retry";

export const runtime = "nodejs";

export async function GET() {
  const timestamp = new Date().toISOString();

  try {
    await withDbRetry(() => prisma.$queryRaw`SELECT 1`);
    return NextResponse.json({
      ok: true,
      app: "ok",
      database: "ok",
      timestamp
    });
  } catch {
    return NextResponse.json(
      {
        ok: false,
        app: "ok",
        database: "unavailable",
        timestamp
      },
      { status: 503 }
    );
  }
}
