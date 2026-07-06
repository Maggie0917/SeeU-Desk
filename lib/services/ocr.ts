import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { compactText } from "@/lib/text";

const execFileAsync = promisify(execFile);

export class OcrError extends Error {
  code: "unsupported_format" | "empty_text" | "service_unavailable" | "service_error";

  constructor(message: string, code: OcrError["code"] = "service_error") {
    super(message);
    this.name = "OcrError";
    this.code = code;
  }
}

export type OcrImageInput = {
  fileName: string;
  mimeType: string;
  buffer: Buffer;
};

export type OcrResult = {
  text: string;
  source: "macos_vision" | "external_provider";
  titleSuggestion?: string;
  imageCount: number;
};

const SUPPORTED_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/jpg", "image/webp", "image/tiff", "image/heic", "image/heif"]);

function ensureSupportedImages(images: OcrImageInput[]) {
  if (!images.length) throw new OcrError("请先上传截图。", "unsupported_format");
  for (const image of images) {
    if (!SUPPORTED_MIME_TYPES.has(image.mimeType)) {
      throw new OcrError(`图片格式不支持：${image.mimeType || image.fileName}。请上传 jpg、png、webp、heic 或 tiff。`, "unsupported_format");
    }
  }
}

export function cleanOcrText(text: string) {
  const seen = new Set<string>();
  const lines = text
    .replace(/\r/g, "\n")
    .split(/\n+/)
    .map((line) => compactText(line))
    .filter(Boolean)
    .filter((line) => {
      const compact = line.replace(/\s+/g, "");
      if (compact.length <= 1) return false;
      if (/^(点赞|评论|分享|收藏|关注|转发|打开抖音|打开小红书|下载抖音|下载小红书|点击查看|展开|收起|说点什么|搜索)$/.test(compact)) return false;
      if (/^\d+(\.\d+)?万?$/.test(compact)) return false;
      const key = compact.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function suggestTitleFromOcr(text: string, fallback: string) {
  const lines = cleanOcrText(text).split("\n").map((line) => line.trim()).filter(Boolean);
  const candidate = lines.find((line) => {
    if (line.length < 6 || line.length > 42) return false;
    if (/^(点赞|评论|分享|关注|打开|下载|第\d+张)/.test(line)) return false;
    return /[\u4e00-\u9fa5A-Za-z]/.test(line);
  });
  return candidate || fallback;
}

async function callExternalProvider(images: OcrImageInput[]): Promise<OcrResult | null> {
  const provider = process.env.OCR_PROVIDER?.trim();
  const apiUrl = process.env.OCR_API_URL?.trim();
  if (!provider || provider === "macos_vision" || !apiUrl) return null;

  const response = await fetch(apiUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(process.env.OCR_API_KEY ? { authorization: `Bearer ${process.env.OCR_API_KEY}` } : {})
    },
    body: JSON.stringify({
      provider,
      images: images.map((image) => ({
        fileName: image.fileName,
        mimeType: image.mimeType,
        base64: image.buffer.toString("base64")
      }))
    }),
    signal: AbortSignal.timeout(30000)
  });
  const data = await response.json().catch(() => ({})) as { text?: string; error?: string };
  if (!response.ok) {
    throw new OcrError(`OCR 服务异常：${data.error || response.statusText || response.status}`, "service_error");
  }
  const text = cleanOcrText(String(data.text ?? ""));
  if (text.length < 8) throw new OcrError("未能识别出有效文字。你可以重新上传更清晰的截图，或手动粘贴正文。", "empty_text");
  return {
    text,
    source: "external_provider",
    titleSuggestion: suggestTitleFromOcr(text, "截图 OCR 导入"),
    imageCount: images.length
  };
}

async function runMacVisionOcr(images: OcrImageInput[]): Promise<OcrResult> {
  if (process.platform !== "darwin") {
    throw new OcrError("当前未配置真实 OCR，且本地系统不支持 macOS Vision OCR。请手动粘贴正文，或配置 OCR_PROVIDER / OCR_API_URL。", "service_unavailable");
  }

  const workDir = path.join(tmpdir(), `knowledge-ocr-${randomUUID()}`);
  await mkdir(workDir, { recursive: true });
  const imagePaths: string[] = [];
  try {
    for (const [index, image] of images.entries()) {
      const ext = path.extname(image.fileName) || mimeToExt(image.mimeType);
      const imagePath = path.join(workDir, `${String(index).padStart(3, "0")}${ext}`);
      await writeFile(imagePath, image.buffer);
      imagePaths.push(imagePath);
    }

    const sourcePath = path.join(process.cwd(), "scripts", "vision_ocr.m");
    const binaryPath = path.join(workDir, "vision_ocr");
    await execFileAsync("clang", [
      sourcePath,
      "-framework",
      "Foundation",
      "-framework",
      "AppKit",
      "-framework",
      "Vision",
      "-o",
      binaryPath
    ], {
      timeout: 60000,
      maxBuffer: 1024 * 1024 * 8
    });

    const { stdout, stderr } = await execFileAsync(binaryPath, imagePaths, {
      timeout: 60000,
      maxBuffer: 1024 * 1024 * 8
    });
    if (stderr && !stdout.trim()) {
      if (/Error loading network/i.test(stderr)) {
        throw new OcrError("OCR 服务异常：macOS Vision 文字识别模型加载失败。你可以重新上传更清晰的截图，或配置 OCR_PROVIDER / OCR_API_URL 使用外部 OCR 服务。", "service_error");
      }
      throw new OcrError(`OCR 服务异常：${stderr.trim()}`, "service_error");
    }
    const text = cleanOcrText(stdout);
    if (text.length < 8) {
      throw new OcrError("未能识别出有效文字。你可以重新上传更清晰的截图，或手动粘贴正文。", "empty_text");
    }
    return {
      text,
      source: "macos_vision",
      titleSuggestion: suggestTitleFromOcr(text, "截图 OCR 导入"),
      imageCount: images.length
    };
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

function mimeToExt(mimeType: string) {
  return {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/webp": ".webp",
    "image/tiff": ".tiff",
    "image/heic": ".heic",
    "image/heif": ".heif"
  }[mimeType] || ".img";
}

export async function recognizeImagesText(images: OcrImageInput[]): Promise<OcrResult> {
  ensureSupportedImages(images);
  const external = await callExternalProvider(images);
  if (external) return external;
  return runMacVisionOcr(images);
}
