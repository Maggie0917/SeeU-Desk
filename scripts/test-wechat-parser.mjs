import * as parse5 from "parse5";

const DESKTOP_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const WECHAT_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.49 NetType/WIFI Language/zh_CN";

function hostOf(input) {
  try {
    return new URL(input).hostname.replace(/^www\./, "");
  } catch {
    return "unknown";
  }
}

function children(node) {
  return node.childNodes || [];
}

function tagName(node) {
  return (node.tagName || "").toLowerCase();
}

function attr(node, name) {
  return node.attrs?.find((item) => item.name.toLowerCase() === name.toLowerCase())?.value;
}

function classList(node) {
  return (attr(node, "class") || "").split(/\s+/).filter(Boolean);
}

function walk(node, visit) {
  visit(node);
  for (const child of children(node)) walk(child, visit);
}

function rawText(node) {
  if (node.nodeName === "#text") return node.value || "";
  return children(node).map(rawText).join(" ");
}

function matches(node, selector) {
  const tag = tagName(node);
  if (selector.startsWith("#")) return attr(node, "id") === selector.slice(1);
  if (selector.startsWith(".")) return classList(node).includes(selector.slice(1));
  const tagClass = selector.match(/^([a-z0-9_-]+)\.([a-z0-9_-]+)$/i);
  if (tagClass) return tag === tagClass[1].toLowerCase() && classList(node).includes(tagClass[2]);
  return tag === selector;
}

function query(root, selector) {
  let found;
  walk(root, (node) => {
    if (!found && matches(node, selector)) found = node;
  });
  return found;
}

function cleanText(node) {
  if (!node) return "";
  const lines = rawText(node)
    .split(/\n+/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .filter((line) => !/^(广告|推荐阅读|相关阅读|微信扫一扫|扫一扫|分享|赞|在看)$/.test(line));
  return Array.from(new Set(lines)).join("\n\n");
}

function classifyWechatPage(html, extractedTextLength) {
  const compact = html.replace(/\s+/g, "");
  if (/该内容已被发布者删除|此内容因违规无法查看|文章已删除|内容不存在/.test(compact)) return { failureType: "deleted_or_unavailable", failureReason: "文章已删除或内容不可见" };
  if (/请在微信客户端打开/.test(compact)) return { failureType: "blocked_by_platform", failureReason: "请在微信客户端打开" };
  if (/环境异常|参数错误/.test(compact)) return { failureType: "blocked_by_platform", failureReason: "微信返回环境异常或参数错误页" };
  if (/访问频繁|操作频繁/.test(compact)) return { failureType: "blocked_by_platform", failureReason: "访问频繁" };
  if (/验证码|安全验证|访问受限/.test(compact)) return { failureType: "blocked_by_platform", failureReason: "需要验证或访问受限" };
  if (/登录后查看|请登录/.test(compact)) return { failureType: "login_required", failureReason: "需要登录" };
  if (extractedTextLength < 200) return { failureType: "empty_content", failureReason: "正文为空或低于 200 字" };
  return { failureType: undefined, failureReason: undefined };
}

async function fetchHtml(url, userAgent) {
  const response = await fetch(url, {
    headers: {
      "user-agent": userAgent,
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
      "cache-control": "no-cache",
      pragma: "no-cache"
    },
    redirect: "follow",
    signal: AbortSignal.timeout(15000)
  });
  const html = await response.text();
  return { response, html };
}

async function diagnose(url) {
  for (const [mode, userAgent] of [["desktop", DESKTOP_UA], ["wechat_webview", WECHAT_UA]]) {
    try {
      const { response, html } = await fetchHtml(url, userAgent);
      const root = parse5.parse(html);
      const activityName = query(root, "#activity-name");
      const richTitle = query(root, ".rich_media_title");
      const jsName = query(root, "#js_name") || query(root, ".rich_media_meta_nickname");
      const publishTime = query(root, "#publish_time") || query(root, "em.rich_media_meta_text");
      const jsContent = query(root, "#js_content");
      const richContent = query(root, ".rich_media_content");
      const contentNode = jsContent || richContent || query(root, ".rich_media_area_primary");
      const extracted = cleanText(contentNode);
      const classification = classifyWechatPage(html, extracted.length);
      console.log(JSON.stringify({
        mode,
        originalHost: hostOf(url),
        finalHost: hostOf(response.url || url),
        httpStatus: response.status,
        htmlLength: html.length,
        titleSelectorHit: Boolean(activityName || richTitle),
        activityNameHit: Boolean(activityName),
        jsNameHit: Boolean(jsName),
        publishTimeHit: Boolean(publishTime),
        jsContentHit: Boolean(jsContent),
        richMediaContentHit: Boolean(richContent),
        extractedTextLength: extracted.length,
        failureType: classification.failureType,
        failureReason: classification.failureReason
      }));
    } catch (error) {
      console.log(JSON.stringify({
        mode,
        originalHost: hostOf(url),
        finalHost: undefined,
        httpStatus: undefined,
        htmlLength: 0,
        titleSelectorHit: false,
        activityNameHit: false,
        jsNameHit: false,
        publishTimeHit: false,
        jsContentHit: false,
        richMediaContentHit: false,
        extractedTextLength: 0,
        failureType: "network_error",
        failureReason: error instanceof Error ? error.message : "网络请求失败"
      }));
    }
  }
}

const urls = process.argv.slice(2).filter((url) => hostOf(url) === "mp.weixin.qq.com");
if (urls.length < 1) {
  console.error("请传入至少 1 个 mp.weixin.qq.com 文章链接，例如：node scripts/test-wechat-parser.mjs <url1> <url2> <url3>");
  process.exit(1);
}

for (const url of urls.slice(0, 3)) {
  await diagnose(url);
}
