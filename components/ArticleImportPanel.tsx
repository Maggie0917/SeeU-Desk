"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useRef, useState } from "react";

type ParserDiagnostic = {
  platform?: string;
  title?: string;
  contentLength?: number;
  htmlLength?: number;
  httpStatus?: number;
  finalHost?: string;
  extractorUsed?: string;
  failureReason?: string;
  failureType?: string;
  fallbackOptions?: string[];
};

export function ArticleImportPanel() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [sourcePlatform, setSourcePlatform] = useState("");
  const [ocrText, setOcrText] = useState("");
  const [importMethod, setImportMethod] = useState("");
  const [message, setMessage] = useState("");
  const [diagnostic, setDiagnostic] = useState<ParserDiagnostic | null>(null);
  const [loading, setLoading] = useState(false);

  function diagnosticPlatformLabel(platform?: string) {
    return {
      wechat_mp: "mp.weixin.qq.com",
      xiaohongshu: "xiaohongshu.com",
      douyin: "douyin.com",
      generic_web: "网页"
    }[platform || ""] || platform || "";
  }

  function failureTypeLabel(type?: string) {
    return {
      content_too_short: "正文过短",
      container_not_found: "未找到正文容器",
      platform_shell_page: "平台壳页",
      login_required: "需要登录",
      dynamic_render_required: "需要浏览器渲染",
      anti_crawler: "平台限制访问",
      network_error: "网络请求失败",
      empty_content: "空正文",
      unknown: "未知原因"
    }[type || "unknown"] || type || "未知原因";
  }

  function specificFallbackTip(nextDiagnostic?: ParserDiagnostic) {
    if (!nextDiagnostic) return "解析失败，可以改用手动正文、OCR 或保存为待处理链接";
    if (nextDiagnostic.platform === "wechat_mp") {
      return "公众号文章可能限制服务端访问。你可以打开原文后复制正文粘贴导入，或使用 OCR / 保存为待处理链接。";
    }
    if (nextDiagnostic.platform === "xiaohongshu") {
      return "小红书内容可能需要浏览器渲染或登录态。你可以手动复制正文粘贴导入，或使用 OCR / 保存为待处理链接。";
    }
    if (nextDiagnostic.platform === "douyin") {
      return "抖音内容可能返回动态分享页。你可以上传截图 OCR、手动粘贴正文，或保存为待处理链接。";
    }
    if (nextDiagnostic.failureType === "anti_crawler" || nextDiagnostic.failureType === "login_required") {
      return "平台限制了服务端访问。请使用手动粘贴、OCR，或保存为待处理链接。";
    }
    if (nextDiagnostic.failureType === "container_not_found" || nextDiagnostic.failureType === "empty_content") {
      return "暂未识别到有效正文。请检查链接，或使用手动粘贴、OCR、保存待处理链接。";
    }
    return nextDiagnostic.failureReason || "暂未识别到正文。可以使用手动粘贴、OCR，或保存为待处理链接。";
  }

  function fallbackOcrTitle(fileName?: string) {
    if (diagnostic?.platform === "douyin" || sourcePlatform === "douyin.com") return "抖音图文 OCR 导入";
    if (diagnostic?.platform === "xiaohongshu" || sourcePlatform === "xiaohongshu.com") return "小红书图文 OCR 导入";
    const cleaned = fileName?.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim();
    return cleaned && !/^www\./i.test(cleaned) ? cleaned : "截图 OCR 导入";
  }

  function isUsefulTitle(value?: string) {
    if (!value) return false;
    const normalized = value.trim();
    if (/^(www\.)?douyin\.com$/i.test(normalized)) return false;
    if (/^(www\.)?xiaohongshu\.com$/i.test(normalized)) return false;
    if (normalized === "截图 OCR 导入") return false;
    return true;
  }

  async function importUrl(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setDiagnostic(null);
    setMessage("正在解析网页正文...");
    const response = await fetch("/api/articles/import-url", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url })
    });
    const data = await response.json().catch(() => ({}));
    setLoading(false);
    if (!response.ok) {
      const nextDiagnostic = data.diagnostic as ParserDiagnostic | undefined;
      setDiagnostic(nextDiagnostic ?? null);
      if (isUsefulTitle(nextDiagnostic?.title) && !title) setTitle(nextDiagnostic!.title!);
      if (nextDiagnostic?.platform && !sourcePlatform) setSourcePlatform(diagnosticPlatformLabel(nextDiagnostic.platform));
      setMessage(data.error || specificFallbackTip(nextDiagnostic));
      return;
    }
    router.push(`/article/${data.articleId}`);
    router.refresh();
  }

  async function savePendingImport() {
    if (!url.trim()) {
      setMessage("请先粘贴链接");
      return;
    }
    setLoading(true);
    setMessage("正在保存为待处理链接...");
    const response = await fetch("/api/articles/import-url", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url, savePending: true, diagnostic })
    });
    const data = await response.json().catch(() => ({}));
    setLoading(false);
    if (!response.ok) {
      setMessage(data.error || "保存待处理链接失败");
      return;
    }
    router.push(`/article/${data.articleId}`);
    router.refresh();
  }

  async function importManual(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    const response = await fetch("/api/articles/manual", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title, content, sourcePlatform, sourceUrl: url, importMethod })
    });
    const data = await response.json().catch(() => ({}));
    setLoading(false);
    if (!response.ok) {
      setMessage(data.error || "导入失败");
      return;
    }
    router.push(`/article/${data.articleId}`);
    router.refresh();
  }

  async function recognizeOcr() {
    const files = Array.from(fileRef.current?.files ?? []);
    if (!files.length) {
      setMessage("请先选择截图");
      return;
    }
    setLoading(true);
    setMessage(`正在识别 ${files.length} 张截图...`);
    const formData = new FormData();
    for (const file of files) {
      formData.append("files", file);
    }
    const response = await fetch("/api/ocr", { method: "POST", body: formData });
    const data = await response.json().catch(() => ({}));
    setLoading(false);
    if (!response.ok) {
      setMessage(data.error || "OCR 识别失败：未能识别出有效文字。你可以重新上传更清晰的截图，或手动粘贴正文。");
      return;
    }
    setOcrText(data.text);
    setContent(data.text);
    setTitle(title || (isUsefulTitle(data.titleSuggestion) ? data.titleSuggestion : fallbackOcrTitle(files[0]?.name)));
    setSourcePlatform(sourcePlatform || diagnosticPlatformLabel(diagnostic?.platform) || "截图 OCR");
    setImportMethod("ocr");
    setMessage(`OCR 识别完成（${data.source === "macos_vision" ? "macOS Vision" : "外部 OCR"}，${data.imageCount || files.length} 张），请确认或修改后导入。`);
  }

  return (
    <div className="grid gap-5 xl:grid-cols-3">
      <form onSubmit={importUrl} className="card bg-paper xl:col-span-3">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end">
          <div className="flex-1">
            <label className="label">粘贴任意图文链接</label>
            <textarea
              className="input min-h-28 resize-y text-base"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://example.com/article"
            />
          </div>
          <button className="btn h-11 lg:w-32" disabled={loading || !url.trim()}>
            解析链接
          </button>
        </div>
        {message ? <div className="mt-3 rounded-md border border-sky/30 bg-white px-3 py-2 text-sm text-ink">{message}</div> : null}
        {diagnostic ? (
          <div className="mt-3 rounded-md border border-coral/25 bg-white p-3 text-sm text-ink">
            <div className="font-bold text-coral">解析诊断：{failureTypeLabel(diagnostic.failureType)}</div>
            <div className="mt-1 text-moss">
              平台：{diagnosticPlatformLabel(diagnostic.platform)}；正文长度：{diagnostic.contentLength ?? 0}；提取器：{diagnostic.extractorUsed || "未命中"}
              {diagnostic.httpStatus ? `；HTTP：${diagnostic.httpStatus}` : ""}
              {diagnostic.finalHost ? `；最终站点：${diagnostic.finalHost}` : ""}
            </div>
            <div className="mt-1 text-moss">{diagnostic.failureReason}</div>
            <div className="mt-2 rounded-md bg-paper px-3 py-2 text-moss">
              {specificFallbackTip(diagnostic)}
            </div>
            {diagnostic.platform === "douyin" ? (
              <div className="mt-2 rounded-md bg-paper px-3 py-2 text-moss">
                该抖音链接暂时无法直接解析正文。建议上传抖音图文截图通过 OCR 识别，也可以手动粘贴正文，或先保存为待处理链接。
              </div>
            ) : null}
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" className="btn-secondary" onClick={() => {
                if (isUsefulTitle(diagnostic.title) && !title) setTitle(diagnostic.title!);
                if (diagnostic.platform && !sourcePlatform) setSourcePlatform(diagnosticPlatformLabel(diagnostic.platform));
                document.querySelector<HTMLTextAreaElement>("textarea[placeholder='粘贴或编辑正文内容']")?.focus();
              }}>
                手动粘贴正文
              </button>
              <button type="button" className="btn-secondary" onClick={() => fileRef.current?.click()}>
                上传截图 OCR
              </button>
              <button type="button" className="btn" onClick={savePendingImport} disabled={loading}>
                保存为待处理链接
              </button>
            </div>
          </div>
        ) : null}
      </form>

      <form onSubmit={importManual} className="card border-t-4 border-t-sky xl:col-span-2">
        <div className="flex items-center justify-between gap-4">
          <h2 className="section-title">手动粘贴正文</h2>
          <span className="pill">解析失败兜底</span>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <div>
            <label className="label">文章标题</label>
            <input className="input" value={title} onChange={(event) => setTitle(event.target.value)} />
          </div>
          <div>
            <label className="label">来源平台</label>
            <input
              className="input"
              value={sourcePlatform}
              onChange={(event) => setSourcePlatform(event.target.value)}
              placeholder="公众号 / 网站 / 小红书..."
            />
          </div>
        </div>
        <div className="mt-3">
          <label className="label">正文</label>
          <textarea
            className="input min-h-56 resize-y"
            value={content}
            onChange={(event) => setContent(event.target.value)}
            placeholder="粘贴或编辑正文内容"
          />
        </div>
        <button className="btn mt-4" disabled={loading || content.trim().length < 20}>
          确认生成阅读页
        </button>
      </form>

      <div className="card border-t-4 border-t-leaf">
        <div className="flex items-center justify-between gap-4">
          <h2 className="section-title">上传截图 OCR</h2>
          <span className="pill">真实 OCR</span>
        </div>
        <p className="mt-3 text-sm text-moss">
          上传一张或多张截图后识别文字，结果会自动进入左侧正文框。
        </p>
        <input ref={fileRef} className="input mt-4" type="file" accept="image/*" multiple />
        <button type="button" className="btn-secondary mt-3 w-full" onClick={recognizeOcr} disabled={loading}>
          {loading ? "识别中..." : "OCR 识别"}
        </button>
        {ocrText ? (
          <div className="mt-4 rounded-md border border-line bg-paper p-3 text-sm text-moss">
            {ocrText.slice(0, 180)}...
          </div>
        ) : null}
      </div>
    </div>
  );
}
