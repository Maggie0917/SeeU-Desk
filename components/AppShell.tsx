import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { BRAND_NAME, BRAND_SLOGAN } from "@/lib/brand";
import { LogoutButton } from "@/components/LogoutButton";
import { DatabaseUnavailableNotice } from "@/components/DatabaseUnavailableNotice";
import { isDatabaseUnavailableError } from "@/lib/db-with-retry";

const navItems = [
  { href: "/", label: "阅读台" },
  { href: "/library", label: "阅读库" },
  { href: "/notes", label: "笔记库" },
  { href: "/reports", label: "洞察报告" },
  { href: "/dashboard", label: "数据看板" },
  { href: "/settings", label: "设置" }
];

export async function AppShell({ children }: { children: React.ReactNode }) {
  let user;
  try {
    user = await requireUser();
  } catch (error) {
    if (isDatabaseUnavailableError(error)) return <DatabaseUnavailableNotice />;
    throw error;
  }

  return (
    <div className="min-h-screen">
      <aside className="fixed inset-y-0 left-0 hidden w-64 border-r border-sky bg-sky p-5 text-white lg:block">
        <Link href="/" className="block">
          <div className="whitespace-nowrap text-[17px] font-bold text-white">{BRAND_NAME}</div>
          <div className="mt-1 text-xs font-normal text-white/75">{BRAND_SLOGAN}</div>
        </Link>
        <nav className="mt-8 space-y-2">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="block rounded-md px-3 py-2 text-sm font-semibold text-white/85 hover:bg-leaf hover:text-white"
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="absolute bottom-5 left-5 right-5 rounded-lg border border-white/35 bg-white/15 p-3">
          <div className="text-sm font-semibold text-white">{user.name || user.email}</div>
          <div className="mt-1 truncate text-xs text-white/75">{user.email}</div>
          <LogoutButton />
        </div>
      </aside>
      <header className="sticky top-0 z-20 border-b border-line bg-white/95 px-4 py-3 backdrop-blur lg:hidden">
        <div className="flex items-center justify-between gap-3">
          <Link href="/" className="min-w-0">
            <div className="whitespace-nowrap text-base font-bold text-leaf">{BRAND_NAME}</div>
            <div className="mt-0.5 text-xs text-moss">{BRAND_SLOGAN}</div>
          </Link>
          <LogoutButton compact />
        </div>
        <nav className="mt-3 hidden gap-2 overflow-x-auto pb-1 md:flex">
          {navItems.map((item) => (
            <Link key={item.href} href={item.href} className="pill whitespace-nowrap">
              {item.label}
            </Link>
          ))}
        </nav>
      </header>
      <main className="px-4 pb-24 pt-6 lg:ml-64 lg:px-8 lg:pb-6">{children}</main>
      <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-6 border-t border-line bg-white/95 px-1 py-2 shadow-soft backdrop-blur md:hidden">
        {navItems.map((item) => (
          <Link key={item.href} href={item.href} className="rounded-md px-1 py-2 text-center text-[11px] font-bold text-ink hover:bg-paper hover:text-leaf">
            {item.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
