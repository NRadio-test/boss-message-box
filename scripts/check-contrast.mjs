const colors = {
  liveBg: "#0e171c",
  livePanel: "#19252b",
  livePlate: "#1d2a31",
  livePlateDeep: "#141f25",
  livePaper: "#eee8dc",
  liveBrass: "#cfb78b",
  liveBrassLight: "#e7d8b5",
  liveBrassDeep: "#9a7f4c",
  liveCoral: "#ff6570",
  liveMuted: "#a8b4b7",
  liveEmblem: "#512f36",
  liveIdentity: "#2c2228",
  bg: [0.17, 0.028, 254],
  bgDeep: [0.135, 0.026, 254],
  surface: [0.215, 0.034, 253],
  surfaceRaised: [0.285, 0.048, 248],
  surfaceHover: [0.33, 0.052, 246],
  text: [0.977, 0.008, 245],
  textSecondary: [0.82, 0.027, 247],
  textMuted: [0.74, 0.032, 249],
  accent: [0.84, 0.13, 218],
  accentHover: [0.88, 0.115, 216],
  accentInk: [0.16, 0.025, 246],
  success: [0.79, 0.12, 162],
  successSurface: [0.28, 0.055, 162],
  warning: [0.85, 0.13, 83],
  danger: [0.78, 0.13, 28],
  dangerSurface: [0.28, 0.07, 28],
  neutralStatus: [0.68, 0.025, 248],
};

function toLinearRgb(value) {
  if (typeof value === "string") {
    return value.slice(1).match(/../g).map(hex => {
      const channel = parseInt(hex, 16) / 255;
      return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    });
  }
  const [lightness, chroma, hue] = value;
  const radians = (hue * Math.PI) / 180;
  const a = chroma * Math.cos(radians);
  const b = chroma * Math.sin(radians);
  const lPrime = lightness + 0.3963377774 * a + 0.2158037573 * b;
  const mPrime = lightness - 0.1055613458 * a - 0.0638541728 * b;
  const sPrime = lightness - 0.0894841775 * a - 1.291485548 * b;
  const l = lPrime ** 3;
  const m = mPrime ** 3;
  const s = sPrime ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ].map((channel) => Math.min(1, Math.max(0, channel)));
}

function toSrgb(channel) {
  return channel <= 0.0031308 ? 12.92 * channel : 1.055 * channel ** (1 / 2.4) - 0.055;
}

function toHex(value) {
  return `#${toLinearRgb(value)
    .map(toSrgb)
    .map((channel) => Math.round(channel * 255).toString(16).padStart(2, "0"))
    .join("")}`;
}

function luminance(value) {
  const [red, green, blue] = toLinearRgb(value);
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrast(foreground, background) {
  const lighter = Math.max(luminance(foreground), luminance(background));
  const darker = Math.min(luminance(foreground), luminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}

const checks = [
  ["直播昵称最亮端 / 标题条", "liveBrassLight", "liveIdentity", 4.5],
  ["直播昵称最暗端 / 标题条", "liveBrass", "liveIdentity", 4.5],
  ["直播主题 / 标题条", "liveMuted", "liveIdentity", 4.5],
  ["直播辅助文字 / 面板", "liveMuted", "livePanel", 4.5],
  ["直播错误 / 面板", "danger", "livePanel", 4.5],
  ["直播正文 / 留言表面", "livePaper", "livePanel", 4.5],
  ["直播正文 / 留言表面凹层", "livePaper", "livePlateDeep", 4.5],
  ["直播黄铜装饰 / 面板（非文本 3:1）", "liveBrassDeep", "livePlate", 3],
  ["正文 / 页面", "text", "bg", 4.5],
  ["直播排序文字 / 排序工具区", "text", "surfaceRaised", 4.5],
  ["直播排序输入文字 / 输入底色", "text", "bgDeep", 4.5],
  ["次级文字 / 页面", "textSecondary", "bg", 4.5],
  ["弱化文字 / 表单面板", "textMuted", "surface", 4.5],
  ["主按钮文字 / 强调色", "accentInk", "accent", 4.5],
  ["错误文字 / 表单面板", "danger", "surface", 4.5],
  ["删除回复 / 悬停底色", "danger", "surfaceHover", 4.5],
  ["确认删除 / 危险操作底色", "danger", "dangerSurface", 4.5],
  ["成功文字 / 表单面板", "success", "surface", 4.5],
  ["已回复标签 / 绿色底色", "success", "successSurface", 4.5],
  ["未回复标签 / 抬升底色", "warning", "surfaceRaised", 4.5],
  ["状态文字 / 表单面板", "neutralStatus", "surface", 4.5],
];

console.log("Palette:");
for (const [name, value] of Object.entries(colors)) console.log(`  ${name}: ${toHex(value)}`);
console.log("Contrast:");
for (const [label, foreground, background, minimum] of checks) {
  const ratio = contrast(colors[foreground], colors[background]);
  const status = ratio >= minimum ? "PASS" : "FAIL";
  console.log(`${status} ${label}: ${ratio.toFixed(2)}:1 (${toHex(colors[foreground])} / ${toHex(colors[background])})`);
  if (status === "FAIL") process.exitCode = 1;
}
