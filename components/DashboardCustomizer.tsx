"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  DASHBOARD_WIDGET_LABELS,
  DASHBOARD_WIDGET_ORDER,
  DEFAULT_DASHBOARD_WIDGET_PREFERENCES,
  type DashboardWidgetKey,
  type DashboardWidgetPreferences
} from "@/lib/dashboard-widgets";

export function DashboardCustomizer({ preferences }: { preferences: DashboardWidgetPreferences }) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [draft, setDraft] = useState<DashboardWidgetPreferences>(preferences);
  const [message, setMessage] = useState("");
  const [isPending, startTransition] = useTransition();

  const selectedCount = useMemo(() => Object.values(draft).filter(Boolean).length, [draft]);

  function openModal() {
    setDraft(preferences);
    setMessage("");
    setIsOpen(true);
  }

  function toggleWidget(key: DashboardWidgetKey) {
    setDraft((current) => ({ ...current, [key]: !current[key] }));
  }

  async function savePreferences(nextPreferences = draft) {
    setMessage("");
    const response = await fetch("/api/settings/dashboard-widgets", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ preferences: nextPreferences })
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      setMessage(data.error || "保存失败，请稍后重试。");
      return;
    }

    setMessage("已保存看板配置。");
    startTransition(() => router.refresh());
    setIsOpen(false);
  }

  function restoreDefaults() {
    const defaults = { ...DEFAULT_DASHBOARD_WIDGET_PREFERENCES };
    setDraft(defaults);
    void savePreferences(defaults);
  }

  return (
    <>
      <button type="button" onClick={openModal} className="btn-secondary">
        自定义看板
      </button>

      {isOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-4">
          <div className="w-full max-w-2xl rounded-2xl border border-sky/20 bg-white shadow-2xl">
            <div className="flex items-start justify-between border-b border-paper px-6 py-5">
              <div>
                <h2 className="text-xl font-black text-ink">自定义看板</h2>
                <p className="mt-1 text-sm text-moss">选择你想在数据看板上显示的卡片和图表。</p>
              </div>
              <button type="button" onClick={() => setIsOpen(false)} className="rounded-full px-3 py-1 text-sm text-moss hover:bg-paper">
                关闭
              </button>
            </div>

            <div className="max-h-[65vh] overflow-y-auto px-6 py-5">
              <div className="mb-4 rounded-xl bg-paper px-4 py-3 text-sm text-moss">
                当前已选择 {selectedCount} 个模块。隐藏模块只影响展示，不影响后台统计记录。
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {DASHBOARD_WIDGET_ORDER.map((key) => (
                  <label key={key} className="flex cursor-pointer items-center justify-between rounded-xl border border-sky/15 bg-white px-4 py-3 hover:border-sky/40">
                    <span className="text-sm font-semibold text-ink">{DASHBOARD_WIDGET_LABELS[key]}</span>
                    <input
                      type="checkbox"
                      checked={draft[key]}
                      onChange={() => toggleWidget(key)}
                      className="h-5 w-5 accent-leaf"
                    />
                  </label>
                ))}
              </div>
              {message ? <p className="mt-4 text-sm text-leaf">{message}</p> : null}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-paper px-6 py-4">
              <button type="button" onClick={restoreDefaults} disabled={isPending} className="rounded-md px-4 py-2 text-sm font-semibold text-sky hover:bg-aqua disabled:opacity-50">
                恢复默认
              </button>
              <div className="flex gap-2">
                <button type="button" onClick={() => setIsOpen(false)} className="btn-secondary">
                  取消
                </button>
                <button type="button" onClick={() => void savePreferences()} disabled={isPending} className="btn">
                  {isPending ? "保存中..." : "保存"}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
