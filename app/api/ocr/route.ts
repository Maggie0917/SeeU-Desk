import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { OcrError, recognizeImagesText } from "@/lib/services/ocr";

export const runtime = "nodejs";

export async function POST(request: Request) {
  await requireUser();
  const formData = await request.formData();
  const files = [...formData.getAll("files"), ...formData.getAll("file")].filter((file): file is File => file instanceof File);
  if (!files.length) {
    return NextResponse.json({ error: "请先上传截图。" }, { status: 400 });
  }

  try {
    const images = await Promise.all(files.map(async (file) => ({
      fileName: file.name,
      mimeType: file.type,
      buffer: Buffer.from(await file.arrayBuffer())
    })));
    const result = await recognizeImagesText(images);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "OCR 识别失败：OCR 服务异常";
    return NextResponse.json(
      {
        error: message,
        code: error instanceof OcrError ? error.code : "service_error"
      },
      { status: error instanceof OcrError && error.code === "unsupported_format" ? 400 : 422 }
    );
  }
}
