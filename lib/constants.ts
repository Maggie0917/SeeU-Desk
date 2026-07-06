export const DEFAULT_TAGS = [
  "AI",
  "营销",
  "产品",
  "品牌",
  "人文",
  "影视",
  "女性主义",
  "热点新闻",
  "新传"
] as const;

export const NOTE_TYPE_LABELS = {
  key_viewpoint: "重点观点",
  quote: "金句",
  methodology: "方法论",
  case: "案例",
  data: "数据",
  uncategorized: "未分类"
} as const;

export const READING_STATUS_LABELS = {
  unread: "待读",
  reading: "阅读中",
  finished: "已读完"
} as const;

export const REPORT_SECTIONS = [
  "一、本期阅读概览",
  "二、高频关键词",
  "三、主要趋势",
  "四、代表文章",
  "五、可复用方法论",
  "六、我的观点沉淀",
  "七、后续值得追踪的问题"
] as const;
