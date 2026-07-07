import * as parse5 from "parse5";
import { compactText } from "../text";

export type SourcePlatformKind = "wechat_mp" | "xiaohongshu" | "douyin" | "generic_web";

export type ParserFailureType =
  | "content_too_short"
  | "container_not_found"
  | "platform_shell_page"
  | "login_required"
  | "blocked_by_platform"
  | "deleted_or_unavailable"
  | "dynamic_render_required"
  | "anti_crawler"
  | "network_error"
  | "empty_content"
  | "image_heavy_article"
  | "parse_failed"
  | "unsupported_url_shape"
  | "unknown";

export type ParserDiagnostic = {
  success: boolean;
  platform: SourcePlatformKind;
  title?: string;
  contentLength?: number;
  htmlLength?: number;
  httpStatus?: number;
  finalHost?: string;
  extractorUsed?: string;
  failureReason?: string;
  failureType?: ParserFailureType;
  containsJsContent?: boolean;
  selectorJsContentHit?: boolean;
  wechatExtractedTextLength?: number;
  wechatQualityFailureReason?: string;
  imageCount?: number;
  invalidReason?: string;
  platformShellFailure?: ParserFailureType | null;
  routeStage?: string;
  fallbackOptions: Array<"manual_paste" | "ocr" | "save_pending">;
};

export type ParsedArticle = {
  title: string;
  content: string;
  sourcePlatform: string;
  authorName?: string;
  publishedAt?: string;
  imageUrls?: string[];
  diagnostic: ParserDiagnostic;
};

type HtmlNode = {
  nodeName: string;
  tagName?: string;
  attrs?: Array<{ name: string; value: string }>;
  childNodes?: HtmlNode[];
  value?: string;
};

type ParseCandidate = Omit<ParsedArticle, "diagnostic"> & {
  extractorUsed: string;
  platform: SourcePlatformKind;
  imageCount?: number;
};

export class ParserError extends Error {
  diagnostic: ParserDiagnostic;

  constructor(message: string, diagnostic: ParserDiagnostic) {
    super(message);
    this.name = "ParserError";
    this.diagnostic = diagnostic;
  }
}

const FALLBACK_OPTIONS: ParserDiagnostic["fallbackOptions"] = ["manual_paste", "ocr", "save_pending"];
const DESKTOP_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const WECHAT_WEBVIEW_USER_AGENT =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.49 NetType/WIFI Language/zh_CN";
const FETCH_TIMEOUT_MS = 15000;
const BLOCK_TAGS = new Set(["p", "section", "article", "h1", "h2", "h3", "h4", "li", "blockquote", "figcaption"]);
const SKIP_TAGS = new Set(["script", "style", "noscript", "svg", "iframe", "form", "button", "input", "select", "textarea", "nav", "footer", "aside"]);

function safeHostname(input: string) {
  try {
    return new URL(input).hostname.replace(/^www\./, "");
  } catch {
    return "unknown";
  }
}

function parserLog(event: string, data: {
  hostname?: string;
  parserType?: string;
  status?: number;
  finalHost?: string;
  htmlLength?: number;
  extractedLength?: number;
  failureType?: ParserFailureType;
  failureReason?: string;
  containsJsContent?: boolean;
  selectorJsContentHit?: boolean;
  wechatExtractedTextLength?: number;
  wechatQualityFailureReason?: string;
  imageCount?: number;
  invalidReason?: string;
  platformShellFailure?: ParserFailureType | null;
}) {
  console.info("[article-parser]", {
    event,
    hostname: data.hostname,
    parserType: data.parserType,
    status: data.status,
    finalHost: data.finalHost,
    htmlLength: data.htmlLength,
    extractedLength: data.extractedLength,
    failureType: data.failureType,
    failureReason: data.failureReason,
    containsJsContent: data.containsJsContent,
    selectorJsContentHit: data.selectorJsContentHit,
    wechatExtractedTextLength: data.wechatExtractedTextLength,
    wechatQualityFailureReason: data.wechatQualityFailureReason,
    imageCount: data.imageCount,
    invalidReason: data.invalidReason,
    platformShellFailure: data.platformShellFailure
  });
}

export function detectSourcePlatform(url: string): SourcePlatformKind {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, "");
    if (hostname === "mp.weixin.qq.com") return "wechat_mp";
    if (hostname.includes("xiaohongshu.com") || hostname.includes("xhslink.com")) return "xiaohongshu";
    if (hostname.includes("douyin.com") || hostname.includes("iesdouyin.com")) return "douyin";
  } catch {
    return "generic_web";
  }
  return "generic_web";
}

function sourcePlatformLabel(platform: SourcePlatformKind, url: string) {
  if (platform === "wechat_mp") return "mp.weixin.qq.com";
  if (platform === "xiaohongshu") return "xiaohongshu.com";
  if (platform === "douyin") return "douyin.com";
  return safeHostname(url) || "generic_web";
}

function supportedXiaohongshuUrlShape(url: string) {
  try {
    const parsed = new URL(url);
    const pathname = parsed.pathname.replace(/\/+$/, "");
    return /^\/explore\/[A-Za-z0-9]+/.test(pathname)
      || /^\/discovery\/item\/[A-Za-z0-9]+/.test(pathname);
  } catch {
    return false;
  }
}

function decodeEntities(text: string) {
  return text
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&#x2F;/g, "/");
}

function children(node: HtmlNode) {
  return node.childNodes || [];
}

function tagName(node: HtmlNode) {
  return (node.tagName || "").toLowerCase();
}

function attr(node: HtmlNode, name: string) {
  return node.attrs?.find((item) => item.name.toLowerCase() === name.toLowerCase())?.value;
}

function classList(node: HtmlNode) {
  return (attr(node, "class") || "").split(/\s+/).filter(Boolean);
}

function hasClass(node: HtmlNode, className: string) {
  return classList(node).includes(className);
}

function attrIncludes(node: HtmlNode, attrName: string, value: string) {
  return (attr(node, attrName) || "").toLowerCase().includes(value.toLowerCase());
}

function walk(node: HtmlNode, visit: (node: HtmlNode) => void) {
  visit(node);
  for (const child of children(node)) walk(child, visit);
}

function isNoiseNode(node: HtmlNode) {
  const tag = tagName(node);
  if (SKIP_TAGS.has(tag)) return true;
  if (attr(node, "hidden") !== undefined || attr(node, "aria-hidden") === "true") return true;
  const style = (attr(node, "style") || "").replace(/\s+/g, "").toLowerCase();
  if (style.includes("display:none") || style.includes("visibility:hidden")) return true;
  const id = (attr(node, "id") || "").toLowerCase();
  const classes = classList(node).map((item) => item.toLowerCase());
  if (id === "js_content" || classes.some((item) => item === "rich_media_content" || item === "rich_media_area_primary")) return false;
  const marker = `${attr(node, "id") || ""} ${attr(node, "class") || ""}`.toLowerCase();
  return /advert|recommend|footer|comment|sidebar|share|login|related|qr_code|reward/.test(marker);
}

function nodeText(node: HtmlNode): string {
  if (node.nodeName === "#text") return node.value || "";
  if (isNoiseNode(node)) return "";
  if (tagName(node) === "br") return "\n";
  return children(node).map(nodeText).join(" ");
}

function normalizeLines(lines: string[]) {
  const seen = new Set<string>();
  return lines
    .map((line) => compactText(decodeEntities(line)))
    .filter(Boolean)
    .filter((line) => {
      const compact = line.replace(/\s+/g, "");
      if (compact.length <= 2) return false;
      if (/^(广告|推荐阅读|相关阅读|继续滑动看下一个|微信扫一扫|扫一扫|分享|赞|在看)$/i.test(compact)) return false;
      if (/^(登录|注册|首页|导航|菜单|打开App|打开APP|下载App|下载APP|客户端打开)$/i.test(compact)) return false;
      if (/ICP备|营业执照|隐私政策|用户协议|违法不良信息举报|版权所有|Copyright/i.test(line)) return false;
      const key = compact.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function elementToText(element: HtmlNode) {
  const lines: string[] = [];
  function collect(node: HtmlNode) {
    if (node !== element && isNoiseNode(node)) return;
    const tag = tagName(node);
    if (node !== element && BLOCK_TAGS.has(tag)) {
      const text = nodeText(node);
      if (compactText(text).length > 6) lines.push(text);
      return;
    }
    if (tag === "br") {
      lines.push("\n");
      return;
    }
    for (const child of children(node)) collect(child);
  }
  collect(element);
  const normalized = normalizeLines(lines);
  if (normalized.join("\n").length > 120) return normalized.join("\n\n");
  return normalizeLines(nodeText(element).split(/\n+/)).join("\n\n");
}

function matchesSelector(node: HtmlNode, selector: string) {
  const normalized = selector.trim();
  if (!normalized || node.nodeName === "#text") return false;
  const tag = tagName(node);
  if (normalized === tag) return true;
  if (normalized.startsWith("#")) return attr(node, "id") === normalized.slice(1);
  if (normalized.startsWith(".")) return hasClass(node, normalized.slice(1));
  const tagClass = normalized.match(/^([a-z0-9_-]+)\.([a-z0-9_-]+)$/i);
  if (tagClass) return tag === tagClass[1].toLowerCase() && hasClass(node, tagClass[2]);

  const classContains = normalized.match(/^\[class\*=['"](.+)['"]\]$/);
  if (classContains) return attrIncludes(node, "class", classContains[1]);
  const idContains = normalized.match(/^\[id\*=['"](.+)['"]\]$/);
  if (idContains) return attrIncludes(node, "id", idContains[1]);
  const attrEquals = normalized.match(/^\[([^=]+)=['"](.+)['"]\]$/);
  if (attrEquals) return attr(node, attrEquals[1]) === attrEquals[2];
  return false;
}

function queryAll(root: HtmlNode, selector: string) {
  const nodes: HtmlNode[] = [];
  walk(root, (node) => {
    if (matchesSelector(node, selector)) nodes.push(node);
  });
  return nodes;
}

function queryFirst(root: HtmlNode, selectors: string[]) {
  for (const selector of selectors) {
    const node = queryAll(root, selector)[0];
    if (node) return node;
  }
  return undefined;
}

function rawNodeText(node: HtmlNode): string {
  if (node.nodeName === "#text") return node.value || "";
  return children(node).map(rawNodeText).join("");
}

function metaContent(root: HtmlNode, pairs: Array<[string, string]>) {
  const metas = queryAll(root, "meta");
  for (const [name, value] of pairs) {
    const node = metas.find((item) => attr(item, name)?.toLowerCase() === value.toLowerCase());
    const content = node ? attr(node, "content")?.trim() : undefined;
    if (content) return compactText(decodeEntities(content));
  }
  return undefined;
}

function extractTitleFromDocument(root: HtmlNode, url: string) {
  const metaTitle = metaContent(root, [
    ["property", "og:title"],
    ["name", "twitter:title"],
    ["name", "title"]
  ]);
  const titleNode = queryFirst(root, ["#activity-name", ".rich_media_title", "h1", "title"]);
  const rawTitle = metaTitle ?? (titleNode ? nodeText(titleNode) : "");
  const title = compactText(decodeEntities(rawTitle))
    .replace(/\s*[-_]\s*微信公众平台\s*$/, "")
    .replace(/\s*-\s*小红书\s*$/, "")
    .replace(/\s*-\s*抖音\s*$/, "");
  return title || safeHostname(url);
}

function extractAuthor(root: HtmlNode) {
  const metaAuthor = metaContent(root, [
    ["name", "author"],
    ["property", "article:author"],
    ["name", "byl"]
  ]);
  const byline = queryFirst(root, ["#js_name", ".rich_media_meta_nickname", ".profile_nickname", ".author", ".byline"]);
  return compactText(metaAuthor ?? (byline ? nodeText(byline) : "")) || undefined;
}

function normalizePublishTime(value: string) {
  const normalized = compactText(decodeEntities(value));
  if (!normalized) return undefined;
  if (/^\d{10}$/.test(normalized)) return new Date(Number(normalized) * 1000).toISOString();
  if (/^\d{13}$/.test(normalized)) return new Date(Number(normalized)).toISOString();
  return normalized;
}

function extractPublishedAt(root: HtmlNode, html?: string) {
  const visibleTime = metaContent(root, [
    ["property", "article:published_time"],
    ["name", "pubdate"],
    ["name", "publishdate"],
    ["name", "date"]
  ]) ?? compactText(nodeText(queryFirst(root, ["#publish_time", "em.rich_media_meta_text", "time"]) || { nodeName: "" }));
  if (visibleTime) return normalizePublishTime(visibleTime);

  const scriptSource = html ?? scriptTexts(root).join("\n");
  const scriptMatch = scriptSource.match(/(?:publish_time|oriCreateTime|create_time)\s*[=:]\s*["']?([^"',;\n}]+)/i);
  return scriptMatch?.[1] ? normalizePublishTime(scriptMatch[1]) : undefined;
}

function navigationNoiseScore(content: string) {
  const lines = content.split("\n").map((line) => line.trim()).filter(Boolean);
  if (!lines.length) return 1;
  const noisy = lines.filter((line) => {
    if (line.length <= 8) return true;
    if (/^(menu|sections|top stories|newsletter|subscribe|share|广告|推荐阅读|相关阅读|版权所有)$/i.test(line)) return true;
    if (/ICP备|营业执照|隐私政策|用户协议|copyright|all rights reserved/i.test(line)) return true;
    return false;
  });
  return noisy.length / lines.length;
}

function extractFallbackParagraphs(root: HtmlNode) {
  const selectors = [
    "article",
    "main",
    "[itemprop='articleBody']",
    "[role='main']",
    ".article-body",
    ".article-content",
    ".articleContent",
    ".article_content",
    ".article-text",
    ".article_text",
    ".article-detail",
    ".articleDetail",
    ".post-content",
    ".post-body",
    ".entry",
    ".entry-content",
    ".rich_media_content",
    "#js_content",
    ".rich_media_area_primary",
    ".main-content",
    ".mainContent",
    ".detail-content",
    ".detailContent",
    ".text-content",
    ".content",
    ".content-main",
    ".article",
    ".post",
    "#content",
    "#article",
    "[class*='articleWrap']",
    "[class*='article-wrap']",
    "[class*='articleContent']",
    "[class*='article-content']",
    "[class*='articleBody']",
    "[class*='article-body']",
    "[class*='postContent']",
    "[class*='post-content']",
    "[class*='entryContent']",
    "[class*='entry-content']",
    "[class*='detailContent']",
    "[class*='detail-content']"
  ];
  const candidates: Array<{ selector: string; content: string; score: number }> = [];
  for (const selector of selectors) {
    for (const element of queryAll(root, selector).slice(0, 8)) {
      const text = elementToText(element);
      const noise = navigationNoiseScore(text);
      if (text.length < 140 || noise > 0.62) continue;
      candidates.push({
        selector,
        content: text,
        score: text.length - noise * 520 - candidates.length * 6
      });
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  if (candidates[0]) return { content: candidates[0].content, extractorUsed: candidates[0].selector };

  const body = queryFirst(root, ["body"]) || root;
  return {
    content: normalizeLines(nodeText(body).split(/\n+/)).join("\n\n"),
    extractorUsed: "body_text_fallback"
  };
}

function looksLikeCodeNoise(content: string) {
  const compact = content.replace(/\s+/g, "");
  if (/window\.__|__NEXT_DATA__|webpack|vite|JSON\.parse|function\(|=>\{|<script|<\/script>|<style|<\/style>/i.test(content)) return true;
  const punctuationCount = (compact.match(/[{}[\]();=<>]/g) || []).length;
  return compact.length > 0 && punctuationCount / compact.length > 0.14;
}

function genericBlockedFailure(content: string, status?: number): ParserFailureType | null {
  const compact = content.replace(/\s+/g, "");
  if (status === 401) return "login_required";
  if (status === 403 || /访问过于频繁|安全验证|验证码|人机验证|访问受限|AccessDenied|Access Denied|Forbidden/i.test(content)) return "blocked_by_platform";
  if (/请登录|登录后查看|登录后继续|注册登录|账号登录/.test(compact) && compact.length < 1200) return "login_required";
  if (/404|页面不存在|内容不存在|文章不存在|页面未找到|NotFound/i.test(content) && compact.length < 1200) return "network_error";
  return null;
}

function platformShellFailure(platform: SourcePlatformKind, content: string, title: string): ParserFailureType | null {
  const compact = content.replace(/\s+/g, "");
  if (platform === "generic_web") {
    if (/^百度$/.test(title) && compact.length < 80) return "platform_shell_page";
    if (/^百度$/.test(title) && /百度一下|请输入搜索词|打开百度App/.test(compact)) return "platform_shell_page";
  }
  if (platform === "wechat_mp") {
    if (/该内容已被发布者删除|此内容因违规无法查看|文章已删除|内容不存在/.test(compact)) return "deleted_or_unavailable";
    if (/请在微信客户端打开|环境异常|参数错误|访问频繁|操作频繁|安全验证|验证码|访问受限/.test(compact)) return "blocked_by_platform";
    if (/登录后查看|请登录/.test(compact)) return "login_required";
  }
  if (platform === "xiaohongshu") {
    if (/打开小红书查看|在小红书App中打开|在小红书APP中打开|下载小红书App|下载小红书APP|请升级浏览器|你的生活兴趣社区/.test(compact)) return "platform_shell_page";
    if (/登录/.test(compact) && compact.length < 600) return "login_required";
    if (/验证码|安全验证|访问频繁|访问受限|风险验证/.test(compact)) return "blocked_by_platform";
    if (/沪ICP备|营业执照|平台服务协议|违法不良信息举报/.test(compact)) return "platform_shell_page";
    if (title.includes("你的生活兴趣社区")) return "platform_shell_page";
  }
  if (platform === "douyin") {
    if (/打开抖音|下载抖音|推荐使用App|推荐使用APP|页面不存在|404|登录后查看|验证码/.test(compact)) return "platform_shell_page";
    if (/登录/.test(compact) && compact.length < 600) return "login_required";
  }
  return null;
}

function isWechatContentContainer(extractorUsed: string) {
  return ["#js_content", ".rich_media_content", ".rich_media_area_primary"].includes(extractorUsed);
}

function invalidReason(input: { title: string; content: string; platform: SourcePlatformKind; extractorUsed: string; imageCount?: number }): Pick<ParserDiagnostic, "failureType" | "failureReason"> | null {
  const { title, content, platform, extractorUsed, imageCount = 0 } = input;
  if (!title || title.length < 2) return { failureType: "container_not_found", failureReason: "标题提取失败，页面可能返回了异常内容。" };
  if (platform === "wechat_mp" && isWechatContentContainer(extractorUsed) && content.length >= 200) return null;
  if (platform === "wechat_mp" && isWechatContentContainer(extractorUsed) && content.length < 200 && imageCount >= 3) {
    return { failureType: "image_heavy_article", failureReason: "该公众号文章可能以图片为主，建议使用 OCR 或截图导入。" };
  }
  const shell = platformShellFailure(platform, content, title);
  if (shell) {
    const reasonMap = {
      wechat_mp: shell === "deleted_or_unavailable"
        ? "微信公众号文章已删除、不可见或内容不可用。"
        : shell === "login_required"
          ? "微信公众号文章需要登录或在平台内查看，服务端无法直接读取正文。"
          : "微信公众号返回的是受限页面或异常页，未能读取到正文容器。",
      xiaohongshu: shell === "login_required"
        ? "小红书内容需要登录后查看，服务端无法直接提取正文。"
        : shell === "blocked_by_platform"
          ? "小红书限制了服务端访问，未能直接提取正文。"
          : "该小红书链接返回的是平台分享页或登录壳页，暂时无法直接提取正文。",
      douyin: "该抖音链接返回的是动态分享页或平台壳页，暂时无法直接提取正文。",
      generic_web: "平台返回了壳页面或受限页面。"
    };
    return { failureType: shell, failureReason: reasonMap[platform] };
  }
  if (looksLikeCodeNoise(content)) return { failureType: "platform_shell_page", failureReason: "页面正文包含大量 JS/CSS/JSON 噪声，疑似动态壳页。" };
  const blocked = genericBlockedFailure(content);
  if (blocked) return { failureType: blocked, failureReason: blocked === "login_required" ? "页面需要登录后查看，服务端无法直接读取正文。" : "平台限制了服务端访问，未能直接读取正文。" };
  const minLength = platform === "wechat_mp" ? 180 : platform === "generic_web" ? 220 : 260;
  if (content.length < minLength) {
    const platformReason = {
      wechat_mp: extractorUsed === "wechat_container_not_found" ? "未找到微信公众号正文容器 #js_content / .rich_media_content，可能被微信限制访问。" : "微信公众号正文提取结果过短，可能返回了壳页或异常页。",
      xiaohongshu: "只提取到标题或简介，未获得稳定正文，可能需要浏览器渲染或登录态。",
      douyin: "只提取到标题或简介，未获得稳定图文正文。",
      generic_web: "正文过短或正文容器提取失败。"
    };
    if (platform === "wechat_mp" && extractorUsed === "wechat_container_not_found") return { failureType: "empty_content", failureReason: platformReason[platform] };
    if (platform === "xiaohongshu") return { failureType: "empty_content", failureReason: platformReason[platform] };
    return { failureType: "content_too_short", failureReason: platformReason[platform] };
  }
  if (navigationNoiseScore(content) > 0.48) return { failureType: "unknown", failureReason: "正文噪声占比过高，可能混入导航、推荐或页脚内容。" };
  return null;
}

function createDiagnostic(input: {
  success: boolean;
  platform: SourcePlatformKind;
  title?: string;
  content?: string;
  htmlLength?: number;
  httpStatus?: number;
  finalHost?: string;
  extractorUsed?: string;
  failureType?: ParserFailureType;
  failureReason?: string;
  containsJsContent?: boolean;
  selectorJsContentHit?: boolean;
  wechatExtractedTextLength?: number;
  wechatQualityFailureReason?: string;
  imageCount?: number;
  invalidReason?: string;
  platformShellFailure?: ParserFailureType | null;
  routeStage?: string;
}): ParserDiagnostic {
  return {
    success: input.success,
    platform: input.platform,
    title: input.title,
    contentLength: input.content?.length ?? 0,
    htmlLength: input.htmlLength,
    httpStatus: input.httpStatus,
    finalHost: input.finalHost,
    extractorUsed: input.extractorUsed,
    failureType: input.failureType,
    failureReason: input.failureReason,
    containsJsContent: input.containsJsContent,
    selectorJsContentHit: input.selectorJsContentHit,
    wechatExtractedTextLength: input.wechatExtractedTextLength,
    wechatQualityFailureReason: input.wechatQualityFailureReason,
    imageCount: input.imageCount,
    invalidReason: input.invalidReason,
    platformShellFailure: input.platformShellFailure,
    routeStage: input.routeStage,
    fallbackOptions: FALLBACK_OPTIONS
  };
}

function createWechatDiagnosticExtras(root: HtmlNode, html: string, candidate?: ParseCandidate, qualityFailure?: Pick<ParserDiagnostic, "failureType" | "failureReason"> | null) {
  const shellFailure = candidate ? platformShellFailure(candidate.platform, candidate.content, candidate.title) : null;
  return {
    containsJsContent: html.includes("js_content"),
    selectorJsContentHit: Boolean(queryFirst(root, ["#js_content"])),
    wechatExtractedTextLength: candidate?.content.length ?? 0,
    wechatQualityFailureReason: qualityFailure?.failureReason,
    imageCount: candidate?.imageCount ?? 0,
    invalidReason: qualityFailure?.failureType,
    platformShellFailure: shellFailure
  };
}

function countImages(element: HtmlNode) {
  return queryAll(element, "img").filter((node) => {
    return Boolean(
      attr(node, "src")
      || attr(node, "data-src")
      || attr(node, "data-original")
      || attr(node, "data-backsrc")
      || attr(node, "data-ratio")
    );
  }).length;
}

function parseWechatArticle(root: HtmlNode, url: string, html?: string): ParseCandidate {
  const title = extractTitleFromDocument(root, url);
  const authorName = extractAuthor(root);
  const publishedAt = extractPublishedAt(root, html);
  let firstContainerCandidate: ParseCandidate | null = null;
  for (const selector of ["#js_content", ".rich_media_content", ".rich_media_area_primary"]) {
    const element = queryFirst(root, [selector]);
    if (!element) continue;
    const content = elementToText(element);
    const imageCount = countImages(element);
    const candidate = { title, content, sourcePlatform: "mp.weixin.qq.com", authorName, publishedAt, extractorUsed: selector, platform: "wechat_mp" as const, imageCount };
    if (!firstContainerCandidate) firstContainerCandidate = candidate;
    if (content.length > 80) return candidate;
  }
  if (firstContainerCandidate) return firstContainerCandidate;
  const fallback = extractFallbackParagraphs(root);
  return { title, content: compactText(fallback.content), sourcePlatform: "mp.weixin.qq.com", authorName, publishedAt, extractorUsed: fallback.content.length > 80 ? fallback.extractorUsed : "wechat_container_not_found", platform: "wechat_mp" };
}

function extractJsonTextFromHtml(html: string, patterns: RegExp[]) {
  const matches: string[] = [];
  for (const pattern of patterns) {
    for (const match of html.matchAll(pattern)) {
      const value = match[1];
      if (!value) continue;
      matches.push(decodeEntities(value.replace(/\\n/g, "\n").replace(/\\"/g, "\"").replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))));
    }
  }
  return normalizeLines(matches).join("\n\n");
}

function cleanJsonString(value: string) {
  return decodeEntities(value
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\n")
    .replace(/\\t/g, " ")
    .replace(/\\"/g, "\"")
    .replace(/\\\//g, "/")
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16))));
}

function scriptTexts(root: HtmlNode) {
  return queryAll(root, "script").map((script) => rawNodeText(script)).filter(Boolean);
}

function extractBalancedObject(text: string, marker: string) {
  const markerIndex = text.indexOf(marker);
  if (markerIndex < 0) return undefined;
  const start = text.indexOf("{", markerIndex);
  if (start < 0) return undefined;
  let depth = 0;
  let inString = false;
  let quote = "";
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === quote) {
        inString = false;
      }
      continue;
    }
    if (char === "\"" || char === "'") {
      inString = true;
      quote = char;
      continue;
    }
    if (char === "{") depth += 1;
    if (char === "}") depth -= 1;
    if (depth === 0) return text.slice(start, index + 1);
  }
  return undefined;
}

function tryParseJson(raw: string) {
  const candidates = [
    raw,
    raw.replace(/undefined/g, "null"),
    raw.replace(/'/g, "\"").replace(/undefined/g, "null")
  ];
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      continue;
    }
  }
  return undefined;
}

function collectXhsFields(value: unknown, output: {
  titles: string[];
  bodies: string[];
  authors: string[];
  published: string[];
  images: string[];
}) {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) collectXhsFields(item, output);
    return;
  }
  const record = value as Record<string, unknown>;
  for (const [key, raw] of Object.entries(record)) {
    if (typeof raw === "string") {
      const normalized = compactText(cleanJsonString(raw));
      if (!normalized) continue;
      const lowerKey = key.toLowerCase();
      if (["title", "displaytitle", "display_title", "notetitle"].includes(lowerKey) && normalized.length >= 2) output.titles.push(normalized);
      if (["desc", "description", "content", "note_desc", "notedesc"].includes(lowerKey) && normalized.length >= 10) output.bodies.push(normalized);
      if (["nickname", "nick_name", "author", "username", "user_name"].includes(lowerKey) && normalized.length >= 2) output.authors.push(normalized);
      if (["time", "timestamp", "last_update_time", "publish_time", "date"].includes(lowerKey)) output.published.push(normalized);
      if ((lowerKey.includes("url") || lowerKey.includes("image")) && /^https?:\/\//.test(normalized) && /\.(jpg|jpeg|png|webp)(\?|$)/i.test(normalized)) output.images.push(normalized);
    } else {
      collectXhsFields(raw, output);
    }
  }
}

function extractXhsStructuredData(root: HtmlNode, html: string) {
  const output = { titles: [] as string[], bodies: [] as string[], authors: [] as string[], published: [] as string[], images: [] as string[] };
  const scripts = scriptTexts(root);
  for (const script of scripts) {
    if (/__INITIAL_STATE__|window\.__INITIAL_STATE__/.test(script)) {
      const raw = extractBalancedObject(script, "__INITIAL_STATE__");
      const parsed = raw ? tryParseJson(raw) : undefined;
      if (parsed) collectXhsFields(parsed, output);
    }
    if (/__NEXT_DATA__|application\/json|hydration|note|desc/i.test(script)) {
      const trimmed = script.trim();
      if ((trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
        const parsed = tryParseJson(trimmed);
        if (parsed) collectXhsFields(parsed, output);
      }
    }
  }
  const regexText = extractJsonTextFromHtml(html, [
    /"(?:desc|description|content|note_desc|noteDesc)"\s*:\s*"([^"]{20,})"/g,
    /"(?:title|display_title|displayTitle)"\s*:\s*"([^"]{4,})"/g
  ]);
  if (regexText) output.bodies.push(regexText);
  return {
    title: output.titles.sort((a, b) => b.length - a.length)[0],
    body: normalizeLines(output.bodies).join("\n\n"),
    author: output.authors[0],
    publishedAt: output.published[0],
    imageUrls: Array.from(new Set(output.images)).slice(0, 12)
  };
}

function parseXiaohongshuArticle(root: HtmlNode, html: string, url: string): ParseCandidate {
  const title = extractTitleFromDocument(root, url);
  const description = metaContent(root, [["name", "description"], ["property", "og:description"], ["name", "twitter:description"]]) ?? "";
  const structured = extractXhsStructuredData(root, html);
  const content = compactText([structured.body, description].filter(Boolean).join("\n\n"));
  return {
    title: structured.title || title,
    content,
    sourcePlatform: "xiaohongshu.com",
    authorName: structured.author,
    publishedAt: structured.publishedAt,
    imageUrls: structured.imageUrls,
    extractorUsed: structured.body ? "xiaohongshu_hydration_json" : "xiaohongshu_meta_description",
    platform: "xiaohongshu"
  };
}

function parseDouyinArticle(root: HtmlNode, html: string, url: string): ParseCandidate {
  const title = extractTitleFromDocument(root, url);
  const description = metaContent(root, [["name", "description"], ["property", "og:description"], ["name", "twitter:description"]]) ?? "";
  const jsonText = extractJsonTextFromHtml(html, [/"desc"\s*:\s*"([^"]{20,})"/g, /"caption"\s*:\s*"([^"]{20,})"/g, /"share_desc"\s*:\s*"([^"]{20,})"/g]);
  const content = compactText([jsonText, description].filter(Boolean).join("\n\n"));
  return { title, content, sourcePlatform: "douyin.com", extractorUsed: jsonText ? "douyin_inline_json" : "douyin_meta_description", platform: "douyin" };
}

function extractJsonLdArticle(root: HtmlNode) {
  for (const script of queryAll(root, "script")) {
    if ((attr(script, "type") || "").toLowerCase() !== "application/ld+json") continue;
    const raw = rawNodeText(script).trim();
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw);
      const items = Array.isArray(parsed) ? parsed : [parsed, ...(Array.isArray(parsed["@graph"]) ? parsed["@graph"] : [])];
      for (const item of items) {
        if (!item || typeof item !== "object") continue;
        const type = Array.isArray(item["@type"]) ? item["@type"].join(",") : String(item["@type"] ?? "");
        if (!/Article|NewsArticle|BlogPosting|Report/i.test(type)) continue;
        const body = compactText(String(item.articleBody ?? item.description ?? ""));
        if (body.length > 180) {
          return {
            title: compactText(String(item.headline ?? item.name ?? "")) || undefined,
            authorName: typeof item.author === "object" ? compactText(String(item.author.name ?? "")) : compactText(String(item.author ?? "")),
            publishedAt: compactText(String(item.datePublished ?? "")) || undefined,
            content: body
          };
        }
      }
    } catch {
      continue;
    }
  }
  return null;
}

function parseGenericArticle(root: HtmlNode, url: string, sourcePlatform: string): ParseCandidate {
  const title = extractTitleFromDocument(root, url);
  const authorName = extractAuthor(root);
  const publishedAt = extractPublishedAt(root);
  const jsonLd = extractJsonLdArticle(root);
  if (jsonLd?.content) {
    return { title: jsonLd.title ?? title, content: compactText(jsonLd.content), sourcePlatform, authorName: jsonLd.authorName || authorName, publishedAt: jsonLd.publishedAt || publishedAt, extractorUsed: "json_ld_article", platform: "generic_web" };
  }
  const fallback = extractFallbackParagraphs(root);
  return { title, content: compactText(fallback.content), sourcePlatform, authorName, publishedAt, extractorUsed: fallback.extractorUsed, platform: "generic_web" };
}

function failureMessage(diagnostic: ParserDiagnostic) {
  if (diagnostic.platform === "xiaohongshu") {
    if (diagnostic.failureType === "unsupported_url_shape") return "该小红书链接没有进入具体笔记页，可能是首页、用户页、分享壳页或已失效短链。请打开原文后使用导入助手。";
    if (diagnostic.failureType === "login_required") return "小红书内容需要登录后查看，服务端无法直接解析。请使用导入助手或手动粘贴。";
    if (diagnostic.failureType === "blocked_by_platform") return "小红书限制了服务端访问。请打开原文后使用导入助手，或使用 OCR / 手动粘贴。";
    if (diagnostic.failureType === "platform_shell_page") return "当前链接返回的是小红书平台壳页，不是正文页。请使用导入助手或手动粘贴。";
    return "小红书内容可能需要浏览器渲染或登录态。请打开原文后使用导入助手，或使用 OCR / 手动粘贴。";
  }
  if (diagnostic.platform === "douyin") return "该抖音链接返回的是动态分享页或平台壳页，暂时无法直接提取正文。你可以手动粘贴正文、上传截图 OCR，或先保存为待处理链接。";
  if (diagnostic.platform === "wechat_mp") {
    if (diagnostic.failureType === "deleted_or_unavailable") return "公众号文章已删除、不可见或内容不可用。请检查原文链接。";
    if (diagnostic.failureType === "login_required") return "该公众号内容需要在平台内登录后查看，服务端无法直接解析。请使用导入助手或手动粘贴正文。";
    if (diagnostic.failureType === "blocked_by_platform" || diagnostic.failureType === "platform_shell_page") return "公众号文章可能限制服务端访问。请打开原文后使用导入助手，或手动粘贴正文。";
    return diagnostic.failureReason || "微信公众号正文提取失败，请使用手动粘贴、OCR 或保存为待处理链接。";
  }
  if (diagnostic.failureType === "anti_crawler" || diagnostic.failureType === "blocked_by_platform") return "平台限制了服务端访问，暂时无法直接解析正文。请使用手动粘贴、OCR，或保存为待处理链接。";
  if (diagnostic.failureType === "login_required") return "该页面需要登录后查看，服务端无法读取正文。请使用手动粘贴、OCR，或保存为待处理链接。";
  if (diagnostic.failureType === "container_not_found") return "暂未识别到正文容器。可以使用手动粘贴、OCR，或保存为待处理链接。";
  return diagnostic.failureReason || "正文提取失败，请使用手动粘贴、OCR 或保存为待处理链接。";
}

function normalizeCharset(charset?: string | null) {
  const normalized = charset?.trim().toLowerCase().replace(/^["']|["']$/g, "");
  if (!normalized) return "utf-8";
  if (["gbk", "gb2312", "gb18030"].includes(normalized)) return "gb18030";
  if (normalized === "unicode") return "utf-8";
  return normalized;
}

async function readHtml(response: Response) {
  const bytes = Buffer.from(await response.arrayBuffer());
  const contentType = response.headers.get("content-type") || "";
  const headerCharset = contentType.match(/charset=([^;]+)/i)?.[1];
  let charset = normalizeCharset(headerCharset);
  let html = "";
  try {
    html = new TextDecoder(charset).decode(bytes);
  } catch {
    charset = "utf-8";
    html = new TextDecoder("utf-8").decode(bytes);
  }
  if (!headerCharset) {
    const metaCharset = html.match(/<meta[^>]+charset=["']?\s*([^"'\s/>]+)/i)?.[1]
      || html.match(/<meta[^>]+content=["'][^"']*charset=([^"';\s]+)/i)?.[1];
    const nextCharset = normalizeCharset(metaCharset);
    if (metaCharset && nextCharset !== charset) {
      try {
        html = new TextDecoder(nextCharset).decode(bytes);
      } catch {
        // keep the first decoded html
      }
    }
  }
  return html;
}

export async function parseArticleFromUrl(url: string): Promise<ParsedArticle> {
  const originalHost = safeHostname(url);
  const fetchPage = async (userAgent: string) => {
    const response = await fetch(url, {
      headers: {
        "user-agent": userAgent,
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
        "cache-control": "no-cache",
        pragma: "no-cache",
        "upgrade-insecure-requests": "1",
        referer: "https://www.google.com/"
      },
      redirect: "follow",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
    });
    const finalUrl = response.url || url;
    const finalHost = safeHostname(finalUrl);
    const platform = detectSourcePlatform(finalUrl) !== "generic_web" ? detectSourcePlatform(finalUrl) : detectSourcePlatform(url);
    return { response, finalUrl, finalHost, platform };
  };

  let response: Response;
  let finalUrl = url;
  let finalHost = originalHost;
  let platform = detectSourcePlatform(url);
  try {
    const fetched = await fetchPage(DESKTOP_USER_AGENT);
    response = fetched.response;
    finalUrl = fetched.finalUrl;
    finalHost = fetched.finalHost;
    platform = fetched.platform;
  } catch (error) {
    platform = detectSourcePlatform(url);
    const diagnostic = createDiagnostic({
      success: false,
      platform,
      failureType: "network_error",
      failureReason: error instanceof Error ? `网络请求失败：${error.message}` : "网络请求失败"
    });
    parserLog("request_failed", { hostname: originalHost, parserType: platform, failureType: diagnostic.failureType, failureReason: diagnostic.failureReason });
    throw new ParserError(failureMessage(diagnostic), diagnostic);
  }

  if (!response.ok) {
    const blockedFailure = genericBlockedFailure("", response.status);
    const diagnostic = createDiagnostic({
      success: false,
      platform,
      httpStatus: response.status,
      finalHost,
      failureType: blockedFailure ?? (response.status === 403 ? "anti_crawler" : "network_error"),
      failureReason: response.status === 403 ? "网页请求被平台拒绝：403" : `网页请求失败：${response.status}`
    });
    parserLog("http_failed", { hostname: originalHost, parserType: platform, status: response.status, finalHost, failureType: diagnostic.failureType, failureReason: diagnostic.failureReason });
    throw new ParserError(failureMessage(diagnostic), diagnostic);
  }

  const html = await readHtml(response);
  const root = parse5.parse(html) as unknown as HtmlNode;
  const sourcePlatform = sourcePlatformLabel(platform, finalUrl);
  if (platform === "xiaohongshu" && !supportedXiaohongshuUrlShape(finalUrl)) {
    const diagnostic = createDiagnostic({
      success: false,
      platform,
      title: extractTitleFromDocument(root, finalUrl),
      content: "",
      htmlLength: html.length,
      httpStatus: response.status,
      finalHost,
      extractorUsed: "xiaohongshu_url_shape",
      failureType: "unsupported_url_shape",
      failureReason: "该小红书链接没有跳转到具体笔记页，可能是首页、用户页、分享壳页或已失效短链。"
    });
    parserLog("quality_failed", { hostname: originalHost, parserType: platform, status: response.status, finalHost, htmlLength: html.length, extractedLength: 0, failureType: diagnostic.failureType, failureReason: diagnostic.failureReason });
    throw new ParserError(failureMessage(diagnostic), diagnostic);
  }
  const candidate =
    platform === "wechat_mp"
      ? parseWechatArticle(root, finalUrl, html)
      : platform === "xiaohongshu"
        ? parseXiaohongshuArticle(root, html, finalUrl)
        : platform === "douyin"
          ? parseDouyinArticle(root, html, finalUrl)
          : parseGenericArticle(root, finalUrl, sourcePlatform);

  const qualityFailure = invalidReason(candidate);
  const wechatExtras = platform === "wechat_mp" ? createWechatDiagnosticExtras(root, html, candidate, qualityFailure) : {};
  if (qualityFailure && platform === "wechat_mp" && candidate.extractorUsed === "wechat_container_not_found") {
    try {
      const retry = await fetchPage(WECHAT_WEBVIEW_USER_AGENT);
      if (retry.response.ok) {
        const retryHtml = await readHtml(retry.response);
        const retryRoot = parse5.parse(retryHtml) as unknown as HtmlNode;
        const retryCandidate = parseWechatArticle(retryRoot, retry.finalUrl, retryHtml);
        const retryFailure = invalidReason(retryCandidate);
        const retryWechatExtras = createWechatDiagnosticExtras(retryRoot, retryHtml, retryCandidate, retryFailure);
        if (!retryFailure) {
          parserLog("success", {
            hostname: originalHost,
            parserType: "wechat_mp",
            status: retry.response.status,
            finalHost: retry.finalHost,
            htmlLength: retryHtml.length,
            extractedLength: retryCandidate.content.length,
            ...retryWechatExtras
          });
          return {
            title: retryCandidate.title,
            content: retryCandidate.content,
            sourcePlatform: retryCandidate.sourcePlatform,
            authorName: retryCandidate.authorName,
            publishedAt: retryCandidate.publishedAt,
            imageUrls: retryCandidate.imageUrls,
            diagnostic: createDiagnostic({
              success: true,
              platform: "wechat_mp",
              title: retryCandidate.title,
              content: retryCandidate.content,
              htmlLength: retryHtml.length,
              httpStatus: retry.response.status,
              finalHost: retry.finalHost,
              extractorUsed: `${retryCandidate.extractorUsed}_wechat_webview_retry`,
              ...retryWechatExtras
            })
          };
        }
      }
    } catch {
      // Keep the original desktop diagnostic; the fallback is best-effort only.
    }
  }
  if (qualityFailure) {
    const diagnostic = createDiagnostic({
      success: false,
      platform,
      title: candidate.title,
      content: candidate.content,
      htmlLength: html.length,
      httpStatus: response.status,
      finalHost,
      extractorUsed: candidate.extractorUsed,
      failureType: qualityFailure.failureType,
      failureReason: qualityFailure.failureReason,
      ...wechatExtras
    });
    parserLog("quality_failed", { hostname: originalHost, parserType: platform, status: response.status, finalHost, htmlLength: html.length, extractedLength: candidate.content.length, failureType: diagnostic.failureType, failureReason: diagnostic.failureReason, ...wechatExtras });
    throw new ParserError(failureMessage(diagnostic), diagnostic);
  }

  parserLog("success", { hostname: originalHost, parserType: platform, status: response.status, finalHost, htmlLength: html.length, extractedLength: candidate.content.length, ...wechatExtras });

  return {
    title: candidate.title,
    content: candidate.content,
    sourcePlatform: candidate.sourcePlatform,
    authorName: candidate.authorName,
    publishedAt: candidate.publishedAt,
    imageUrls: candidate.imageUrls,
    diagnostic: createDiagnostic({
      success: true,
      platform,
      title: candidate.title,
      content: candidate.content,
      htmlLength: html.length,
      httpStatus: response.status,
      finalHost,
      extractorUsed: candidate.extractorUsed,
      ...wechatExtras
    })
  };
}
