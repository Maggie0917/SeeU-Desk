import { prisma } from "@/lib/prisma";
import { NOTE_TYPE_LABELS } from "@/lib/constants";

type FeishuTokenResponse = {
  code?: number;
  msg?: string;
  error?: string;
  error_description?: string;
  access_token?: string;
  user_access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
  scope?: string;
  open_id?: string;
  tenant_key?: string;
  data?: {
    access_token?: string;
    user_access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    token_type?: string;
    scope?: string;
    open_id?: string;
    tenant_key?: string;
  };
};

type FeishuDocumentResponse = {
  code?: number;
  msg?: string;
  error?: string;
  error_description?: string;
  data?: {
    document?: {
      document_id?: string;
      revision_id?: number;
      title?: string;
      url?: string;
    };
    document_id?: string;
    url?: string;
  };
};

export class FeishuError extends Error {
  stage?: string;
  raw?: unknown;

  constructor(message: string, options?: { stage?: string; raw?: unknown }) {
    super(message);
    this.name = "FeishuError";
    this.stage = options?.stage;
    this.raw = options?.raw;
  }
}

const FEISHU_OAUTH_TOKEN_PATH = "/open-apis/authen/v2/oauth/token";
const FEISHU_DOCX_SCOPES = ["docx:document", "docx:document:create"];
const FEISHU_CALLBACK_PATH = "/api/feishu/callback";

function normalizeProductionOrigin(value?: string | null) {
  const raw = value?.trim();
  if (!raw) return null;
  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const url = new URL(withProtocol);
    url.protocol = "https:";
    return url.origin;
  } catch {
    return null;
  }
}

export function getFeishuRedirectUri() {
  if (process.env.NODE_ENV === "production") {
    const explicit = process.env.FEISHU_REDIRECT_URI?.trim();
    const productionOrigin = normalizeProductionOrigin(
      explicit ||
      process.env.DOMAIN ||
      process.env.NEXT_PUBLIC_APP_URL ||
      process.env.APP_URL ||
      process.env.VERCEL_URL
    );

    return productionOrigin ? `${productionOrigin}${FEISHU_CALLBACK_PATH}` : "";
  }

  const port = process.env.PORT?.trim() || "3000";
  return `http://localhost:${port}${FEISHU_CALLBACK_PATH}`;
}

function getFeishuConfig() {
  const appId = process.env.FEISHU_APP_ID?.trim();
  const appSecret = process.env.FEISHU_APP_SECRET?.trim();
  const redirectUri = getFeishuRedirectUri();

  if (!appId || !appSecret || !redirectUri) return null;

  return {
    appId,
    appSecret,
    redirectUri,
    baseUrl: "https://open.feishu.cn"
  };
}

export function getFeishuConnectionStatus() {
  return getFeishuConfig() ? "not_connected" : "not_configured";
}

export function getFeishuAuthUrl(state: string) {
  const config = getFeishuConfig();
  if (!config) {
    throw new FeishuError("飞书真实授权未完成：请先配置飞书应用凭证和当前环境的回调域名。");
  }

  const params = new URLSearchParams({
    app_id: config.appId,
    redirect_uri: config.redirectUri,
    state,
    scope: FEISHU_DOCX_SCOPES.join(" ")
  });

  return `${config.baseUrl}/open-apis/authen/v1/authorize?${params.toString()}`;
}

function redactSensitive(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSensitive);
  if (!value || typeof value !== "object") return value;

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => {
      if (/app_secret|client_secret|access_token|user_access_token|refresh_token/i.test(key)) {
        return [key, item ? "[REDACTED]" : item];
      }
      return [key, redactSensitive(item)];
    })
  );
}

export function redactFeishuDebug(value: unknown): unknown {
  return redactSensitive(value);
}

function tokenErrorMessage(data: FeishuTokenResponse, fallback: string) {
  const raw = data.msg || data.error_description || data.error || fallback;
  if (/redirect|重定向|回调|uri|url/i.test(raw)) {
    return `${raw}。请检查当前环境自动生成的飞书回调地址是否与飞书开放平台后台配置的重定向 URL 完全一致。`;
  }
  return raw;
}

function feishuApiErrorMessage(data: { msg?: string; error?: string; error_description?: string }, fallback: string) {
  const raw = data.msg || data.error_description || data.error || fallback;
  if (/docx:document|docx:document:create|required one of these privileges|Unauthorized/i.test(raw)) {
    return "飞书应用仍未获得新版文档创建/编辑权限。请确认飞书开放平台中 docx:document 和 docx:document:create 已启用，并完成发布/审批后重新授权。";
  }
  return raw;
}

function stageLabel(stage?: string) {
  return {
    token_validation: "飞书 token 校验失败",
    create_document: "飞书文档创建失败",
    create_blocks_structured: "飞书结构化内容写入失败",
    create_blocks_outline_fallback: "飞书大纲降级内容写入失败",
    create_blocks_full: "飞书内容写入失败",
    create_blocks_plain_fallback: "飞书内容降级写入失败",
    folder_token_validation: "folder_token 无效"
  }[stage || ""] || "飞书 API 调用失败";
}

export function parseFeishuFolderToken(input: string): string | null {
  const value = input.trim();
  if (!value) return null;

  try {
    const url = new URL(value);
    const decodedPath = decodeURIComponent(url.pathname);
    const pathMatch =
      decodedPath.match(/\/drive\/folder\/([A-Za-z0-9_-]+)/) ??
      decodedPath.match(/\/folder\/([A-Za-z0-9_-]+)/) ??
      decodedPath.match(/\/space\/folder\/([A-Za-z0-9_-]+)/);
    const queryToken =
      url.searchParams.get("folder_token") ||
      url.searchParams.get("folderToken") ||
      url.searchParams.get("token");
    return pathMatch?.[1] || queryToken || null;
  } catch {
    if (isLikelyFeishuFolderToken(value)) return value;
    return null;
  }
}

export function isLikelyFeishuFolderToken(token: string) {
  const value = token.trim();
  if (!value) return false;
  if (/[\u4e00-\u9fa5\s]/.test(value)) return false;
  if (/^https?:\/\//i.test(value)) return parseFeishuFolderToken(value) !== null;
  return /^[A-Za-z0-9_-]{8,}$/.test(value);
}

function summarizeFeishuBody(body: unknown) {
  const redacted = redactSensitive(body);
  if (!body || typeof body !== "object") return redacted;
  const record = body as Record<string, unknown>;
  if (Array.isArray(record.children)) {
    return {
      ...(redacted as Record<string, unknown>),
      childrenSummary: {
        count: record.children.length,
        first: record.children[0]
      }
    };
  }
  return redacted;
}

function pickUserAccessToken(data: FeishuTokenResponse): { path: string; value: string } | null {
  const candidates = [
    { path: "data.access_token", value: data.data?.access_token },
    { path: "data.user_access_token", value: data.data?.user_access_token },
    { path: "access_token", value: data.access_token },
    { path: "user_access_token", value: data.user_access_token }
  ];
  const token = candidates.find((item) => typeof item.value === "string" && item.value.length > 0);
  return token ? { path: token.path, value: token.value as string } : null;
}

function pickRefreshToken(data: FeishuTokenResponse) {
  return data.data?.refresh_token ?? data.refresh_token;
}

function pickTokenMeta(data: FeishuTokenResponse) {
  return {
    expiresIn: data.data?.expires_in ?? data.expires_in ?? 3600,
    tokenType: data.data?.token_type ?? data.token_type,
    scope: data.data?.scope ?? data.scope,
    openId: data.data?.open_id ?? data.open_id,
    tenantKey: data.data?.tenant_key ?? data.tenant_key
  };
}

async function requestUserAccessToken(body: Record<string, string>) {
  const config = getFeishuConfig();
  if (!config) {
    throw new FeishuError("飞书真实授权未完成：缺少开放平台应用配置。");
  }

  const url = `${config.baseUrl}${FEISHU_OAUTH_TOKEN_PATH}`;
  console.info("飞书 user_access_token 请求", {
    url,
    body: redactSensitive(body)
  });

  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20000)
  });
  const data = (await response.json().catch(() => ({}))) as FeishuTokenResponse;

  console.info("飞书 user_access_token 返回", redactSensitive(data));

  if (!response.ok) {
    throw new FeishuError(`飞书授权失败：${tokenErrorMessage(data, response.statusText || String(response.status))}`);
  }
  if (typeof data.code === "number" && data.code !== 0) {
    throw new FeishuError(`飞书授权失败：${tokenErrorMessage(data, "飞书返回 code != 0")}`);
  }

  const token = pickUserAccessToken(data);
  if (!token) {
    throw new FeishuError(
      `飞书授权失败：回调未返回 user_access_token。已检查 data.access_token、data.user_access_token、access_token、user_access_token。飞书返回：${JSON.stringify(redactSensitive(data))}`
    );
  }

  return {
    data,
    accessToken: token.value,
    accessTokenPath: token.path,
    refreshToken: pickRefreshToken(data),
    ...pickTokenMeta(data)
  };
}

async function feishuFetch<T>(path: string, init: RequestInit, options?: { stage?: string; body?: unknown; debug?: unknown }) {
  const config = getFeishuConfig();
  if (!config) {
    throw new FeishuError("飞书 API 未配置。");
  }

  const endpoint = `${config.baseUrl}${path}`;
  const method = init.method || "GET";
  console.info("飞书 API 请求", {
    stage: options?.stage,
    endpoint,
    method,
    body: summarizeFeishuBody(options?.body),
    debug: options?.debug
  });

  const response = await fetch(`${config.baseUrl}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...(init.headers ?? {})
    },
    signal: AbortSignal.timeout(20000)
  });

  const data = (await response.json().catch(() => ({}))) as T & { code?: number; msg?: string; error?: string; error_description?: string };
  console.info("飞书 API 返回", {
    stage: options?.stage,
    path,
    status: response.status,
    data: redactSensitive(data)
  });
  if (!response.ok || (typeof data.code === "number" && data.code !== 0)) {
    const raw = feishuApiErrorMessage(data, response.statusText || String(response.status));
    const hint = /invalid param/i.test(raw) && /blocks/i.test(options?.stage || "")
      ? "。建议：检查 block 结构或内容是否为空、超长、格式不合法。"
      : "";
    throw new FeishuError(`${stageLabel(options?.stage)}（${options?.stage || "unknown"}）：${raw}${hint}`, { stage: options?.stage, raw: data });
  }

  return data;
}

export async function clearFeishuAuthorization(userId: string) {
  await prisma.$transaction([
    prisma.feishuCredential.deleteMany({ where: { userId } }),
    prisma.userSettings.upsert({
      where: { userId },
      update: { feishuAuthStatus: "not_connected" },
      create: { userId, feishuAuthStatus: "not_connected" }
    })
  ]);
}

export async function exchangeFeishuCode(userId: string, code: string) {
  const config = getFeishuConfig();
  if (!config) {
    throw new FeishuError("飞书真实授权未完成：缺少开放平台应用配置。");
  }

  const token = await requestUserAccessToken({
    grant_type: "authorization_code",
    code,
    client_id: config.appId,
    client_secret: config.appSecret,
    redirect_uri: config.redirectUri
  });

  console.info("飞书 token 字段读取路径", {
    accessTokenPath: token.accessTokenPath,
    refreshTokenPath: token.refreshToken ? "data.refresh_token 或 refresh_token" : "未返回 refresh_token"
  });

  const expiresAt = new Date(Date.now() + Math.max(token.expiresIn ?? 3600, 60) * 1000);
  await prisma.feishuCredential.upsert({
    where: { userId },
    update: {
      accessToken: token.accessToken,
      refreshToken: token.refreshToken,
      expiresAt,
      scope: token.scope,
      tokenType: token.tokenType,
      openId: token.openId,
      tenantKey: token.tenantKey
    },
    create: {
      userId,
      accessToken: token.accessToken,
      refreshToken: token.refreshToken,
      expiresAt,
      scope: token.scope,
      tokenType: token.tokenType,
      openId: token.openId,
      tenantKey: token.tenantKey
    }
  });

  await prisma.userSettings.upsert({
    where: { userId },
    update: { feishuAuthStatus: "connected" },
    create: { userId, feishuAuthStatus: "connected" }
  });
}

async function getUserAccessToken(userId: string) {
  const credential = await prisma.feishuCredential.findUnique({ where: { userId } });
  if (!credential) {
    throw new FeishuError("飞书授权失败：当前用户未授权飞书，请先在设置页连接飞书。", { stage: "token_validation" });
  }

  if (credential.expiresAt.getTime() > Date.now() + 60_000) {
    return credential.accessToken;
  }

  if (!credential.refreshToken) {
    await prisma.userSettings.upsert({
      where: { userId },
      update: { feishuAuthStatus: "expired" },
      create: { userId, feishuAuthStatus: "expired" }
    });
    throw new FeishuError("飞书 token 已失效：缺少 refresh_token，请重新授权飞书后再同步。", { stage: "token_validation" });
  }

  const config = getFeishuConfig();
  if (!config) throw new FeishuError("飞书 API 未配置。");

  let token: Awaited<ReturnType<typeof requestUserAccessToken>>;
  try {
    token = await requestUserAccessToken({
      grant_type: "refresh_token",
      refresh_token: credential.refreshToken,
      client_id: config.appId,
      client_secret: config.appSecret
    });
  } catch (error) {
    await prisma.userSettings.upsert({
      where: { userId },
      update: { feishuAuthStatus: "expired" },
      create: { userId, feishuAuthStatus: "expired" }
    });
    throw new FeishuError(
      error instanceof Error ? `飞书 token 已失效：刷新失败，请重新授权飞书后再同步。${error.message}` : "飞书 token 已失效：刷新失败，请重新授权飞书后再同步。",
      { stage: "token_validation", raw: error instanceof FeishuError ? error.raw : undefined }
    );
  }

  const updated = await prisma.feishuCredential.update({
    where: { userId },
    data: {
      accessToken: token.accessToken,
      refreshToken: token.refreshToken ?? credential.refreshToken,
      expiresAt: new Date(Date.now() + Math.max(token.expiresIn ?? 3600, 60) * 1000),
      scope: token.scope ?? credential.scope,
      tokenType: token.tokenType ?? credential.tokenType
    }
  });

  return updated.accessToken;
}

export async function getFeishuTokenDiagnostic(userId: string) {
  const credential = await prisma.feishuCredential.findUnique({ where: { userId } });
  if (!credential) {
    return { ok: false, status: "unauthorized", message: "未授权" };
  }
  if (credential.expiresAt.getTime() > Date.now() + 60_000) {
    return { ok: true, status: "api_ready", message: "已授权，可调用 API" };
  }
  try {
    await getUserAccessToken(userId);
    return { ok: true, status: "api_ready", message: "已授权，可调用 API" };
  } catch (error) {
    return {
      ok: false,
      status: "expired",
      message: error instanceof Error ? error.message : "已授权，但 token 可能失效"
    };
  }
}

type FeishuDocNote = {
  noteType?: string | null;
  highlight?: { highlightText: string } | null;
  userComment?: string | null;
};

type FeishuDocumentBuildInput = {
  articleTitle: string;
  sourceUrl?: string | null;
  sourcePlatform?: string | null;
  tags: string[];
  summary?: string | null;
  notes: FeishuDocNote[];
  methodologyAndInsights?: string | null;
  methodologySummary?: string | null;
  reusableInsights?: string | null;
  myOpinion?: string | null;
  syncedAt?: Date;
};

type MethodologySections = {
  problemChain: string;
  framework: string;
  methods: string;
  insights: string;
  followUp: string;
};

export type FeishuBlock = {
  block_type: number;
  [key: string]: unknown;
};

function normalizeContent(text?: string | null, fallback = "暂无内容") {
  const value = cleanMarkdownForFeishu(text ?? "");
  return value || fallback;
}

export function cleanMarkdownForFeishu(text: string) {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/```[\s\S]*?```/g, (match) => match.replace(/```[a-zA-Z]*\n?/g, "").replace(/```/g, ""))
    .replace(/^\s{0,3}#{1,6}\s*/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*{2,}/g, "")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^\s*[-*+]\s+/gm, "· ")
    .replace(/^\s*>\s?/gm, "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line, index, lines) => !(line === "" && lines[index - 1] === ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function getMethodologyText(input: FeishuDocumentBuildInput) {
  return (
    input.methodologyAndInsights ||
    [input.methodologySummary, input.reusableInsights].filter(Boolean).join("\n\n") ||
    ""
  );
}

function stripDuplicateMethodologyTitle(text: string) {
  return text
    .split("\n")
    .filter((line) => !/^(?:三、)?方法论和启示[:：]?$/.test(line.trim()))
    .join("\n")
    .trim();
}

export function parseMethodologyAndInsights(text?: string | null): MethodologySections {
  const cleaned = stripDuplicateMethodologyTitle(cleanMarkdownForFeishu(text ?? ""));
  const sections: MethodologySections = {
    problemChain: "",
    framework: "",
    methods: "",
    insights: "",
    followUp: ""
  };
  if (!cleaned) {
    return {
      problemChain: "暂无内容。",
      framework: "暂无内容。",
      methods: "暂无内容。",
      insights: "暂无内容。",
      followUp: "暂无内容。"
    };
  }

  const headingMap: Record<string, keyof MethodologySections> = {
    核心问题链条: "problemChain",
    可迁移的分析框架: "framework",
    可复用的方法: "methods",
    关键洞察: "insights",
    后续追踪方向: "followUp"
  };
  const headingPattern = /^(?:[一二三四五]、|[1-5][.、]\s*)?(核心问题链条|可迁移的分析框架|可复用的方法|关键洞察|后续追踪方向)\s*[:：]?$/;
  const headingWithContentPattern = /^(?:[一二三四五]、|[1-5][.、]\s*)?(核心问题链条|可迁移的分析框架|可复用的方法|关键洞察|后续追踪方向)\s*[:：]\s*(.+)$/;
  let current: keyof MethodologySections | null = null;
  const unmatched: string[] = [];

  for (const rawLine of cleaned.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    const headingWithContent = line.match(headingWithContentPattern);
    if (headingWithContent) {
      current = headingMap[headingWithContent[1]];
      sections[current] = [sections[current], headingWithContent[2].trim()].filter(Boolean).join("\n");
      continue;
    }
    const heading = line.match(headingPattern);
    if (heading) {
      current = headingMap[heading[1]];
      continue;
    }
    if (current) {
      sections[current] = [sections[current], line].filter(Boolean).join("\n");
    } else {
      unmatched.push(line);
    }
  }

  if (!Object.values(sections).some(Boolean)) {
    sections.problemChain = unmatched.join("\n");
  } else if (unmatched.length) {
    sections.problemChain = [unmatched.join("\n"), sections.problemChain].filter(Boolean).join("\n");
  }

  return {
    problemChain: sections.problemChain || "暂无内容。",
    framework: sections.framework || "暂无内容。",
    methods: sections.methods || "暂无内容。",
    insights: sections.insights || "暂无内容。",
    followUp: sections.followUp || "暂无内容。"
  };
}

function createTextElements(content: string) {
  return [
    {
      text_run: {
        content,
        text_element_style: {}
      }
    }
  ];
}

export function createParagraphBlock(text: string): FeishuBlock {
  return {
    block_type: 2,
    text: {
      elements: createTextElements(text),
      style: {}
    }
  };
}

function createHeadingBlock(level: 1 | 2 | 3, text: string): FeishuBlock {
  const blockType = level === 1 ? 3 : level === 2 ? 4 : 5;
  const key = `heading${level}`;
  return {
    block_type: blockType,
    [key]: {
      elements: createTextElements(text),
      style: {}
    }
  };
}

export function createHeading1Block(text: string) {
  return createHeadingBlock(1, text);
}

export function createHeading2Block(text: string) {
  return createHeadingBlock(2, text);
}

export function createHeading3Block(text: string) {
  return createHeadingBlock(3, text);
}

export function createOrderedListBlock(text: string): FeishuBlock {
  return {
    block_type: 13,
    ordered: {
      elements: createTextElements(text),
      style: {}
    }
  };
}

export function createDividerBlock(): FeishuBlock {
  return {
    block_type: 22,
    divider: {}
  };
}

function toTextBlock(content: string) {
  return createParagraphBlock(content);
}

function splitLongLine(line: string, size = 1200) {
  if (line.length <= size) return [line];
  const chunks: string[] = [];
  for (let index = 0; index < line.length; index += size) {
    chunks.push(line.slice(index, index + size));
  }
  return chunks;
}

function contentToBlocks(content: string) {
  return content
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => splitLongLine(line))
    .map(toTextBlock);
}

function pushTextBlocks(blocks: FeishuBlock[], content?: string | null, createBlock: (text: string) => FeishuBlock = createParagraphBlock) {
  const cleaned = cleanMarkdownForFeishu(content ?? "");
  if (!cleaned) return;
  for (const line of cleaned.split("\n").map((item) => item.trim()).filter(Boolean)) {
    for (const chunk of splitLongLine(line)) {
      blocks.push(createBlock(chunk));
    }
  }
}

function formatSyncedAt(date: Date) {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).format(date);
}

function buildNoteLines(notes: FeishuDocNote[]) {
  const visibleNotes = notes.filter((note) => note.highlight?.highlightText?.trim());
  if (!visibleNotes.length) return ["暂无画线笔记"];
  return visibleNotes.map((note, index) => {
    const noteType = note.noteType && note.noteType in NOTE_TYPE_LABELS
      ? NOTE_TYPE_LABELS[note.noteType as keyof typeof NOTE_TYPE_LABELS]
      : "未分类";
    const highlightText = normalizeContent(note.highlight?.highlightText, "");
    const comment = normalizeContent(note.userComment, "");
    return `【${noteType}】${highlightText}${comment ? `｜补充：${comment}` : ""}`;
  });
}

function pushParagraphs(blocks: FeishuBlock[], text?: string | null) {
  pushTextBlocks(blocks, text, createParagraphBlock);
}

function pushHeading1(blocks: FeishuBlock[], text: string) {
  pushTextBlocks(blocks, text, createHeading1Block);
}

function pushHeading2(blocks: FeishuBlock[], text: string) {
  pushTextBlocks(blocks, text, createHeading2Block);
}

function pushHeading3(blocks: FeishuBlock[], text: string) {
  pushTextBlocks(blocks, text, createHeading3Block);
}

function pushOrderedList(blocks: FeishuBlock[], items: string[]) {
  items.forEach((item) => {
    pushTextBlocks(blocks, item, createOrderedListBlock);
  });
}

function extractNumberedItems(text: string) {
  const cleaned = cleanMarkdownForFeishu(text);
  const lines = cleaned.split("\n").map((line) => line.trim()).filter(Boolean);
  const items: string[] = [];
  let current = "";
  for (const line of lines) {
    const match = line.match(/^(?:\d+[.、）)]|[（(]?\d+[）)])\s*(.+)$/);
    if (match) {
      if (current) items.push(current);
      current = match[1].trim();
    } else if (current) {
      current = `${current}\n${line}`;
    } else {
      current = line;
    }
  }
  if (current) items.push(current);
  return items.length ? items : [cleaned || "暂无内容。"];
}

function parseLabeledSubsections(text: string, labels: string[]) {
  const cleaned = cleanMarkdownForFeishu(text);
  const sections: Array<{ title: string; content: string }> = [];
  let currentTitle = "";
  let currentContent: string[] = [];
  const labelPattern = new RegExp(`^(${labels.map((label) => label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\s*[:：]?\\s*(.*)$`);

  for (const rawLine of cleaned.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    const match = line.match(labelPattern);
    if (match) {
      if (currentTitle) sections.push({ title: currentTitle, content: currentContent.join("\n").trim() || "暂无内容。" });
      currentTitle = match[1];
      currentContent = match[2] ? [match[2]] : [];
    } else if (currentTitle) {
      currentContent.push(line);
    }
  }
  if (currentTitle) sections.push({ title: currentTitle, content: currentContent.join("\n").trim() || "暂无内容。" });
  return sections;
}

function addMethodologySection(input: {
  blocks: FeishuBlock[];
  title: string;
  content: string;
  subLabels?: string[];
  useAdvancedBlocks: boolean;
  listContent?: boolean;
}) {
  if (input.useAdvancedBlocks) {
    pushHeading2(input.blocks, input.title);
  } else {
    pushHeading2(input.blocks, input.title);
  }

  if (input.listContent) {
    const items = extractNumberedItems(input.content);
    if (input.useAdvancedBlocks) {
      pushOrderedList(input.blocks, items);
    } else {
      items.forEach((item, index) => pushParagraphs(input.blocks, `${index + 1}. ${item}`));
    }
    return;
  }

  const subsections = input.subLabels?.length ? parseLabeledSubsections(input.content, input.subLabels) : [];
  if (subsections.length) {
    for (const subsection of subsections) {
      if (input.useAdvancedBlocks) {
        pushHeading3(input.blocks, subsection.title);
      } else {
        pushParagraphs(input.blocks, subsection.title);
      }
      pushParagraphs(input.blocks, subsection.content);
    }
    return;
  }

  pushParagraphs(input.blocks, input.content || "暂无内容。");
}

function createMetaInfoBlocks(input: FeishuDocumentBuildInput, useAdvancedBlocks: boolean) {
  const blocks: FeishuBlock[] = [];
  const syncedAt = input.syncedAt ?? new Date();
  const tags = input.tags.length ? input.tags.join(" / ") : "未设置";
  pushParagraphs(blocks, `🔗 原文链接：${input.sourceUrl || "无"}`);
  pushParagraphs(blocks, `📍 来源平台：${input.sourcePlatform || "未知来源"}`);
  pushParagraphs(blocks, `🏷 标签：${tags}`);
  pushParagraphs(blocks, `🕒 同步时间：${formatSyncedAt(syncedAt)}`);
  blocks.push(useAdvancedBlocks ? createDividerBlock() : createParagraphBlock("────────────"));
  return blocks;
}

export function buildFeishuDocBlocksV2(input: FeishuDocumentBuildInput, options: { useAdvancedBlocks?: boolean } = {}) {
  const useAdvancedBlocks = options.useAdvancedBlocks ?? true;
  const blocks: FeishuBlock[] = [];
  const methodology = parseMethodologyAndInsights(getMethodologyText(input));
  const noteLines = buildNoteLines(input.notes);

  blocks.push(...createMetaInfoBlocks(input, useAdvancedBlocks));

  pushHeading1(blocks, "一、文章摘要");
  pushParagraphs(blocks, normalizeContent(input.summary, "暂无摘要"));

  pushHeading1(blocks, "二、我的画线笔记");
  if (noteLines.length === 1 && noteLines[0] === "暂无画线笔记") {
    pushParagraphs(blocks, "暂无画线笔记。");
  } else if (useAdvancedBlocks) {
    pushOrderedList(blocks, noteLines);
  } else {
    noteLines.forEach((line, index) => pushParagraphs(blocks, `${index + 1}. ${line}`));
  }

  pushHeading1(blocks, "三、方法论和启示");
  addMethodologySection({
    blocks,
    title: "1. 核心问题链条",
    content: methodology.problemChain,
    subLabels: ["现象", "原因", "影响", "可继续追踪问题", "后续问题"],
    useAdvancedBlocks
  });
  addMethodologySection({
    blocks,
    title: "2. 可迁移的分析框架",
    content: methodology.framework,
    subLabels: ["用户画像-内容匹配度分析", "营销目标-玩法匹配矩阵", "生态联动链路拆解"],
    useAdvancedBlocks
  });
  addMethodologySection({
    blocks,
    title: "3. 可复用的方法",
    content: methodology.methods,
    subLabels: ["产品分析场景", "品牌运营策略场景", "行业观察场景", "内容选题场景", "研究设计场景"],
    useAdvancedBlocks
  });
  addMethodologySection({
    blocks,
    title: "4. 关键洞察",
    content: methodology.insights,
    useAdvancedBlocks,
    listContent: true
  });
  addMethodologySection({
    blocks,
    title: "5. 后续追踪方向",
    content: methodology.followUp,
    useAdvancedBlocks,
    listContent: true
  });

  pushHeading1(blocks, "四、我的观点");
  pushParagraphs(blocks, normalizeContent(input.myOpinion, "暂无我的观点记录。"));

  return blocks.slice(0, 200);
}

export function buildFallbackParagraphBlocks(input: FeishuDocumentBuildInput) {
  return buildFeishuDocBlocksV2(input, { useAdvancedBlocks: false });
}

export function buildStructuredFeishuBlocks(input: FeishuDocumentBuildInput) {
  return buildFeishuDocBlocksV2(input, { useAdvancedBlocks: true });
}

export function buildFeishuDocumentContent(input: FeishuDocumentBuildInput) {
  return buildFallbackParagraphBlocks(input)
    .map(getBlockPlainText)
    .filter(Boolean)
    .join("\n");
}

function getBlockPlainText(block: FeishuBlock) {
  const field = ["text", "heading1", "heading2", "heading3", "ordered"].find((key) => key in block);
  if (!field) return "";
  const payload = block[field] as { elements?: Array<{ text_run?: { content?: string } }> };
  return payload.elements?.[0]?.text_run?.content ?? "";
}

function getBlockTextLength(block: FeishuBlock) {
  return getBlockPlainText(block).length;
}

async function appendBlocks(input: {
  accessToken: string;
  documentId: string;
  blocks: FeishuBlock[];
  stage: string;
}) {
  const blockBody = { children: input.blocks };
  return feishuFetch(`/open-apis/docx/v1/documents/${input.documentId}/blocks/${input.documentId}/children`, {
    method: "POST",
    headers: { authorization: `Bearer ${input.accessToken}` },
    body: JSON.stringify(blockBody)
  }, {
    stage: input.stage,
    body: blockBody,
    debug: {
      documentId: input.documentId,
      parentBlockId: input.documentId,
      childrenCount: input.blocks.length,
      firstChildBlockType: input.blocks[0]?.block_type,
      firstTextLength: input.blocks[0] ? getBlockTextLength(input.blocks[0]) : 0
    }
  });
}

export async function createFeishuDocument(input: {
  userId: string;
  articleId: string;
  title: string;
  folderToken: string;
  content?: string;
  blocks?: FeishuBlock[];
  outlineFallbackBlocks?: FeishuBlock[];
  fallbackContent?: string;
}) {
  const accessToken = await getUserAccessToken(input.userId);
  const folderToken = parseFeishuFolderToken(input.folderToken);
  if (!folderToken || !isLikelyFeishuFolderToken(folderToken)) {
    throw new FeishuError("当前标签的飞书文件夹位置不是有效 folder_token，请重新填写飞书文件夹链接或 folder_token。", {
      stage: "folder_token_validation"
    });
  }

  const now = new Date();
  await prisma.feishuDoc.upsert({
    where: { articleId: input.articleId },
    update: { syncStatus: "creating" },
    create: {
      userId: input.userId,
      articleId: input.articleId,
      syncStatus: "creating"
    }
  });

  const createBody = {
    title: input.title,
    folder_token: folderToken
  };
  const created = await feishuFetch<FeishuDocumentResponse>("/open-apis/docx/v1/documents", {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(createBody)
  }, {
    stage: "create_document",
    body: createBody,
    debug: {
      titleEmpty: !input.title.trim(),
      folderTokenEmpty: !folderToken,
      folderTokenLength: folderToken.length
    }
  });

  const documentId = created.data?.document?.document_id ?? created.data?.document_id;
  if (!documentId) {
    throw new FeishuError("飞书同步失败：文档创建成功但未返回 document_id。");
  }

  const url = created.data?.document?.url ?? created.data?.url ?? `https://feishu.cn/docx/${documentId}`;

  await prisma.feishuDoc.upsert({
    where: { articleId: input.articleId },
    update: {
      feishuDocToken: documentId,
      feishuDocUrl: url,
      syncStatus: "document_created",
      lastSyncedAt: now
    },
    create: {
      userId: input.userId,
      articleId: input.articleId,
      feishuDocToken: documentId,
      feishuDocUrl: url,
      syncStatus: "document_created",
      lastSyncedAt: now
    }
  });

  const fallbackContent = (input.fallbackContent || input.content || "").trim();
  const blocks = (input.blocks?.length ? input.blocks : contentToBlocks(fallbackContent)).slice(0, 200);
  const outlineFallbackBlocks = (input.outlineFallbackBlocks ?? []).slice(0, 200);
  let contentSynced = true;
  let warning: string | undefined;

  await prisma.feishuDoc.update({
    where: { articleId: input.articleId },
    data: { syncStatus: "writing" }
  });

  if (blocks.length) {
    try {
      await appendBlocks({
        accessToken,
        documentId,
        blocks,
        stage: input.blocks?.length ? "create_blocks_structured" : "create_blocks_full"
      });
    } catch (error) {
      console.warn("飞书结构化内容写入失败，尝试大纲降级写入", {
        documentId,
        parentBlockId: documentId,
        url,
        error
      });

      try {
        if (!outlineFallbackBlocks.length) {
          throw new FeishuError("飞书大纲降级写入失败：没有可写入的大纲降级内容。", { stage: "create_blocks_outline_fallback" });
        }
        await appendBlocks({
          accessToken,
          documentId,
          blocks: outlineFallbackBlocks,
          stage: "create_blocks_outline_fallback"
        });
        warning = "高级排版写入失败，已保留一级/二级标题并降级列表、分隔线和三级标题。";
      } catch (outlineError) {
        console.warn("飞书大纲降级写入失败，尝试普通分段文本降级写入", {
          documentId,
          parentBlockId: documentId,
          url,
          error: outlineError
        });

        try {
          const fallbackBlocks = contentToBlocks(fallbackContent).slice(0, 80);
        if (!fallbackBlocks.length) {
          throw new FeishuError("飞书内容降级写入失败：没有可写入的文本内容。", { stage: "create_blocks_plain_fallback" });
        }
          await appendBlocks({
            accessToken,
            documentId,
            blocks: fallbackBlocks,
            stage: "create_blocks_plain_fallback"
          });
          warning = "结构化排版写入失败，已使用普通分段文本降级写入。";
        } catch (fallbackError) {
          contentSynced = false;
          warning = fallbackError instanceof Error
            ? `飞书文档已创建，但内容写入失败。请查看控制台中的 create_blocks 参数错误：${fallbackError.message}`
            : "飞书文档已创建，但内容写入失败。请查看控制台中的 create_blocks 参数错误。";
          console.warn("飞书纯文本降级写入失败", {
            documentId,
            parentBlockId: documentId,
            url,
            error: fallbackError
          });
        }
      }
    }
  }

  await prisma.feishuDoc.update({
    where: { articleId: input.articleId },
    data: {
      syncStatus: contentSynced ? "synced" : "content_failed",
      lastSyncedAt: new Date()
    }
  });

  return { token: documentId, url, contentSynced, warning };
}

export async function createStandaloneFeishuDocument(input: {
  userId: string;
  title: string;
  folderToken: string;
  blocks?: FeishuBlock[];
  outlineFallbackBlocks?: FeishuBlock[];
  fallbackContent?: string;
}) {
  const accessToken = await getUserAccessToken(input.userId);
  const folderToken = parseFeishuFolderToken(input.folderToken);
  if (!folderToken || !isLikelyFeishuFolderToken(folderToken)) {
    throw new FeishuError("飞书文件夹位置不是有效 folder_token，请重新填写飞书文件夹链接或 folder_token。", {
      stage: "folder_token_validation"
    });
  }

  const createBody = {
    title: input.title,
    folder_token: folderToken
  };
  const created = await feishuFetch<FeishuDocumentResponse>("/open-apis/docx/v1/documents", {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(createBody)
  }, {
    stage: "create_document",
    body: createBody,
    debug: {
      titleEmpty: !input.title.trim(),
      folderTokenEmpty: !folderToken,
      folderTokenLength: folderToken.length
    }
  });

  const documentId = created.data?.document?.document_id ?? created.data?.document_id;
  if (!documentId) {
    throw new FeishuError("飞书同步失败：文档创建成功但未返回 document_id。", { stage: "create_document" });
  }

  const url = created.data?.document?.url ?? created.data?.url ?? `https://feishu.cn/docx/${documentId}`;
  const fallbackContent = (input.fallbackContent || "").trim();
  const blocks = (input.blocks?.length ? input.blocks : contentToBlocks(fallbackContent)).slice(0, 200);
  const outlineFallbackBlocks = (input.outlineFallbackBlocks ?? []).slice(0, 200);
  let contentSynced = true;
  let warning: string | undefined;

  if (blocks.length) {
    try {
      await appendBlocks({
        accessToken,
        documentId,
        blocks,
        stage: input.blocks?.length ? "create_blocks_structured" : "create_blocks_full"
      });
    } catch (error) {
      console.warn("飞书报告结构化内容写入失败，尝试大纲降级写入", {
        documentId,
        parentBlockId: documentId,
        url,
        error
      });

      try {
        if (!outlineFallbackBlocks.length) {
          throw new FeishuError("飞书报告大纲降级写入失败：没有可写入的大纲降级内容。", { stage: "create_blocks_outline_fallback" });
        }
        await appendBlocks({
          accessToken,
          documentId,
          blocks: outlineFallbackBlocks,
          stage: "create_blocks_outline_fallback"
        });
        warning = "报告高级排版写入失败，已降级为大纲分段写入。";
      } catch (outlineError) {
        console.warn("飞书报告大纲降级写入失败，尝试普通分段文本写入", {
          documentId,
          parentBlockId: documentId,
          url,
          error: outlineError
        });

        try {
          const fallbackBlocks = contentToBlocks(fallbackContent).slice(0, 120);
          if (!fallbackBlocks.length) {
            throw new FeishuError("飞书报告内容降级写入失败：没有可写入的文本内容。", { stage: "create_blocks_plain_fallback" });
          }
          await appendBlocks({
            accessToken,
            documentId,
            blocks: fallbackBlocks,
            stage: "create_blocks_plain_fallback"
          });
          warning = "报告结构化排版写入失败，已使用普通分段文本降级写入。";
        } catch (fallbackError) {
          contentSynced = false;
          warning = fallbackError instanceof Error
            ? `飞书文档已创建，但报告内容写入失败：${fallbackError.message}`
            : "飞书文档已创建，但报告内容写入失败。";
          console.warn("飞书报告纯文本降级写入失败", {
            documentId,
            parentBlockId: documentId,
            url,
            error: fallbackError
          });
        }
      }
    }
  }

  return { token: documentId, url, contentSynced, warning };
}

export async function markFeishuSyncFailed(userId: string, articleId: string) {
  await prisma.feishuDoc.upsert({
    where: { articleId },
    update: { syncStatus: "failed" },
    create: { userId, articleId, syncStatus: "failed" }
  });
}
