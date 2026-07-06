export function compactText(text: string) {
  return text
    .replace(/\r/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

export function excerpt(text: string, length = 140) {
  const normalized = compactText(text).replace(/\n/g, " ");
  return normalized.length > length ? `${normalized.slice(0, length)}...` : normalized;
}

export function parseCsvLike(value?: string | null) {
  if (!value) return [];
  return value
    .split(/[,，、\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function asDateInput(date: Date) {
  return date.toISOString().slice(0, 10);
}
