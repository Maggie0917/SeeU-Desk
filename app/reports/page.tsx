import { AppShell } from "@/components/AppShell";
import { ReportsClient } from "@/components/ReportsClient";
import { requireUser } from "@/lib/auth";
import { DatabaseUnavailableNotice } from "@/components/DatabaseUnavailableNotice";
import { isDatabaseUnavailableError, withDbRetry } from "@/lib/db-with-retry";
import { prisma } from "@/lib/prisma";

export default async function ReportsPage() {
  try {
    return await ReportsContent();
  } catch (error) {
    if (isDatabaseUnavailableError(error)) return <DatabaseUnavailableNotice />;
    throw error;
  }
}

async function ReportsContent() {
  const user = await requireUser();
  const [tags, reports] = await withDbRetry(() => Promise.all([
    prisma.tag.findMany({ where: { userId: user.id }, orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }] }),
    prisma.report.findMany({
      where: { userId: user.id },
      include: {
        tag: true,
        underlines: { orderBy: { createdAt: "asc" } },
        readingNote: true
      },
      orderBy: { createdAt: "desc" },
      take: 20
    })
  ]));

  return (
    <AppShell>
      <div className="mx-auto max-w-7xl space-y-6">
        <div>
          <h1 className="text-3xl font-black text-ink">洞察报告</h1>
          <p className="mt-2 text-sm text-moss">第一版支持手动生成标签报告与历史报告保存。</p>
        </div>
        <ReportsClient
          tags={tags.map((tag) => ({ id: tag.id, name: tag.name }))}
          reports={reports.map((report) => ({
            ...report,
            createdAt: report.createdAt.toISOString(),
            updatedAt: report.updatedAt.toISOString(),
            timeRangeStart: report.timeRangeStart.toISOString(),
            timeRangeEnd: report.timeRangeEnd.toISOString(),
            feishuSyncedAt: report.feishuSyncedAt?.toISOString() ?? null,
            underlines: report.underlines.map((underline) => ({
              id: underline.id,
              selectedText: underline.selectedText,
              blockIndex: underline.blockIndex,
              startOffset: underline.startOffset,
              endOffset: underline.endOffset,
              createdAt: underline.createdAt.toISOString()
            })),
            readingNote: report.readingNote
              ? {
                  content: report.readingNote.content,
                  updatedAt: report.readingNote.updatedAt.toISOString()
                }
              : null
          })) as any}
        />
      </div>
    </AppShell>
  );
}
