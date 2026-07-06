"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { BRAND_NAME, BRAND_SLOGAN } from "@/lib/brand";

export function AuthForm({ mode }: { mode: "login" | "register" }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setLoading(true);
    const formData = new FormData(event.currentTarget);
    const response = await fetch(`/api/auth/${mode}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(Object.fromEntries(formData))
    });
    const data = await response.json().catch(() => ({}));
    setLoading(false);
    if (!response.ok) {
      setError(data.error || "操作失败");
      return;
    }
    router.push("/");
    router.refresh();
  }

  return (
    <div className="mx-auto w-full max-w-md">
      <div className="mb-5 text-center">
        <div className="text-xl font-bold text-leaf">{BRAND_NAME}</div>
        <div className="mt-1 text-sm text-moss">{BRAND_SLOGAN}</div>
      </div>
      <form onSubmit={submit} className="card w-full space-y-4">
      <div>
        <h1 className="text-2xl font-black text-ink">
          {mode === "login" ? "登录阅读台" : "创建账号"}
        </h1>
        <p className="mt-2 text-sm text-moss">
          每个账号只管理自己的个人知识资产库。
        </p>
      </div>
      {mode === "register" ? (
        <div>
          <label className="label">昵称</label>
          <input className="input" name="name" placeholder="你的名字" />
        </div>
      ) : null}
      <div>
        <label className="label">邮箱</label>
        <input className="input" name="email" type="email" required placeholder="you@example.com" />
      </div>
      <div>
        <label className="label">密码</label>
        <input className="input" name="password" type="password" required minLength={6} />
      </div>
      {error ? <div className="rounded-md bg-coral/10 px-3 py-2 text-sm text-coral">{error}</div> : null}
      <button className="btn w-full" disabled={loading}>
        {loading ? "处理中..." : mode === "login" ? "登录" : "注册并进入"}
      </button>
      <div className="text-center text-sm text-moss">
        {mode === "login" ? (
          <>
            还没有账号？<Link className="font-semibold text-leaf" href="/register">去注册</Link>
          </>
        ) : (
          <>
            已有账号？<Link className="font-semibold text-leaf" href="/login">去登录</Link>
          </>
        )}
      </div>
      </form>
    </div>
  );
}
