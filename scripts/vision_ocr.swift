import AppKit
import Foundation
import Vision

func recognize(path: String) -> String {
    guard let image = NSImage(contentsOfFile: path) else {
        fputs("无法读取图片：\(path)\n", stderr)
        return ""
    }

    var rect = CGRect(origin: .zero, size: image.size)
    guard let cgImage = image.cgImage(forProposedRect: &rect, context: nil, hints: nil) else {
        fputs("无法解析图片像素：\(path)\n", stderr)
        return ""
    }

    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = true
    request.recognitionLanguages = ["zh-Hans", "zh-Hant", "en-US"]

    let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
    do {
        try handler.perform([request])
        let lines = request.results?.compactMap { observation in
            observation.topCandidates(1).first?.string
        } ?? []
        return lines.joined(separator: "\n")
    } catch {
        fputs("OCR 识别失败：\(error.localizedDescription)\n", stderr)
        return ""
    }
}

let paths = CommandLine.arguments.dropFirst()
let texts = paths.map { recognize(path: String($0)) }.filter { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
print(texts.joined(separator: "\n\n"))
