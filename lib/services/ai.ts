import { NOTE_TYPE_LABELS, REPORT_SECTIONS } from "@/lib/constants";
import { prisma } from "@/lib/prisma";
import { decryptSecret } from "@/lib/server-crypto";
import { excerpt, parseCsvLike } from "@/lib/text";

type ArticleLike = {
  id?: string;
  title: string;
  content: string;
  myOpinion?: string | null;
};

type HighlightLike = {
  highlightText: string;
};

type AiMessage = {
  role: "system" | "user";
  content: string;
};

export type AiSource = "real" | "mock";

export type AiTextResult = {
  text: string;
  source: AiSource;
  warning?: string;
};

type UserAiConfig = {
  apiKey: string;
  provider: string;
  model: string;
  baseUrl: string;
};

type AiUsage = {
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  usageAvailable: boolean;
};

type AiCallOptions = {
  temperature?: number;
  maxTokens?: number;
  actionType?: "article_summary" | "methodology_and_insights" | "tag_report" | "tag_recommendation" | "connection_test" | "other";
  articleId?: string | null;
  reportId?: string | null;
};

const tagRules: Array<[string, string[]]> = [
  ["AI", ["ai", "人工智能", "模型", "智能体", "openai", "agent", "llm", "npc"]],
  ["营销", ["营销", "增长", "转化", "投放", "渠道", "用户运营"]],
  ["产品", ["产品", "用户", "体验", "需求", "迭代", "功能", "设计", "interface", "usability", "interaction", "design"]],
  ["品牌", ["品牌", "定位", "叙事", "心智", "传播"]],
  ["人文", ["社会", "文化", "历史", "哲学", "人文", "伦理", "world", "society", "culture", "human"]],
  ["影视", ["电影", "影视", "剧集", "导演", "影像", "票房"]],
  ["女性主义", ["女性", "性别", "女性主义", "平权", "父权"]],
  ["热点新闻", ["新闻", "热点", "事件", "舆论", "政策", "突发"]],
  ["新传", ["传播", "媒体", "新闻学", "新传", "媒介"]]
];

const SYSTEM_PROMPT =
  "你是一个严谨的中文深度阅读助手。你必须基于文章中的具体事实、案例、论点和语境作答；不得机械复述原文，不得用空泛套话冒充分析。";

const EMPTY_PHRASES =
  "禁止使用空泛表达，例如：值得关注变化、提升认知、形成方法论、赋能、抓手、闭环、底层逻辑、长期主义、要关注行业变化、可以用于未来研究。";

function splitSentences(text: string) {
  return text
    .replace(/\s+/g, " ")
    .split(/[。！？.!?]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function trimForPrompt(text: string, max = 9000) {
  const normalized = text.replace(/\s{3,}/g, "\n\n").trim();
  return normalized.length > max ? `${normalized.slice(0, max)}\n\n[正文已截断]` : normalized;
}

function inferTopic(title: string, content: string, existingTags?: string[]) {
  const text = `${title}\n${content}`.toLowerCase();
  const matched = tagRules.find(([tag, keywords]) => {
    if (existingTags && !existingTags.includes(tag)) return false;
    return keywords.some((keyword) => keywordMatches(text, keyword));
  });
  return matched?.[0] ?? existingTags?.[0] ?? "个人知识资产";
}

function keywordMatches(text: string, keyword: string) {
  const normalizedKeyword = keyword.toLowerCase();
  if (/^[a-z0-9-]+$/i.test(normalizedKeyword)) {
    return new RegExp(`(^|[^a-z0-9])${normalizedKeyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`, "i").test(text);
  }
  return text.includes(normalizedKeyword);
}

function inferCoreIssue(article: ArticleLike) {
  const sentences = splitSentences(article.content);
  const firstUseful = sentences.find((sentence) => sentence.length >= 18 && !/菜单|登录|版权所有|ICP备|隐私|广告/.test(sentence)) || excerpt(article.content, 80);
  return firstUseful.replace(/[“”"']/g, "").slice(0, 70);
}

function inferJudgement(article: ArticleLike) {
  const sentences = splitSentences(article.content);
  const judgement = sentences.find((sentence) => /认为|指出|意味着|关键|核心|趋势|问题|变化|机会|挑战|风险|影响/.test(sentence));
  if (judgement) return judgement.slice(0, 90);
  return "真正值得关注的不是单个事实本身，而是它背后正在变化的需求、关系和决策逻辑";
}

async function getUserAiConfig(userId?: string): Promise<UserAiConfig | null> {
  if (!userId) return null;

  const settings = await prisma.userSettings.findUnique({ where: { userId } });
  if (!settings?.aiEnabled || !settings.aiApiKeyEncrypted || !settings.aiBaseUrl || !settings.aiModel) return null;

  try {
    return {
      apiKey: decryptSecret(settings.aiApiKeyEncrypted),
      provider: settings.aiProvider || "openai_compatible",
      model: settings.aiModel,
      baseUrl: settings.aiBaseUrl.replace(/\/$/, "")
    };
  } catch (error) {
    console.warn("AI API Key 解密失败，使用 mock fallback", error instanceof Error ? error.message : "unknown");
    return null;
  }
}

function toTokenValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : null;
}

function normalizeUsage(usage: unknown): AiUsage {
  const record = usage && typeof usage === "object" ? usage as Record<string, unknown> : {};
  const promptTokens = toTokenValue(record.prompt_tokens);
  const completionTokens = toTokenValue(record.completion_tokens);
  const totalTokens = toTokenValue(record.total_tokens);

  return {
    promptTokens,
    completionTokens,
    totalTokens,
    usageAvailable: promptTokens !== null || completionTokens !== null || totalTokens !== null
  };
}

async function recordAiUsage(userId: string | undefined, config: UserAiConfig, usage: AiUsage, options?: AiCallOptions) {
  if (!userId) return;

  try {
    await prisma.aiUsageLog.create({
      data: {
        userId,
        articleId: options?.articleId || null,
        reportId: options?.reportId || null,
        actionType: options?.actionType || "other",
        provider: config.provider,
        model: config.model,
        promptTokens: usage.promptTokens,
        completionTokens: usage.completionTokens,
        totalTokens: usage.totalTokens,
        usageAvailable: usage.usageAvailable
      }
    });
  } catch (error) {
    console.warn("AI Token 用量记录失败，但不会影响本次生成", error instanceof Error ? error.message : "unknown");
  }
}

async function callOpenAICompatible(config: UserAiConfig, messages: AiMessage[], options?: AiCallOptions) {
  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${config.apiKey}`
    },
    body: JSON.stringify({
      model: config.model,
      messages,
      temperature: options?.temperature ?? 0.4,
      max_tokens: options?.maxTokens ?? 1200
    }),
    signal: AbortSignal.timeout(30000)
  });

  const data = await response.json().catch(() => ({})) as {
    error?: { message?: string };
    choices?: Array<{ message?: { content?: string } }>;
    usage?: unknown;
  };

  if (!response.ok) {
    throw new Error(data.error?.message || `HTTP ${response.status}`);
  }

  const content = data.choices?.[0]?.message?.content?.trim();
  if (!content) throw new Error("模型未返回有效内容");
  return {
    content,
    usage: normalizeUsage(data.usage)
  };
}

async function callAi(userId: string | undefined, messages: AiMessage[], options?: AiCallOptions): Promise<AiTextResult | null> {
  const config = await getUserAiConfig(userId);
  if (!config) return null;

  try {
    const result = await callOpenAICompatible(config, messages, options);
    await recordAiUsage(userId, config, result.usage, options);
    return { text: result.content, source: "real" };
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知错误";
    console.warn("真实 AI 调用失败，使用 mock fallback", message);
    return { text: "", source: "mock", warning: `真实 AI 调用失败，已使用 fallback 结果。请检查设置页中的 API Key、Base URL 和模型名称。错误：${message}` };
  }
}

export async function testAIConnection(userId: string) {
  const config = await getUserAiConfig(userId);
  if (!config) {
    return { ok: false, message: "连接失败：请先启用真实 AI，并填写 API Key / Base URL / 模型名称。" };
  }

  try {
    const result = await callOpenAICompatible(config, [
      { role: "system", content: "你是连接测试助手，只输出一句中文。" },
      { role: "user", content: "请回复：连接成功" }
    ], { temperature: 0, maxTokens: 20, actionType: "connection_test" });
    await recordAiUsage(userId, config, result.usage, { actionType: "connection_test" });
    await prisma.userSettings.update({
      where: { userId },
      data: { aiConnectionStatus: "success", aiLastTestedAt: new Date() }
    });
    return { ok: true, message: "连接成功" };
  } catch (error) {
    await prisma.userSettings.update({
      where: { userId },
      data: { aiConnectionStatus: "failed", aiLastTestedAt: new Date() }
    });
    const message = error instanceof Error ? error.message : "未知错误";
    return { ok: false, message: `连接失败：请检查 API Key / Base URL / 模型名称。${message}` };
  }
}

function articlePrompt(article: ArticleLike, extra = "") {
  return [
    `标题：${article.title}`,
    article.myOpinion ? `我的观点：${article.myOpinion}` : "",
    extra,
    "正文：",
    trimForPrompt(article.content)
  ].filter(Boolean).join("\n\n");
}

function mockArticleSummary(article: ArticleLike) {
  const topic = inferTopic(article.title, article.content);
  const issue = inferCoreIssue(article);
  const judgement = inferJudgement(article);

  return `这篇文章主要围绕【${topic}】展开，讨论的核心议题是【${issue}】。文章试图说明的主要观点是：${judgement}。从内容看，它的价值在于把一个具体事件、案例或观点放入较清楚的背景中，帮助读者理解相关对象发生了什么、为什么被讨论，以及作者如何看待这一变化。`;
}

export async function generateArticleSummary(article: ArticleLike, options?: { userId?: string; tags?: string[] }): Promise<AiTextResult> {
  const real = await callAi(options?.userId, [
    {
      role: "system",
      content: [
        "你只负责生成文章摘要，不负责方法论、启示、行动建议或后续追踪。",
        "摘要必须克制、准确、基于正文，不得扩写成评论。"
      ].join("\n")
    },
    {
      role: "user",
      content: [
        "请阅读以下文章，生成“文章摘要”。",
        "",
        "硬性要求：",
        "1. 只输出一段中文正文，不要标题、项目符号或分区；",
        "2. 字数控制在 150—250 字；",
        "3. 只总结文章大意：文章主要讲了什么、核心议题是什么、作者或文章的主要观点是什么；",
        "4. 不得输出方法论、启示、行动建议、后续建议、后续追踪方向；",
        "5. 不得大段摘抄原文，不得编造正文没有的信息；",
        `6. ${EMPTY_PHRASES}`,
        "7. 如果正文信息不足，只说明可确认的主要信息，不要硬凑深度。",
        "",
        `文章标题：\n${article.title}`,
        "",
        `文章标签：\n${options?.tags?.join("、") || "暂无标签"}`,
        "",
        `文章正文：\n<<<ARTICLE_START\n${trimForPrompt(article.content)}\nARTICLE_END>>>`
      ].join("\n")
    }
  ], { temperature: 0.2, maxTokens: 500, actionType: "article_summary", articleId: article.id });

  if (real?.source === "real" && real.text) return real;

  return {
    text: mockArticleSummary(article),
    source: "mock",
    warning: real?.warning || "当前未配置真实大模型 API，系统已使用 mock fallback。你可以在设置页配置 API 后重新生成。"
  };
}

function mockMethodologyAndInsights(article: ArticleLike, highlights: HighlightLike[] = []) {
  const topic = inferTopic(article.title, article.content);
  const issue = inferCoreIssue(article);
  const judgement = inferJudgement(article);
  const highlight = highlights[0]?.highlightText || issue;
  const opinion = article.myOpinion ? `你的观点「${article.myOpinion}」可以作为后续验证这个判断的个人参照。` : "你还没有填写个人观点，后续可以补充赞同、反对或可迁移场景。";

  return [
    `一、核心问题链条\n这篇文章围绕【${issue}】展开，能够形成的最小问题链条是：具体材料出现 -> 作者给出判断 -> 该判断影响读者对【${topic}】的理解。由于当前 fallback 只能基于局部文本推断，如果原文缺少案例、数据或清晰论证，本文方法论价值较弱。`,
    "",
    `二、可迁移的分析框架\n可保守抽象为三个维度：第一，文章明确描述了什么事实；第二，作者如何解释事实的原因；第三，这个解释会改变谁的判断。使用时要逐项回到原文证据，避免把作者观点直接当结论。`,
    "",
    `三、可复用的方法\n可以把文中的关键线索“${highlight}”改写成一个可验证问题：如果这个判断成立，它会改变哪些用户行为、内容表达或业务决策；如果不成立，原文还缺少哪些证据。`,
    "",
    `四、关键洞察\n${judgement}。这条洞察只有在能被原文案例、数据或更多同类材料支持时，才适合沉淀为长期判断。`,
    "",
    `五、后续追踪方向\n可以继续追踪：原文判断是否有反例；类似案例是否重复出现；它是否能解释你后续读到的同类文章。${opinion}`
  ].join("\n");
}

export async function generateMethodologyAndInsights(
  article: ArticleLike,
  highlights: HighlightLike[] = [],
  options?: { userId?: string; tags?: string[] }
): Promise<AiTextResult> {
  const highlightText = highlights.map((item) => `- ${item.highlightText}`).join("\n") || "暂无高亮";
  const real = await callAi(options?.userId, [
    {
      role: "system",
      content: [
        SYSTEM_PROMPT,
        "你现在只生成“方法论和启示”，不能写文章摘要。必须从正文的具体事实、案例、数据、人物、产品、平台、行业或社会语境中抽象，不允许离开文章内容泛泛发挥。",
        EMPTY_PHRASES
      ].join("\n")
    },
    {
      role: "user",
      content: [
        "请阅读以下文章，为用户提炼“方法论和启示”。",
        "",
        "先做一个内部判断：这篇文章是否包含足够的案例、论证、数据、机制解释或可迁移场景。",
        "如果不足，请在第一部分明确写出“本文方法论价值较弱”，并说明弱在哪里；后续部分只能给出保守、有限的提炼，不要硬编。",
        "",
        "必须严格按照以下五个标题输出，不得增加第六部分，不得改标题：",
        "一、核心问题链条",
        "用“现象 → 原因 → 影响 → 可继续追踪问题”的链条说明。每个环节都要对应文章里的具体对象或事件，不要写成通用模板。",
        "",
        "二、可迁移的分析框架",
        "从文章中抽象出 2—4 个分析维度。每个维度都要说明：它来自文章哪类具体内容，以及未来分析类似材料时怎么用。",
        "",
        "三、可复用的方法",
        "说明可迁移到哪些具体场景，例如产品分析、内容选题、品牌判断、运营策略、研究设计或行业观察。每个场景必须给出具体操作，不要只列场景名。",
        "",
        "四、关键洞察",
        "提炼 2—4 条洞察。每条洞察必须是从文章具体内容推出来的判断，不能是常识，不能重复摘要，不能摘抄原句。",
        "",
        "五、后续追踪方向",
        "提出 2—3 个具体问题。问题必须能被后续文章、案例、数据或用户观察验证。",
        "",
        "硬性禁止：",
        "- 不要复述文章大意；",
        "- 不要重复文章摘要；",
        "- 不要大段摘抄原文；",
        "- 不要输出“值得关注变化”“提升认知”“形成方法论”等空泛表达；",
        "- 如果某部分无法从正文推出，必须写明依据不足，不要编造。",
        "",
        `文章标题：\n${article.title}`,
        "",
        `文章标签：\n${options?.tags?.join("、") || "暂无标签"}`,
        "",
        `用户高亮笔记：\n${highlightText}`,
        "",
        `我的观点：\n${article.myOpinion || "暂无"}`,
        "",
        `文章正文：\n<<<ARTICLE_START\n${trimForPrompt(article.content)}\nARTICLE_END>>>`
      ].join("\n\n")
    }
  ], { temperature: 0.25, maxTokens: 1800, actionType: "methodology_and_insights", articleId: article.id });

  if (real?.source === "real" && real.text) return real;

  return {
    text: mockMethodologyAndInsights(article, highlights),
    source: "mock",
    warning: real?.warning || "当前未配置真实大模型 API，系统已使用 mock fallback。你可以在设置页配置 API 后重新生成。"
  };
}

function mockMethodologySummary(article: ArticleLike, highlights: HighlightLike[] = []) {
  const topic = inferTopic(article.title, article.content);
  const evidence = highlights.map((item) => item.highlightText).slice(0, 3);
  const anchor = evidence.length ? evidence.join("；") : inferCoreIssue(article);

  return [
    "- 可复用方法：把文章中的事实、观点和案例拆成「现象 -> 成因 -> 可行动变量」三层，再提炼为可复用判断框架。",
    `- 适用场景：适合用于${topic}相关的文章复盘、选题判断、产品策略讨论、运营动作拆解或研究问题生成。`,
    "- 操作步骤：先确认文章真正回答的问题；再识别作者依赖的证据和隐含假设；最后把结论改写成检查清单、判断标准或可迁移表达模板。",
    `- 使用限制：这套方法依赖原文证据质量。当前可依据的关键线索是：${anchor}。如果原文偏观点化，需要补充反例或数据验证。`,
    "- 可迁移方式：下次遇到相似议题时，不直接复用原文结论，而是复用它的问题拆解方式、证据选择方式和判断路径。"
  ].join("\n");
}

export async function generateMethodologySummary(
  article: ArticleLike,
  highlights: HighlightLike[] = []
) {
  const highlightText = highlights.map((item) => `- ${item.highlightText}`).join("\n") || "暂无高亮";
  const real = await callAi(undefined, [
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "user",
      content: [
        "请基于文章全文和用户高亮，提炼可迁移的方法论。",
        "输出结构必须固定为：",
        "- 可复用方法：",
        "- 适用场景：",
        "- 操作步骤：",
        "- 使用限制：",
        "- 可迁移方式：",
        "要求：不要只总结原文提到的方法，要提炼用户未来可复用的分析框架、判断路径、运营方法、产品思路或研究角度。",
        `用户高亮：\n${highlightText}`,
        articlePrompt(article)
      ].join("\n\n")
    }
  ]);

  return real?.source === "real" && real.text ? real.text : mockMethodologySummary(article, highlights);
}

function mockReusableInsights(article: ArticleLike, highlights: HighlightLike[] = []) {
  const topic = inferTopic(article.title, article.content);
  const highlight = highlights[0]?.highlightText || inferCoreIssue(article);
  const opinion = article.myOpinion
    ? `结合你的观点「${article.myOpinion}」，可以进一步沉淀成一个个人判断标准。`
    : "你还没有填写个人观点，后续可以补充赞同、反对或可迁移场景。";

  return [
    `1. 可以转化为的观察角度：从「${topic}」的表层事件转向背后的行为变化，观察谁的需求被重新定义、谁的表达或产品路径正在失效。`,
    `2. 可以转化为的内容选题：围绕「${highlight}」做一个解释型选题，例如“为什么这个变化现在发生”“它改变了谁的选择”。`,
    "3. 可以转化为的产品 / 运营 / 研究思路：把文章判断改造成假设，再用用户反馈、数据或更多案例验证，不把单篇文章直接当结论。",
    `4. 后续值得继续追踪的问题：这个趋势是否只是单点事件？是否会改变用户选择、内容传播或产品设计的默认路径？${opinion}`
  ].join("\n");
}

export async function generateReusableInsights(
  article: ArticleLike,
  highlights: HighlightLike[] = []
) {
  const highlightText = highlights.map((item) => `- ${item.highlightText}`).join("\n") || "暂无高亮";
  const real = await callAi(undefined, [
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "user",
      content: [
        "请生成可复用启发，必须结合文章内容、用户高亮和我的观点，不能空泛。",
        "输出结构固定为：",
        "1. 可以转化为的观察角度：",
        "2. 可以转化为的内容选题：",
        "3. 可以转化为的产品 / 运营 / 研究思路：",
        "4. 后续值得继续追踪的问题：",
        `用户高亮：\n${highlightText}`,
        articlePrompt(article)
      ].join("\n\n")
    }
  ]);

  return real?.source === "real" && real.text ? real.text : mockReusableInsights(article, highlights);
}

function fallbackRecommendTags(title: string, content: string, existingTags: string[]) {
  const haystack = `${title}\n${content}`.toLowerCase();
  const matched = tagRules
    .map(([tag, keywords]) => ({
      tag,
      score: keywords.filter((kw) => keywordMatches(haystack, kw)).length
    }))
    .filter((item) => existingTags.includes(item.tag) && item.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((item) => item.tag);

  const fallback = existingTags.filter((tag) => !matched.includes(tag));
  return [...matched, ...fallback].slice(0, 3);
}

export async function recommendTags(
  title: string,
  content: string,
  existingTags: string[],
  options?: { userId?: string }
) {
  const fallback = fallbackRecommendTags(title, content, existingTags);
  const real = await callAi(options?.userId, [
    { role: "system", content: "你是一个严格的文章标签推荐器，只能输出 JSON，不要输出解释。" },
    {
      role: "user",
      content: [
        "请从用户已有标签中为文章推荐 2-3 个标签，第一项必须是主标签，后面是副标签。",
        "只允许使用已有标签，不要创造新标签。",
        "输出 JSON 数组，例如：[\"AI\",\"产品\",\"营销\"]。",
        `已有标签：${existingTags.join("、")}`,
        `标题：${title}`,
        `正文：${trimForPrompt(content, 5000)}`
      ].join("\n")
    }
  ], { temperature: 0.2, maxTokens: 300, actionType: "tag_recommendation" });

  if (!real || real.source !== "real" || !real.text) return fallback;

  try {
    const parsed = JSON.parse(real.text.replace(/```json|```/g, "").trim());
    if (Array.isArray(parsed)) {
      const tags = parsed.map(String).filter((tag) => existingTags.includes(tag));
      return Array.from(new Set(tags)).slice(0, 3).length ? Array.from(new Set(tags)).slice(0, 3) : fallback;
    }
  } catch {
    return fallback;
  }

  return fallback;
}

export async function generateKeywords(title: string, content: string) {
  const words = parseCsvLike(`${title}，${content}`)
    .join(" ")
    .match(/[\u4e00-\u9fa5]{2,6}|[a-zA-Z]{3,}/g);
  const unique = Array.from(new Set(words ?? []));
  return unique.slice(0, 8).join("，");
}

function mockTagReport(input: {
  tagName: string;
  start: string;
  end: string;
  articles: Array<ArticleLike & { methodologyAndInsights?: string | null; notes?: Array<{ noteType: string; highlightText?: string | null; userComment?: string | null }> }>;
}) {
  const articleTitles = input.articles.map((article) => article.title).slice(0, 5);
  const noteTypes = input.articles.flatMap((article) => article.notes ?? []).map((note) => NOTE_TYPE_LABELS[note.noteType as keyof typeof NOTE_TYPE_LABELS] ?? "未分类");
  const opinions = input.articles.map((article) => article.myOpinion).filter(Boolean);
  const repeatedQuestions = input.articles.map((article) => inferCoreIssue(article)).slice(0, 3);

  return [
    `${REPORT_SECTIONS[0]}\n${input.start} 至 ${input.end}，你在「${input.tagName}」标签下沉淀了 ${input.articles.length} 篇文章。重点不是数量，而是这些文章共同指向了哪些反复出现的问题。`,
    `${REPORT_SECTIONS[1]}\n${[input.tagName, ...Array.from(new Set(noteTypes)).slice(0, 5)].join("、") || "阅读、观点、方法"}`,
    `${REPORT_SECTIONS[2]}\n这些材料共同呈现出一个趋势：信息价值正在从“知道发生了什么”转向“能否形成可迁移的判断框架”。反复出现的问题包括：${repeatedQuestions.join("；") || "暂无足够样本"}。`,
    `${REPORT_SECTIONS[3]}\n${articleTitles.length ? articleTitles.map((title) => `- ${title}`).join("\n") : "- 暂无代表文章"}`,
    `${REPORT_SECTIONS[4]}\n- 用同一标签下的文章交叉验证一个判断，而不是孤立保存单篇结论。\n- 将高亮句子改写成“下次如何判断”的行动规则。\n- 对同一趋势保留赞同证据和反例证据。`,
    `${REPORT_SECTIONS[5]}\n${opinions.length ? opinions.slice(0, 4).join("\n") : "本期还没有填写个人观点，建议补充阅读后的判断、反例和可迁移场景。"}`,
    `${REPORT_SECTIONS[6]}\n- 哪些观点能转化为自己的表达模板？\n- 哪些案例可以用于后续选题或方案？\n- 这个标签是否需要继续拆分为更具体的研究方向？`
  ].join("\n\n");
}

export async function generateTagReport(input: {
  tagName: string;
  start: string;
  end: string;
  articles: Array<ArticleLike & { methodologyAndInsights?: string | null; notes?: Array<{ noteType: string; highlightText?: string | null; userComment?: string | null }> }>;
  userId?: string;
}): Promise<AiTextResult> {
  const materials = input.articles.map((article, index) => ({
    index: index + 1,
    title: article.title,
    myOpinion: article.myOpinion,
    excerpt: excerpt(article.content, 700),
    methodologyAndInsights: article.methodologyAndInsights,
    notes: (article.notes ?? []).slice(0, 8)
  }));

  const real = await callAi(input.userId, [
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "user",
      content: [
        `请为「${input.tagName}」标签生成 ${input.start} 至 ${input.end} 的洞察报告。`,
        "不要做文章摘要合集，要综合文章、用户高亮和我的观点，体现跨文章归纳。",
        "必须包含以下七个分区标题：",
        REPORT_SECTIONS.join("\n"),
        "要求指出重复出现的问题、共同趋势、新观察、可复用方法论和后续值得追踪的问题。",
        `材料 JSON：${JSON.stringify(materials)}`
      ].join("\n\n")
    }
  ], { temperature: 0.45, maxTokens: 1800, actionType: "tag_report" });

  if (real?.source === "real" && real.text) return real;

  return {
    text: mockTagReport(input),
    source: "mock",
    warning: real?.warning || "当前未配置真实大模型 API，系统已使用 mock fallback。"
  };
}
