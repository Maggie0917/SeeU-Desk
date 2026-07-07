"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent, type ReactNode } from "react";

type Tag = {
  id: string;
  name: string;
  isDefault: boolean;
  folderMapping: {
    feishuFolderName: string;
    feishuFolderToken: string;
    lastSyncedAt: string | null;
  } | null;
};

type HelpTopic = "feishu" | "ai";

function buildWechatBookmarklet(appOrigin: string) {
  const code = `
(() => {
  const target = ${JSON.stringify(`${appOrigin}/import-helper`)};
  const origin = ${JSON.stringify(appOrigin)};
  const pick = (selectors) => {
    for (const selector of selectors) {
      const node = document.querySelector(selector);
      if (node && node.innerText && node.innerText.trim()) return node;
    }
    return null;
  };
  const cleanText = (root) => {
    const clone = root.cloneNode(true);
    clone.querySelectorAll("script,style,iframe,button,input,textarea,svg,canvas,noscript,[hidden],[aria-hidden='true'],.js_ad_area,.rich_media_tool,.comment_area,[class*='advert'],[class*='recommend'],[class*='comment'],[class*='share']").forEach((node) => node.remove());
    const blocks = Array.from(clone.querySelectorAll("p,section,h1,h2,h3,h4,li,blockquote"))
      .map((node) => (node.innerText || "").replace(/\\s+/g, " ").trim())
      .filter((line) => line.length > 2 && !/^(广告|推荐阅读|相关阅读|微信扫一扫|扫一扫|分享|赞|在看)$/.test(line));
    const lines = blocks.length ? blocks : (clone.innerText || "").split(/\\n+/);
    const seen = new Set();
    return lines.map((line) => line.replace(/\\s+/g, " ").trim()).filter(Boolean).filter((line) => {
      const key = line.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).join("\\n\\n");
  };
  const titleNode = pick(["#activity-name", ".rich_media_title", "h1"]);
  const authorNode = pick(["#js_name", ".rich_media_meta_nickname", ".profile_nickname"]);
  const timeNode = pick(["#publish_time", "em.rich_media_meta_text", "time"]);
  const contentNode = pick(["#js_content", ".rich_media_content", ".rich_media_area_primary", "article", "main"]);
  const payload = {
    source: "seeu-wechat-import",
    title: titleNode ? titleNode.innerText.trim() : document.title.replace(/\\s*[-_]\\s*微信公众平台\\s*$/, "").trim(),
    author: authorNode ? authorNode.innerText.trim() : "",
    publishedAt: timeNode ? timeNode.innerText.trim() : "",
    sourceUrl: location.href,
    content: contentNode ? cleanText(contentNode) : ""
  };
  const win = window.open(target, "_blank");
  let count = 0;
  const timer = window.setInterval(() => {
    if (!win || win.closed || count > 25) {
      window.clearInterval(timer);
      if (navigator.clipboard && payload.content) navigator.clipboard.writeText(JSON.stringify(payload)).catch(() => {});
      return;
    }
    win.postMessage(payload, origin);
    count += 1;
  }, 350);
})();
`;
  return `javascript:${encodeURIComponent(code)}`;
}

function HelpIconButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex h-9 min-w-9 items-center justify-center rounded-full border border-sky bg-white px-3 text-sm font-black text-sky transition hover:bg-aqua"
      aria-label={label}
      title={label}
    >
      ?
    </button>
  );
}

function HelpCode({ children }: { children: string }) {
  return (
    <pre className="mt-3 overflow-x-auto whitespace-pre-wrap break-words rounded-lg border border-sky/20 bg-paper p-3 text-sm leading-6 text-ink">
      <code>{children}</code>
    </pre>
  );
}

function HelpSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-line bg-white p-4">
      <h3 className="text-base font-black text-ink">{title}</h3>
      <div className="mt-3 space-y-3 text-sm leading-7 text-moss">{children}</div>
    </section>
  );
}

function HelpModal({ topic, onClose }: { topic: HelpTopic; onClose: () => void }) {
  const isFeishu = topic === "feishu";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-3 sm:p-6">
      <div className="flex max-h-[92vh] w-full max-w-4xl flex-col rounded-2xl border border-sky/20 bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-paper px-5 py-4 sm:px-6">
          <div>
            <h2 className="text-xl font-black text-ink">{isFeishu ? "飞书连接说明" : "大模型绑定说明"}</h2>
            <p className="mt-1 text-sm text-moss">
              {isFeishu
                ? "一步一步完成飞书账号授权、文件夹链接填写和文章同步。"
                : "一步一步确认 API Key、Base URL、模型名称和测试连接。"}
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded-full px-3 py-1 text-sm font-semibold text-moss hover:bg-paper">
            关闭
          </button>
        </div>

        <div className="space-y-4 overflow-y-auto bg-[#fffaf0] px-4 py-5 sm:px-6">
          {isFeishu ? <FeishuHelpContent /> : <AiHelpContent />}
        </div>
      </div>
    </div>
  );
}

function FeishuHelpContent() {
  return (
    <>
      <HelpSection title="快速说明">
        <p>连接飞书后，系统可以把你的文章摘要、画线笔记、方法论和启示、我的观点同步为真实飞书文档。你不需要创建飞书应用，也不需要填写任何应用密钥。你只需要授权自己的飞书账号，并选择文档同步到哪个飞书文件夹。</p>
      </HelpSection>

      <HelpSection title="步骤一：点击连接飞书">
        <p>在设置页找到“飞书授权”模块，点击“连接飞书”或“重新授权飞书”。</p>
        <p>如果你之前已经连接过飞书，但同步失败或权限变更，可以点击“重新授权飞书”重新连接。</p>
      </HelpSection>

      <HelpSection title="步骤二：在飞书页面确认授权">
        <p>点击后，你会跳转到飞书授权页面。请确认授权信息，然后点击“同意授权”或“授权”。</p>
        <p>授权成功后，飞书会自动跳回本产品。你不需要手动复制授权码。</p>
      </HelpSection>

      <HelpSection title="步骤三：确认授权状态">
        <p>回到设置页后，如果看到“飞书已授权”或类似状态，说明连接成功。</p>
        <p>如果授权失败，请重新点击“连接飞书”。不要复用旧的授权页面链接，因为飞书授权链接可能会过期。</p>
      </HelpSection>

      <HelpSection title="步骤四：填写飞书文件夹链接或 folder_token">
        <p>第一次同步某个标签下的文章时，系统会要求你填写飞书文件夹链接或 <code>folder_token</code>。这个文件夹就是文章笔记同步后保存的位置。</p>
        <p className="font-semibold text-ink">这里不能填写文件夹名称。请填写飞书文件夹链接，或链接里的 <code>folder_token</code>。</p>
      </HelpSection>

      <HelpSection title="步骤五：如何复制飞书文件夹链接">
        <ol className="list-decimal space-y-1 pl-5">
          <li>打开飞书。</li>
          <li>进入你想保存文章笔记的文件夹。</li>
          <li>复制浏览器地址栏中的文件夹链接。</li>
          <li>回到本产品，把链接粘贴到输入框中。</li>
        </ol>
        <p>可以填写完整文件夹链接：</p>
        <HelpCode>{"https://xxx.feishu.cn/drive/folder/AbCdEfGhIjKlMn"}</HelpCode>
        <p>也可以只填写 <code>folder_token</code>：</p>
        <HelpCode>{"AbCdEfGhIjKlMn"}</HelpCode>
        <p><code>folder_token</code> 通常是飞书文件夹 URL 中 <code>/drive/folder/</code> 后面的那一段。例如上面的链接中，<code>AbCdEfGhIjKlMn</code> 就是 <code>folder_token</code>。</p>
      </HelpSection>

      <HelpSection title="步骤六：开始同步文章">
        <p>完成飞书授权和文件夹设置后，进入文章详情页，点击“同步飞书”。系统会把文章摘要、画线笔记、方法论和启示、我的观点同步为飞书文档。</p>
      </HelpSection>

      <HelpSection title="常见错误">
        <div>
          <h4 className="font-bold text-ink">授权链接失效</h4>
          <p>可能原因：飞书授权页面停留太久，或你使用了旧的授权链接。解决方法：回到设置页，重新点击“连接飞书”或“重新授权飞书”。</p>
        </div>
        <div>
          <h4 className="font-bold text-ink">提示缺少权限</h4>
          <p>可能原因：当前产品的飞书连接权限没有完全生效，或你授权时没有授予所需权限。解决方法：先回到设置页重新授权飞书；如果仍然失败，请联系产品管理员处理。</p>
        </div>
        <div>
          <h4 className="font-bold text-ink">invalid param</h4>
          <p>可能原因：你填写的不是有效飞书文件夹链接或 <code>folder_token</code>。解决方法：不要填写文件夹名称，打开飞书目标文件夹，复制浏览器地址栏中的完整链接，再回到本产品重新粘贴。</p>
        </div>
        <div>
          <h4 className="font-bold text-ink">同步后没有看到文档</h4>
          <p>请检查：你是否已经完成飞书授权；你填写的飞书文件夹链接是否可以打开；你当前飞书账号是否有该文件夹的编辑权限；文章详情页是否提示同步成功。</p>
        </div>
        <div>
          <h4 className="font-bold text-ink">我需要自己创建飞书连接应用吗？</h4>
          <p>不需要。普通用户不需要创建飞书连接应用，也不需要填写应用编号、应用密钥或回调地址。这些由产品管理员统一配置。</p>
        </div>
      </HelpSection>

      <HelpSection title="安全提醒">
        <p>飞书文件夹链接可能暴露你的文档空间位置，请不要随意发给无关人员。授权失败或同步异常时，优先重新授权；如果仍无法解决，请联系产品管理员。</p>
      </HelpSection>
    </>
  );
}

function AiHelpContent() {
  return (
    <>
      <HelpSection title="快速说明">
        <p>绑定大模型 API 后，系统会使用真实大模型生成文章摘要、方法论和启示、洞察报告。如果你没有绑定自己的 API Key，系统将无法使用真实大模型生成内容，只能使用备用结果。</p>
      </HelpSection>

      <HelpSection title="步骤一：选择模型供应商">
        <p>当前版本优先支持 OpenAI-compatible 接口。只要服务商兼容 OpenAI Chat Completions 格式，就可以尝试接入。</p>
        <HelpCode>{"模型供应商：OpenAI Compatible"}</HelpCode>
      </HelpSection>

      <HelpSection title="步骤二：获取 API Key">
        <p>以 DeepSeek 为例：</p>
        <ol className="list-decimal space-y-1 pl-5">
          <li>打开 DeepSeek API 平台。</li>
          <li>登录账号。</li>
          <li>进入 API Keys 页面。</li>
          <li>创建新的 API Key。</li>
          <li>复制生成的 Key。</li>
          <li>回到本产品设置页，粘贴到 API Key 输入框。</li>
        </ol>
        <p>API Key 只会在服务端加密保存，前端只显示尾号。不要把 API Key 发给别人，也不要提交到 GitHub。</p>
      </HelpSection>

      <HelpSection title="步骤三：填写 Base URL">
        <p>以 DeepSeek 为例，填写：</p>
        <HelpCode>{"https://api.deepseek.com"}</HelpCode>
        <p>不要填写 <code>https://platform.deepseek.com/api_keys</code>。那个是管理 API Key 的网页，不是接口地址。</p>
        <p>DeepSeek 提供 OpenAI-compatible API，OpenAI 格式的 <code>base_url</code> 为 <code>https://api.deepseek.com</code>，创建对话请求的接口路径为 <code>/chat/completions</code>。</p>
      </HelpSection>

      <HelpSection title="步骤四：填写模型名称">
        <p>模型名称必须和服务商文档或控制台中的名称一致。以 DeepSeek 为例，可按服务商控制台显示填写，例如：</p>
        <HelpCode>{"deepseek-chat"}</HelpCode>
        <p>不同服务商、不同时间支持的模型名称可能会变化。请以服务商官方文档或控制台显示为准。如果模型名称写错，会出现 <code>model not found</code> 或连接失败。</p>
      </HelpSection>

      <HelpSection title="步骤五：启用真实 AI">
        <p>打开“启用真实 AI 生成”开关。如果不打开，即使填写了 API Key，也可能继续使用 Mock fallback。</p>
      </HelpSection>

      <HelpSection title="步骤六：测试连接">
        <p>点击“测试连接”。如果显示连接成功，说明 Base URL、API Key 和模型名称基本可用。然后点击“保存设置”。</p>
      </HelpSection>

      <HelpSection title="步骤七：重新生成 AI 内容">
        <p>保存成功后，回到文章详情页，点击“重新生成文章摘要”或“重新生成方法论和启示”，即可使用真实大模型生成内容。</p>
      </HelpSection>

      <HelpSection title="常见错误">
        <div>
          <h4 className="font-bold text-ink">Unauthorized / 401</h4>
          <p>可能原因：API Key 填错、复制时多了空格、Key 已失效或账户不可用。解决方法：重新复制 API Key，确认没有多余空格。</p>
        </div>
        <div>
          <h4 className="font-bold text-ink">Not Found / 404</h4>
          <p>可能原因：Base URL 填错。解决方法：确认 Base URL 是接口地址，不是网页管理后台地址。DeepSeek 应填写 <code>https://api.deepseek.com</code>。</p>
        </div>
        <div>
          <h4 className="font-bold text-ink">model not found</h4>
          <p>可能原因：模型名称写错。解决方法：复制服务商文档或控制台中的模型名称。</p>
        </div>
        <div>
          <h4 className="font-bold text-ink">余额不足 / quota 不足</h4>
          <p>可能原因：API 账户余额不足或额度用完。解决方法：进入对应模型平台查看余额和用量。</p>
        </div>
        <div>
          <h4 className="font-bold text-ink">仍然显示 Mock fallback</h4>
          <p>可能原因：没有保存设置；没有打开“启用真实 AI”；测试连接失败；文章页没有重新生成内容。解决方法：保存设置后，回到文章页点击“重新生成文章摘要”和“重新生成方法论和启示”。</p>
        </div>
      </HelpSection>

      <HelpSection title="安全提醒">
        <p>API Key 是接口密钥，不是网页地址。它只应该填在 API Key 输入框中，不要放到 Base URL，也不要贴到聊天、截图或公开仓库里。</p>
      </HelpSection>
    </>
  );
}

export function SettingsClient({
  user,
  tags,
  settings,
  feishuMessage
}: {
  user: { email: string; name: string | null };
  tags: Tag[];
  settings: {
    feishuAuthStatus: string;
    ocrPreference: string;
    aiSummaryPreference: string;
    reportPreference: string;
    aiProvider: string;
    aiBaseUrl: string | null;
    aiModel: string | null;
    aiEnabled: boolean;
    aiApiKeyLast4: string | null;
    aiConnectionStatus: string;
    aiLastTestedAt: string | null;
  } | null;
  feishuMessage?: string;
}) {
  const router = useRouter();
  const [helpTopic, setHelpTopic] = useState<HelpTopic | null>(null);
  const [tagName, setTagName] = useState("");
  const [message, setMessage] = useState("");
  const [aiBaseUrl, setAiBaseUrl] = useState(settings?.aiBaseUrl || "https://api.openai.com/v1");
  const [aiModel, setAiModel] = useState(settings?.aiModel || "");
  const [aiApiKey, setAiApiKey] = useState("");
  const [aiEnabled, setAiEnabled] = useState(Boolean(settings?.aiEnabled));
  const aiConfigured = Boolean(settings?.aiApiKeyLast4);
  const aiStatusLabel = {
    not_configured: "未配置",
    not_tested: "已配置，未测试",
    success: "连接成功",
    failed: "连接失败",
    disabled: "已关闭"
  }[settings?.aiConnectionStatus || "not_configured"] || settings?.aiConnectionStatus || "未配置";
  const feishuStatusLabel = {
    api_ready: "已授权，可调用 API",
    connected: "已授权，可调用 API",
    expired: "已授权，但 token 可能失效",
    not_connected: "未授权",
    not_configured: "当前产品暂未配置飞书连接能力"
  }[settings?.feishuAuthStatus || "not_connected"] || "未授权";
  const appOrigin = typeof window === "undefined" ? "https://seeu-desk.netlify.app" : window.location.origin;
  const wechatBookmarkletHref = buildWechatBookmarklet(appOrigin);

  async function addTag(event: FormEvent) {
    event.preventDefault();
    const response = await fetch("/api/tags", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: tagName })
    });
    setMessage(response.ok ? "标签已新增" : "新增标签失败");
    setTagName("");
    router.refresh();
  }

  async function updateFolder(tagId: string, current?: string) {
    const folderName = window.prompt("请输入默认飞书文件夹展示名称", current || "");
    if (!folderName) return;
    const folderInput = window.prompt("请输入飞书文件夹链接或 folder_token。不能只填写文件夹名称，飞书 API 需要文件夹 token。", "");
    if (!folderInput) return;
    const response = await fetch(`/api/tags/${tagId}/folder`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ folderName, folderInput })
    });
    const data = await response.json().catch(() => ({}));
    setMessage(response.ok ? "映射已更新" : data.error || "映射更新失败");
    router.refresh();
  }

  async function clearFolder(tagId: string) {
    const response = await fetch(`/api/tags/${tagId}/folder`, { method: "DELETE" });
    setMessage(response.ok ? "映射已清除" : "清除失败");
    router.refresh();
  }

  async function deleteTag(tag: Tag) {
    const message = tag.isDefault
      ? "这是系统默认标签。删除后不会影响已存在文章内容，但相关标签关系和飞书文件夹映射会被移除。若它仍是文章主标签，将不会被删除。确认删除吗？"
      : "确认删除这个标签吗？删除后相关标签关系和飞书文件夹映射会被移除。";
    if (!window.confirm(message)) return;
    const response = await fetch(`/api/tags/${tag.id}`, { method: "DELETE" });
    const data = await response.json().catch(() => ({}));
    setMessage(response.ok ? "标签已删除" : data.error || "删除标签失败");
    router.refresh();
  }

  async function saveAiSettings(event: FormEvent) {
    event.preventDefault();
    const response = await fetch("/api/settings/ai", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        provider: "openai_compatible",
        baseUrl: aiBaseUrl,
        model: aiModel,
        apiKey: aiApiKey,
        enabled: aiEnabled
      })
    });
    const data = await response.json().catch(() => ({}));
    setMessage(response.ok ? "大模型设置已保存" : data.error || "大模型设置保存失败");
    if (response.ok) setAiApiKey("");
    router.refresh();
  }

  async function testAiConnection() {
    const response = await fetch("/api/settings/ai/test", { method: "POST" });
    const data = await response.json().catch(() => ({}));
    setMessage(data.message || (response.ok ? "连接成功" : "连接失败：请检查 API Key / Base URL / 模型名称"));
    router.refresh();
  }

  async function clearAiSettings() {
    if (!window.confirm("确认清除当前大模型 API 配置吗？清除后文章生成会回到 mock fallback。")) return;
    const response = await fetch("/api/settings/ai", { method: "DELETE" });
    setMessage(response.ok ? "大模型 API 配置已清除" : "清除失败");
    setAiApiKey("");
    setAiEnabled(false);
    router.refresh();
  }

  return (
    <div className="grid gap-5 xl:grid-cols-2">
      {helpTopic ? <HelpModal topic={helpTopic} onClose={() => setHelpTopic(null)} /> : null}

      <section className="card border-t-4 border-t-leaf">
        <h2 className="section-title">账号设置卡片</h2>
        <div className="mt-4 grid gap-3 text-sm text-moss">
          <div className="rounded-md bg-paper p-3">
            <div className="font-semibold text-ink">账号</div>
            <div className="mt-1">{user.email}</div>
          </div>
          <div className="rounded-md bg-paper p-3">
            <div className="font-semibold text-ink">昵称</div>
            <div className="mt-1">{user.name || "未设置"}</div>
          </div>
        </div>
      </section>

      <section className="card border-t-4 border-t-sky">
        <div className="flex items-start justify-between gap-3">
          <h2 className="section-title">飞书授权卡片</h2>
          <HelpIconButton label="如何连接飞书？" onClick={() => setHelpTopic("feishu")} />
        </div>
        <div className="mt-4 rounded-md bg-paper p-4">
          <div className="text-sm text-moss">当前状态</div>
          <div className="mt-1 text-lg font-bold text-ink">
            {feishuStatusLabel}
          </div>
          <p className="mt-2 text-sm leading-6 text-moss">
            连接后可以把文章摘要、画线笔记、方法论和启示同步为真实飞书文档。
          </p>
          {feishuMessage ? <div className="mt-3 rounded-md border border-leaf/30 bg-white px-3 py-2 text-sm text-ink">{feishuMessage}</div> : null}
        </div>
        {settings?.feishuAuthStatus === "not_configured" ? (
          <button className="btn mt-4" type="button" disabled>
            当前产品暂未配置飞书连接能力，请联系管理员
          </button>
        ) : (
          <div className="mt-4 flex flex-wrap gap-2">
            <a className="btn" href={settings?.feishuAuthStatus === "api_ready" || settings?.feishuAuthStatus === "connected" ? "/api/feishu/reconnect" : "/api/feishu/connect"}>
              {settings?.feishuAuthStatus === "api_ready" || settings?.feishuAuthStatus === "connected" ? "重新授权飞书" : "连接飞书"}
            </a>
            {settings?.feishuAuthStatus === "api_ready" || settings?.feishuAuthStatus === "connected" || settings?.feishuAuthStatus === "expired" ? (
              <a className="btn-secondary" href="/api/feishu/disconnect">清除飞书授权</a>
            ) : null}
          </div>
        )}
      </section>

      <section className="card border-t-4 border-t-leaf">
        <h2 className="section-title">标签管理卡片</h2>
        <form onSubmit={addTag} className="mt-4 flex gap-2">
          <input className="input" value={tagName} onChange={(event) => setTagName(event.target.value)} placeholder="新增标签" />
          <button className="btn whitespace-nowrap">新增</button>
        </form>
        <div className="mt-4 flex flex-wrap gap-2">
          {tags.map((tag) => (
            <span
              key={tag.id}
              className={tag.isDefault ? "inline-flex items-center gap-2 rounded-full bg-leaf px-2.5 py-1 text-xs font-bold text-white" : "pill border-sky bg-white text-sky"}
            >
              {tag.name}
              <button
                type="button"
                className={tag.isDefault ? "rounded-full bg-white/20 px-1.5 text-white hover:bg-white/30" : "rounded-full px-1.5 text-sky hover:bg-aqua"}
                onClick={() => deleteTag(tag)}
                aria-label={`删除标签 ${tag.name}`}
              >
                ×
              </button>
            </span>
          ))}
        </div>
        {message ? <div className="mt-4 rounded-md border border-sky/30 bg-paper px-3 py-2 text-sm text-ink">{message}</div> : null}
      </section>

      <section className="card border-t-4 border-t-sky">
        <h2 className="section-title">OCR 设置卡片</h2>
        <div className="mt-4 grid gap-3">
          <label className="label">OCR 服务</label>
          <select className="input" defaultValue={settings?.ocrPreference || "mock"}>
            <option value="mock">mock OCR</option>
            <option value="external" disabled>真实 OCR 预留</option>
          </select>
        </div>
      </section>

      <section className="card border-t-4 border-t-leaf xl:col-span-2">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h2 className="section-title">微信公众号导入助手</h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-moss">
              当微信公众号链接无法自动解析时，请在浏览器中打开公众号原文，点击书签栏中的“导入公众号到 SeeU Desk”，系统会从当前页面提取标题、公众号名、发布时间和正文，进入确认页后保存。
            </p>
          </div>
          <a
            className="btn whitespace-nowrap"
            href={wechatBookmarkletHref}
            draggable
            onClick={(event) => event.preventDefault()}
            title="把这个按钮拖到浏览器书签栏"
          >
            导入公众号到 SeeU Desk
          </a>
        </div>
        <div className="mt-4 grid gap-3 rounded-md bg-paper p-4 text-sm leading-6 text-moss md:grid-cols-3">
          <div>
            <div className="font-bold text-ink">1. 拖到书签栏</div>
            <p className="mt-1">把上方按钮拖到浏览器书签栏。不要点击按钮，拖动保存为书签。</p>
          </div>
          <div>
            <div className="font-bold text-ink">2. 打开公众号原文</div>
            <p className="mt-1">在浏览器中打开可正常阅读的公众号文章页面。</p>
          </div>
          <div>
            <div className="font-bold text-ink">3. 点击书签确认导入</div>
            <p className="mt-1">点击书签后会打开确认页，你可以编辑正文，再保存为文章。</p>
          </div>
        </div>
        <p className="mt-3 text-xs leading-5 text-moss">
          导入助手只读取当前页面可见的标题、公众号名、发布时间、来源链接和正文；不会读取 Cookie、Token、localStorage 或 sessionStorage，也不会静默保存。
        </p>
      </section>

      <section className="card border-t-4 border-t-leaf xl:col-span-2">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex items-center gap-3">
              <h2 className="section-title">大模型设置</h2>
              <HelpIconButton label="如何绑定大模型？" onClick={() => setHelpTopic("ai")} />
            </div>
            <p className="mt-2 text-sm text-moss">当前先支持 OpenAI Compatible 接口。API Key 会加密保存在服务端，不会在前端明文展示。</p>
          </div>
          <div className="rounded-md bg-paper px-3 py-2 text-sm text-ink">
            当前状态：<span className="font-bold">{aiStatusLabel}</span>
          </div>
        </div>
        <form onSubmit={saveAiSettings} className="mt-5 grid gap-4 lg:grid-cols-2">
          <label className="grid gap-2">
            <span className="label">模型供应商</span>
            <select className="input" value="openai_compatible" disabled>
              <option value="openai_compatible">OpenAI Compatible</option>
            </select>
          </label>
          <label className="grid gap-2">
            <span className="label">是否启用真实 AI</span>
            <button
              type="button"
              className={aiEnabled ? "btn w-fit" : "btn-secondary w-fit"}
              onClick={() => setAiEnabled((current) => !current)}
            >
              {aiEnabled ? "已启用真实 AI 生成" : "未启用，使用 mock fallback"}
            </button>
          </label>
          <label className="grid gap-2">
            <span className="label">Base URL</span>
            <input className="input" value={aiBaseUrl} onChange={(event) => setAiBaseUrl(event.target.value)} placeholder="https://api.openai.com/v1" />
          </label>
          <label className="grid gap-2">
            <span className="label">模型名称</span>
            <input className="input" value={aiModel} onChange={(event) => setAiModel(event.target.value)} placeholder="gpt-4o-mini / deepseek-chat / qwen-plus" />
          </label>
          <label className="grid gap-2 lg:col-span-2">
            <span className="label">API Key</span>
            <input className="input" type="password" value={aiApiKey} onChange={(event) => setAiApiKey(event.target.value)} placeholder={aiConfigured ? `已配置，尾号 ****${settings?.aiApiKeyLast4}` : "请输入 API Key"} />
            <span className="text-xs text-moss">{aiConfigured ? `API Key：已配置，尾号 ****${settings?.aiApiKeyLast4}` : "API Key：未配置"}</span>
          </label>
          <div className="grid gap-2 rounded-md bg-paper p-3 text-sm text-moss lg:col-span-2">
            <div>当前模型：{settings?.aiModel || aiModel || "-"}</div>
            <div>Base URL：{settings?.aiBaseUrl || aiBaseUrl || "-"}</div>
            <div>最近测试：{settings?.aiLastTestedAt ? new Date(settings.aiLastTestedAt).toLocaleString("zh-CN") : "-"}</div>
          </div>
          <div className="flex flex-wrap gap-2 lg:col-span-2">
            <button className="btn" type="submit">保存设置</button>
            <button className="btn-secondary" type="button" onClick={testAiConnection}>测试连接</button>
            <button className="btn-secondary" type="button" onClick={clearAiSettings}>清除 API 配置</button>
          </div>
        </form>
      </section>

      <section className="card border-t-4 border-t-leaf">
        <h2 className="section-title">AI 总结偏好卡片</h2>
        <div className="mt-4 grid gap-3">
          <label className="label">摘要风格</label>
          <select className="input" defaultValue={settings?.aiSummaryPreference || "balanced"}>
            <option value="balanced">平衡</option>
            <option value="concise">简洁</option>
            <option value="methodology">方法论优先</option>
          </select>
        </div>
      </section>

      <section className="card border-t-4 border-t-sky">
        <h2 className="section-title">报告生成偏好卡片</h2>
        <div className="mt-4 grid gap-3">
          <label className="label">生成方式</label>
          <select className="input" defaultValue={settings?.reportPreference || "manual"}>
            <option value="manual">手动生成</option>
            <option value="scheduled" disabled>定时生成预留</option>
          </select>
        </div>
      </section>

      <section className="card border-t-4 border-t-leaf xl:col-span-2">
        <h2 className="section-title">标签-飞书文件夹映射卡片</h2>
        <div className="mt-4 overflow-x-auto">
          <table className="table min-w-[820px]">
            <thead>
              <tr>
                <th>标签</th>
                <th>默认飞书文件夹</th>
                <th>文件夹 Token</th>
                <th>是否已配置</th>
                <th>最近同步时间</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {tags.map((tag) => (
                <tr key={tag.id}>
                  <td className="font-semibold text-ink">{tag.name}</td>
                  <td>{tag.folderMapping?.feishuFolderName || "-"}</td>
                  <td className="max-w-48 truncate">{tag.folderMapping?.feishuFolderToken || "-"}</td>
                  <td>{tag.folderMapping ? "已配置" : "未配置"}</td>
                  <td>{tag.folderMapping?.lastSyncedAt ? new Date(tag.folderMapping.lastSyncedAt).toLocaleString("zh-CN") : "-"}</td>
                  <td>
                    <div className="flex flex-wrap gap-2">
                      <button className="btn-secondary px-3 py-1.5 text-xs" onClick={() => updateFolder(tag.id, tag.folderMapping?.feishuFolderName)}>重新设置文件夹位置</button>
                      <button className="btn-secondary px-3 py-1.5 text-xs" onClick={() => clearFolder(tag.id)}>清除映射</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
