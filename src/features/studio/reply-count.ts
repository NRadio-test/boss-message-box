function chineseNumber(count: number, omitLeadingOne = true): string {
  if (count < 10) return "零一二三四五六七八九"[count]!;
  const unit = count >= 100000000 ? 100000000 : count >= 10000 ? 10000 : count >= 1000 ? 1000 : count >= 100 ? 100 : 10;
  const names: Record<number, string> = { 10: "十", 100: "百", 1000: "千", 10000: "万", 100000000: "亿" };
  const rest = count % unit;
  return `${count < 20 && omitLeadingOne ? "" : chineseNumber(Math.floor(count / unit))}${names[unit]}${rest ? `${rest < unit / 10 ? "零" : ""}${chineseNumber(rest, false)}` : ""}`;
}

export function replyCountLabel(count: number): string {
  return count > 0 ? `已回复·${count === 2 ? "两" : chineseNumber(count)}条` : "未回复";
}
