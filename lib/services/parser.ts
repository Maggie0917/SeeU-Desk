import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";
import { compactText } from "@/lib/text";

export type SourcePlatformKind = "wechat_mp" | "xiaohongshu" | "douyin" | "generic_web";

export type ParserFailureType =
  | "content_too_short"
  | "container_not_found"
  | "platform_shell_page"
  | "login_required"
  | "dynamic_render_required"
  | "anti_crawler"
  | "network_error"
  | "unknown";

export type ParserDiagnostic = {
  success: boolean;
  platform: SourcePlatformKind;
  title?: string;
  contentLength?: number;
  extractorUsed?: string;
  failureReason?: string;
  failureType?: ParserFailureType;
  fallbackOptions: Array<"manual_paste" | "ocr" | "save_pending">;
};

export type ParsedArticle = {
  title: string;
  content: string;
  sourcePlatform: string;
  authorName?: string;
  publishedAt?: string;
  diagnostic: ParserDiagnostic;
};

type ParseCandidate = Omit<ParsedArticle, "diagnostic"> & {
  extractorUsed: string;
  platform: SourcePlatformKind;
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
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "generic_web";
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

function stripTags(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, "")
    .replace(/<svg[\s\S]*?<\/svg>/gi, "")
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, "");
}

function metaContent(document: Document, selectors: string[]) {
  for (const selector of selectors) {
    const value = document.querySelector(selector)?.getAttribute("content")?.trim();
    if (value) return compactText(decodeEntities(value));
  }
  return undefined;
}

function extractTitleFromDocument(document: Document, url: string) {
  const metaTitle = metaContent(document, [
    "meta[property='og:title']",
    "meta[name='twitter:title']",
    "meta[name='title']"
  ]);
  const rawTitle = metaTitle ?? document.querySelector("title")?.textContent ?? "";
  const title = compactText(decodeEntities(rawTitle))
    .replace(/\s*[-_]\s*微信公众平台\s*$/, "")
    .replace(/\s*-\s*小红书\s*$/, "")
    .replace(/\s*-\s*抖音\s*$/, "");
  if (title) return title;
  return new URL(url).hostname;
}

function extractAuthor(document: Document) {
  const metaAuthor = metaContent(document, [
    "meta[name='author']",
    "meta[property='article:author']",
    "meta[name='byl']"
  ]);
  const byline = document.querySelector("#js_name, [rel='author'], .author, .byline, [class*='author'], [class*='byline']")?.textContent;
  return compactText(metaAuthor ?? byline ?? "") || undefined;
}

function extractPublishedAt(document: Document) {
  return (metaContent(document, [
    "meta[property='article:published_time']",
    "meta[name='pubdate']",
    "meta[name='publishdate']",
    "meta[name='date']",
    "meta[itemprop='datePublished']"
  ]) ?? compactText(document.querySelector("#publish_time, time")?.textContent ?? "")) || undefined;
}

function removeNoiseNodes(root: ParentNode) {
  root.querySelectorAll(
    [
      "script",
      "style",
      "noscript",
      "svg",
      "iframe",
      "form",
      "nav",
      "footer",
      "aside",
      ".qr_code_pc",
      ".rich_media_tool",
      ".profile_inner",
      ".js_ad_area",
      ".reward_area",
      ".comment_area",
      ".related_container",
      "[class*='advert']",
      "[class*='recommend']",
      "[class*='footer']",
      "[class*='comment']"
    ].join(",")
  ).forEach((node) => node.remove());
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
      if (/ICP备|营业执照|隐私政策|用户协议|违法不良信息举报|版权所有|Copyright/i.test(line)) return false;
      const key = compact.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function elementToText(element: Element) {
  const clone = element.cloneNode(true) as Element;
  removeNoiseNodes(clone);
  const blockSelectors = "p, section, h1, h2, h3, h4, li, blockquote";
  const lines = Array.from(clone.querySelectorAll(blockSelectors))
    .map((node) => node.textContent ?? "")
    .filter((text) => compactText(text).length > 6);
  const normalized = normalizeLines(lines);
  if (normalized.join("\n").length > 120) return normalized.join("\n\n");
  return normalizeLines((clone.textContent ?? "").split(/\n+/)).join("\n\n");
}

function extractFallbackParagraphs(document: Document) {
  removeNoiseNodes(document);
  const selectors = [
    "article",
    "main",
    "[itemprop='articleBody']",
    ".article-content",
    ".post-content",
    ".entry-content",
    ".content",
    ".article",
    "#content"
  ];
  for (const selector of selectors) {
    const element = document.querySelector(selector);
    if (!element) continue;
    const text = elementToText(element);
    if (text.length > 180) return { content: text, extractorUsed: selector };
  }
  return {
    content: normalizeLines((document.body?.textContent ?? "").split(/\n+/)).join("\n\n"),
    extractorUsed: "body_text_fallback"
  };
}

function htmlToParagraphText(html: string) {
  const dom = new JSDOM(`<article>${html}</article>`);
  return elementToText(dom.window.document.querySelector("article")!);
}

function looksLikeCodeNoise(content: string) {
  const compact = content.replace(/\s+/g, "");
  if (/window\.__|__NEXT_DATA__|webpack|vite|JSON\.parse|function\(|=>\{|<script|<\/script>|<style|<\/style>/i.test(content)) {
    return true;
  }
  const punctuationCount = (compact.match(/[{}[\]();=<>]/g) || []).length;
  return compact.length > 0 && punctuationCount / compact.length > 0.14;
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

function platformShellFailure(platform: SourcePlatformKind, content: string, title: string): ParserFailureType | null {
  const compact = content.replace(/\s+/g, "");
  if (platform === "wechat_mp") {
    if (/请在微信客户端打开|环境异常|参数错误|该内容已被发布者删除|此内容因违规无法查看/.test(compact)) return "platform_shell_page";
  }
  if (platform === "xiaohongshu") {
    if (/打开小红书查看|登录后查看更多|下载小红书App|下载小红书APP|请升级浏览器|你的生活兴趣社区/.test(compact)) return "platform_shell_page";
    if (/登录/.test(compact) && compact.length < 600) return "login_required";
    if (/沪ICP备|营业执照|平台服务协议|违法不良信息举报/.test(compact)) return "platform_shell_page";
    if (title.includes("你的生活兴趣社区")) return "platform_shell_page";
  }
  if (platform === "douyin") {
    if (/打开抖音|下载抖音|推荐使用App|推荐使用APP|页面不存在|404|登录后查看|验证码/.test(compact)) return "platform_shell_page";
    if (/登录/.test(compact) && compact.length < 600) return "login_required";
  }
  return null;
}

function invalidReason(input: { title: string; content: string; platform: SourcePlatformKind; extractorUsed: string }): Pick<ParserDiagnostic, "failureType" | "failureReason"> | null {
  const { title, content, platform, extractorUsed } = input;
  if (!title || title.length < 2) {
    return { failureType: "container_not_found", failureReason: "标题提取失败，页面可能返回了异常内容。" };
  }
  const shell = platformShellFailure(platform, content, title);
  if (shell) {
    const reasonMap = {
      wechat_mp: "微信公众号返回的是受限页面或异常页，未能读取到正文容器。",
      xiaohongshu: "该小红书链接返回的是平台分享页或登录壳页，暂时无法直接提取正文。",
      douyin: "该抖音链接返回的是动态分享页或平台壳页，暂时无法直接提取正文。",
      generic_web: "平台返回了壳页面或受限页面。"
    };
    return { failureType: shell, failureReason: reasonMap[platform] };
  }
  if (looksLikeCodeNoise(content)) {
    return { failureType: "platform_shell_page", failureReason: "页面正文包含大量 JS/CSS/JSON 噪声，疑似动态壳页。" };
  }
  const minLength = platform === "wechat_mp" ? 180 : platform === "generic_web" ? 220 : 260;
  if (content.length < minLength) {
    const platformReason = {
      wechat_mp: extractorUsed === "wechat_container_not_found"
        ? "未找到微信公众号正文容器 #js_content / .rich_media_content，可能被微信限制访问。"
        : "微信公众号正文提取结果过短，可能返回了壳页或异常页。",
      xiaohongshu: "只提取到标题或简介，未获得稳定正文。",
      douyin: "只提取到标题或简介，未获得稳定图文正文。",
      generic_web: "正文过短或正文容器提取失败。"
    };
    return { failureType: extractorUsed === "wechat_container_not_found" ? "container_not_found" : "content_too_short", failureReason: platformReason[platform] };
  }
  if (navigationNoiseScore(content) > 0.48) {
    return { failureType: "unknown", failureReason: "正文噪声占比过高，可能混入导航、推荐或页脚内容。" };
  }
  return null;
}

function createDiagnostic(input: {
  success: boolean;
  platform: SourcePlatformKind;
  title?: string;
  content?: string;
  extractorUsed?: string;
  failureType?: ParserFailureType;
  failureReason?: string;
}): ParserDiagnostic {
  return {
    success: input.success,
    platform: input.platform,
    title: input.title,
    contentLength: input.content?.length ?? 0,
    extractorUsed: input.extractorUsed,
    failureType: input.failureType,
    failureReason: input.failureReason,
    fallbackOptions: FALLBACK_OPTIONS
  };
}

function parseWechatArticle(document: Document, url: string): ParseCandidate {
  const title = extractTitleFromDocument(document, url);
  const authorName = extractAuthor(document);
  const publishedAt = extractPublishedAt(document);
  const selectors = ["#js_content", ".rich_media_content", ".rich_media_area_primary #js_content", ".rich_media_area_primary"];
  for (const selector of selectors) {
    const element = document.querySelector(selector);
    if (!element) continue;
    const content = compactText(elementToText(element));
    if (content.length > 80) {
      return {
        title,
        content,
        sourcePlatform: "mp.weixin.qq.com",
        authorName,
        publishedAt,
        extractorUsed: selector,
        platform: "wechat_mp"
      };
    }
  }
  const fallback = extractFallbackParagraphs(document);
  return {
    title,
    content: compactText(fallback.content),
    sourcePlatform: "mp.weixin.qq.com",
    authorName,
    publishedAt,
    extractorUsed: fallback.content.length > 80 ? fallback.extractorUsed : "wechat_container_not_found",
    platform: "wechat_mp"
  };
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

function parseXiaohongshuArticle(document: Document, html: string, url: string): ParseCandidate {
  const title = extractTitleFromDocument(document, url);
  const description = metaContent(document, [
    "meta[name='description']",
    "meta[property='og:description']",
    "meta[name='twitter:description']"
  ]) ?? "";
  const jsonText = extractJsonTextFromHtml(html, [
    /"desc"\s*:\s*"([^"]{20,})"/g,
    /"content"\s*:\s*"([^"]{20,})"/g,
    /"note_desc"\s*:\s*"([^"]{20,})"/g
  ]);
  const content = compactText([jsonText, description].filter(Boolean).join("\n\n"));
  return {
    title,
    content,
    sourcePlatform: "xiaohongshu.com",
    extractorUsed: jsonText ? "xiaohongshu_ssr_json" : "xiaohongshu_meta_description",
    platform: "xiaohongshu"
  };
}

function parseDouyinArticle(document: Document, html: string, url: string): ParseCandidate {
  const title = extractTitleFromDocument(document, url);
  const description = metaContent(document, [
    "meta[name='description']",
    "meta[property='og:description']",
    "meta[name='twitter:description']"
  ]) ?? "";
  const jsonText = extractJsonTextFromHtml(html, [
    /"desc"\s*:\s*"([^"]{20,})"/g,
    /"caption"\s*:\s*"([^"]{20,})"/g,
    /"share_desc"\s*:\s*"([^"]{20,})"/g
  ]);
  const content = compactText([jsonText, description].filter(Boolean).join("\n\n"));
  return {
    title,
    content,
    sourcePlatform: "douyin.com",
    extractorUsed: jsonText ? "douyin_inline_json" : "douyin_meta_description",
    platform: "douyin"
  };
}

function parseGenericArticle(document: Document, html: string, url: string, sourcePlatform: string): ParseCandidate {
  const title = extractTitleFromDocument(document, url);
  const authorName = extractAuthor(document);
  const publishedAt = extractPublishedAt(document);
  let content = "";
  let extractorUsed = "readability";

  try {
    const reader = new Readability(document.cloneNode(true) as Document, {
      charThreshold: 220
    });
    const article = reader.parse();
    if (article?.textContent && article.textContent.trim().length > 180) {
      content = htmlToParagraphText(article.content || article.textContent);
    }
  } catch {
    content = "";
  }

  if (!content) {
    const fallback = extractFallbackParagraphs(new JSDOM(stripTags(html), { url }).window.document);
    content = fallback.content;
    extractorUsed = fallback.extractorUsed;
  }

  return {
    title,
    content: compactText(content),
    sourcePlatform,
    authorName,
    publishedAt,
    extractorUsed,
    platform: "generic_web"
  };
}

function failureMessage(diagnostic: ParserDiagnostic) {
  if (diagnostic.platform === "xiaohongshu") {
    return "该小红书链接返回的是平台分享页或登录壳页，暂时无法直接提取正文。你可以手动复制正文粘贴导入、上传截图通过 OCR 转成阅读文本，或先保存为待处理链接。";
  }
  if (diagnostic.platform === "douyin") {
    return "该抖音链接返回的是动态分享页或平台壳页，暂时无法直接提取正文。你可以手动粘贴正文、上传截图 OCR，或先保存为待处理链接。";
  }
  if (diagnostic.platform === "wechat_mp") {
    return diagnostic.failureReason || "微信公众号正文提取失败，请使用手动粘贴、OCR 或保存为待处理链接。";
  }
  return diagnostic.failureReason || "正文提取失败，请使用手动粘贴、OCR 或保存为待处理链接。";
}

export async function parseArticleFromUrl(url: string): Promise<ParsedArticle> {
  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 KnowledgeReadingDesk/0.1",
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
        referer: "https://www.google.com/"
      },
      redirect: "follow",
      signal: AbortSignal.timeout(16000)
    });
  } catch (error) {
    const platform = detectSourcePlatform(url);
    const diagnostic = createDiagnostic({
      success: false,
      platform,
      failureType: "network_error",
      failureReason: error instanceof Error ? `网络请求失败：${error.message}` : "网络请求失败"
    });
    throw new ParserError(failureMessage(diagnostic), diagnostic);
  }

  const finalUrl = response.url || url;
  const platform = detectSourcePlatform(finalUrl) !== "generic_web" ? detectSourcePlatform(finalUrl) : detectSourcePlatform(url);
  if (!response.ok) {
    const diagnostic = createDiagnostic({
      success: false,
      platform,
      failureType: response.status === 403 ? "anti_crawler" : "network_error",
      failureReason: `网页请求失败：${response.status}`
    });
    throw new ParserError(failureMessage(diagnostic), diagnostic);
  }

  const html = await response.text();
  const dom = new JSDOM(html, { url: finalUrl });
  const document = dom.window.document;
  const sourcePlatform = sourcePlatformLabel(platform, finalUrl);
  const candidate =
    platform === "wechat_mp"
      ? parseWechatArticle(document, finalUrl)
      : platform === "xiaohongshu"
        ? parseXiaohongshuArticle(document, html, finalUrl)
        : platform === "douyin"
          ? parseDouyinArticle(document, html, finalUrl)
          : parseGenericArticle(document, html, finalUrl, sourcePlatform);

  const qualityFailure = invalidReason(candidate);
  if (qualityFailure) {
    const diagnostic = createDiagnostic({
      success: false,
      platform,
      title: candidate.title,
      content: candidate.content,
      extractorUsed: candidate.extractorUsed,
      failureType: qualityFailure.failureType,
      failureReason: qualityFailure.failureReason
    });
    throw new ParserError(failureMessage(diagnostic), diagnostic);
  }

  return {
    title: candidate.title,
    content: candidate.content,
    sourcePlatform: candidate.sourcePlatform,
    authorName: candidate.authorName,
    publishedAt: candidate.publishedAt,
    diagnostic: createDiagnostic({
      success: true,
      platform,
      title: candidate.title,
      content: candidate.content,
      extractorUsed: candidate.extractorUsed
    })
  };
}
