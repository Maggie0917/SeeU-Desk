import { AppShell } from "@/components/AppShell";
import { SettingsClient } from "@/components/SettingsClient";
import { requireUser } from "@/lib/auth";
import { DatabaseUnavailableNotice } from "@/components/DatabaseUnavailableNotice";
import { isDatabaseUnavailableError, withDbRetry } from "@/lib/db-with-retry";
import { prisma } from "@/lib/prisma";
import { getFeishuConnectionStatus, getFeishuTokenDiagnostic } from "@/lib/services/feishu";

export default async function SettingsPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  try {
    return await SettingsContent({ searchParams });
  } catch (error) {
    if (isDatabaseUnavailableError(error)) return <DatabaseUnavailableNotice />;
    throw error;
  }
}

async function SettingsContent({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const params = await searchParams;
  const [tags, settings, feishuCredential] = await withDbRetry(() => Promise.all([
    prisma.tag.findMany({
      where: { userId: user.id },
      include: { folderMapping: true },
      orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }]
    }),
    prisma.userSettings.findUnique({ where: { userId: user.id } }),
    prisma.feishuCredential.findUnique({ where: { userId: user.id } })
  ]));
  const configStatus = getFeishuConnectionStatus();
  const feishuDiagnostic = feishuCredential ? await withDbRetry(() => getFeishuTokenDiagnostic(user.id)) : null;
  const feishuStatus = feishuDiagnostic?.status === "api_ready"
    ? "api_ready"
    : feishuDiagnostic?.status === "expired"
      ? "expired"
      : configStatus === "not_configured"
      ? "not_configured"
      : settings?.feishuAuthStatus && settings.feishuAuthStatus !== "mock_authorized"
        ? settings.feishuAuthStatus
        : configStatus;
  const feishuMessage = params.feishu === "not_configured"
    ? "当前产品暂未配置飞书连接能力，请联系管理员。"
    : params.feishu === "failed" || params.feishu === "missing_code" || params.feishu === "disconnected"
    ? String(params.reason ?? "飞书授权失败，请重新连接飞书；如果仍失败，请联系管理员。")
    : feishuDiagnostic?.message && !feishuDiagnostic.ok
      ? feishuDiagnostic.message
      : "";

  return (
    <AppShell>
      <div className="mx-auto max-w-7xl space-y-6">
        <div>
          <h1 className="text-3xl font-black text-ink">设置</h1>
          <p className="mt-2 text-sm text-moss">管理账号、飞书、标签、OCR、AI 总结与报告偏好。</p>
        </div>
        <SettingsClient
          user={{ email: user.email, name: user.name }}
          settings={settings ? {
            feishuAuthStatus: feishuStatus,
            ocrPreference: settings.ocrPreference,
            aiSummaryPreference: settings.aiSummaryPreference,
            reportPreference: settings.reportPreference,
            aiProvider: settings.aiProvider,
            aiBaseUrl: settings.aiBaseUrl,
            aiModel: settings.aiModel,
            aiEnabled: settings.aiEnabled,
            aiApiKeyLast4: settings.aiApiKeyLast4,
            aiConnectionStatus: settings.aiConnectionStatus,
            aiLastTestedAt: settings.aiLastTestedAt?.toISOString() ?? null
          } : {
            feishuAuthStatus: feishuStatus,
            ocrPreference: "mock",
            aiSummaryPreference: "balanced",
            reportPreference: "manual",
            aiProvider: "openai_compatible",
            aiBaseUrl: "",
            aiModel: "",
            aiEnabled: false,
            aiApiKeyLast4: null,
            aiConnectionStatus: "not_configured",
            aiLastTestedAt: null
          }}
          feishuMessage={feishuMessage}
          tags={tags.map((tag) => ({
            id: tag.id,
            name: tag.name,
            isDefault: tag.isDefault,
            folderMapping: tag.folderMapping
              ? {
                  feishuFolderName: tag.folderMapping.feishuFolderName,
                  feishuFolderToken: tag.folderMapping.feishuFolderToken,
                  lastSyncedAt: tag.folderMapping.lastSyncedAt?.toISOString() ?? null
                }
              : null
          }))}
        />
      </div>
    </AppShell>
  );
}
