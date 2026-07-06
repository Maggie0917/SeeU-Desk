import type { Metadata } from "next";
import "@/app/globals.css";
import { BRAND_NAME, BRAND_SLOGAN } from "@/lib/brand";

export const metadata: Metadata = {
  title: BRAND_NAME,
  description: BRAND_SLOGAN
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
