#import <AppKit/AppKit.h>
#import <Foundation/Foundation.h>
#import <Vision/Vision.h>

static NSArray<NSString *> *RecognizeWithLanguages(CGImageRef cgImage, NSArray<NSString *> *languages) {
  NSMutableArray<NSString *> *lines = [NSMutableArray array];
  VNRecognizeTextRequest *request = [[VNRecognizeTextRequest alloc] initWithCompletionHandler:^(VNRequest *request, NSError *error) {
    if (error) {
      fprintf(stderr, "OCR 识别失败：%s\n", error.localizedDescription.UTF8String);
      return;
    }
    for (VNRecognizedTextObservation *observation in request.results) {
      VNRecognizedText *candidate = [[observation topCandidates:1] firstObject];
      if (candidate.string.length > 0) {
        [lines addObject:candidate.string];
      }
    }
  }];
  request.recognitionLevel = VNRequestTextRecognitionLevelAccurate;
  request.usesLanguageCorrection = YES;
  if (languages.count > 0) {
    request.recognitionLanguages = languages;
  }

  VNImageRequestHandler *handler = [[VNImageRequestHandler alloc] initWithCGImage:cgImage options:@{}];
  NSError *error = nil;
  [handler performRequests:@[ request ] error:&error];
  if (error) {
    fprintf(stderr, "OCR 识别失败：%s\n", error.localizedDescription.UTF8String);
    return @[];
  }
  return lines;
}

static NSString *RecognizeImage(NSString *path) {
  NSImage *image = [[NSImage alloc] initWithContentsOfFile:path];
  if (!image) {
    fprintf(stderr, "无法读取图片：%s\n", path.UTF8String);
    return @"";
  }

  CGRect rect = CGRectMake(0, 0, image.size.width, image.size.height);
  CGImageRef cgImage = [image CGImageForProposedRect:&rect context:nil hints:nil];
  if (!cgImage) {
    fprintf(stderr, "无法解析图片像素：%s\n", path.UTF8String);
    return @"";
  }

  NSArray<NSString *> *lines = RecognizeWithLanguages(cgImage, @[ @"zh-Hans", @"zh-Hant", @"en-US" ]);
  if (lines.count == 0) {
    lines = RecognizeWithLanguages(cgImage, @[]);
  }
  return [lines componentsJoinedByString:@"\n"];
}

int main(int argc, const char *argv[]) {
  @autoreleasepool {
    NSMutableArray<NSString *> *texts = [NSMutableArray array];
    for (int index = 1; index < argc; index++) {
      NSString *path = [NSString stringWithUTF8String:argv[index]];
      NSString *text = RecognizeImage(path);
      if (text.length > 0) {
        [texts addObject:text];
      }
    }
    printf("%s\n", [[texts componentsJoinedByString:@"\n\n"] UTF8String]);
  }
  return 0;
}
