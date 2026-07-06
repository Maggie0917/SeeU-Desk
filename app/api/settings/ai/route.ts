import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { encryptSecret } from "@/lib/server-crypto";

function normalizeBaseUrl(value: string) {
  return value.trim().replace(/\/$/, "");
}

function maskApiKey(last4?: string | null) {
  return last4 ? `已配置，尾号 ****${last4}` : "未配置";
}

export async function PUT(request: Request) {
  const user = await requireUser();
  const body = await request.json().catch(() => ({}));
  const provider = "openai_compatible";
  const baseUrl = normalizeBaseUrl(String(body.baseUrl ?? ""));
  const model = String(body.model ?? "").trim();
  const apiKey = String(body.apiKey ?? "").trim();
  const enabled = Boolean(body.enabled);

  if (!baseUrl || !model) {
    return NextResponse.json({ error: "请填写 Base URL 和模型名称" }, { status: 400 });
  }

  const current = await prisma.userSettings.findUnique({ where: { userId: user.id } });
  const keyData = apiKey
    ? {
        aiApiKeyEncrypted: encryptSecret(apiKey),
        aiApiKeyLast4: apiKey.slice(-4)
      }
    : {};

  if (!apiKey && !current?.aiApiKeyEncrypted) {
    return NextResponse.json({ error: "请填写 API Key" }, { status: 400 });
  }

  const settings = await prisma.userSettings.upsert({
    where: { userId: user.id },
    update: {
      aiProvider: provider,
      aiBaseUrl: baseUrl,
      aiModel: model,
      aiEnabled: enabled,
      aiConnectionStatus: enabled ? "not_tested" : "disabled",
      ...keyData
    },
    create: {
      userId: user.id,
      aiProvider: provider,
      aiBaseUrl: baseUrl,
      aiModel: model,
      aiEnabled: enabled,
      aiConnectionStatus: enabled ? "not_tested" : "disabled",
      ...keyData
    }
  });

  return NextResponse.json({
    ok: true,
    settings: {
      provider: settings.aiProvider,
      baseUrl: settings.aiBaseUrl,
      model: settings.aiModel,
      enabled: settings.aiEnabled,
      connectionStatus: settings.aiConnectionStatus,
      apiKeyLabel: maskApiKey(settings.aiApiKeyLast4)
    }
  });
}

export async function DELETE() {
  const user = await requireUser();
  const settings = await prisma.userSettings.upsert({
    where: { userId: user.id },
    update: {
      aiApiKeyEncrypted: null,
      aiApiKeyLast4: null,
      aiEnabled: false,
      aiConnectionStatus: "not_configured",
      aiLastTestedAt: null
    },
    create: {
      userId: user.id,
      aiEnabled: false,
      aiConnectionStatus: "not_configured"
    }
  });

  return NextResponse.json({
    ok: true,
    settings: {
      provider: settings.aiProvider,
      baseUrl: settings.aiBaseUrl,
      model: settings.aiModel,
      enabled: settings.aiEnabled,
      connectionStatus: settings.aiConnectionStatus,
      apiKeyLabel: "未配置"
    }
  });
}
