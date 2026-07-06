import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { DEFAULT_DASHBOARD_WIDGET_PREFERENCES, sanitizeDashboardWidgetPreferences } from "@/lib/dashboard-widgets";
import { prisma } from "@/lib/prisma";

export async function PUT(request: Request) {
  const user = await requireUser();
  const body = await request.json().catch(() => ({}));
  const preferences = sanitizeDashboardWidgetPreferences(body.preferences);

  await prisma.userSettings.upsert({
    where: { userId: user.id },
    update: {
      dashboardWidgetPreferences: JSON.stringify(preferences)
    },
    create: {
      userId: user.id,
      dashboardWidgetPreferences: JSON.stringify(preferences)
    }
  });

  return NextResponse.json({ ok: true, preferences });
}

export async function DELETE() {
  const user = await requireUser();

  await prisma.userSettings.upsert({
    where: { userId: user.id },
    update: {
      dashboardWidgetPreferences: JSON.stringify(DEFAULT_DASHBOARD_WIDGET_PREFERENCES)
    },
    create: {
      userId: user.id,
      dashboardWidgetPreferences: JSON.stringify(DEFAULT_DASHBOARD_WIDGET_PREFERENCES)
    }
  });

  return NextResponse.json({ ok: true, preferences: DEFAULT_DASHBOARD_WIDGET_PREFERENCES });
}
