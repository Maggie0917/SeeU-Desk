const DEFAULT_URLS = [
  "https://www.news.cn/politics/leaders/20260706/8cdac4c5bc1048acb9ee1164a66a15ac/c.html",
  "https://export.shobserver.com/baijiahao/html/1136560.html",
  "https://www.paulgraham.com/greatwork.html",
  "https://example.com/not-found-seeudesk"
];

function hostOf(input) {
  try {
    return new URL(input).hostname.replace(/^www\./, "");
  } catch {
    return "unknown";
  }
}

async function main() {
  const baseUrl = process.env.SEEU_DESK_BASE_URL || "http://localhost:3000";
  const sessionCookie = process.env.SEEU_DESK_SESSION_COOKIE || "";
  const urls = process.argv.slice(2).length > 0 ? process.argv.slice(2) : DEFAULT_URLS;

  console.log(`测试端点：${baseUrl.replace(/\/$/, "")}/api/articles/import-url`);
  console.log(`登录态：${sessionCookie ? "已提供" : "未提供，接口可能返回未登录"}`);

  for (const url of urls) {
    const result = {
      hostname: hostOf(url),
      finalHost: undefined,
      httpStatus: undefined,
      htmlLength: undefined,
      extractedTextLength: undefined,
      extractorUsed: undefined,
      failureType: undefined,
      routeStage: "request",
      createdArticle: false,
      ok: false
    };

    try {
      const response = await fetch(`${baseUrl.replace(/\/$/, "")}/api/articles/import-url`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(sessionCookie ? { cookie: sessionCookie } : {})
        },
        body: JSON.stringify({ url })
      });
      const data = await response.json().catch(() => ({}));
      const diagnostic = data.diagnostic || {};

      result.ok = response.ok && Boolean(data.ok);
      result.createdArticle = Boolean(data.articleId);
      result.routeStage = result.createdArticle ? "response" : diagnostic.failureType ? "parse" : "response";
      result.finalHost = diagnostic.finalHost;
      result.httpStatus = diagnostic.httpStatus || response.status;
      result.htmlLength = diagnostic.htmlLength;
      result.extractedTextLength = diagnostic.contentLength;
      result.extractorUsed = diagnostic.extractorUsed;
      result.failureType = diagnostic.failureType || (response.ok ? undefined : `http_${response.status}`);

      console.log(JSON.stringify(result));
    } catch (error) {
      result.routeStage = "fetch";
      result.failureType = "network_error";
      console.log(JSON.stringify(result));
    }
  }
}

main().catch((error) => {
  console.error("测试脚本失败：", error instanceof Error ? error.message : "未知错误");
  process.exit(1);
});
