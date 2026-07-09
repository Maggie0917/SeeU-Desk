export function DatabaseUnavailableNotice() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-paper px-4 py-10">
      <section className="max-w-lg rounded-lg border border-line bg-white p-6 text-center shadow-soft">
        <h1 className="text-2xl font-black text-ink">数据库连接暂时不可用</h1>
        <p className="mt-3 text-sm leading-6 text-moss">
          服务器暂时无法连接数据库，可能是数据库冷启动或短暂网络波动。请稍后刷新重试。
        </p>
        <a className="btn mt-5 inline-flex" href="">
          刷新页面
        </a>
      </section>
    </main>
  );
}
