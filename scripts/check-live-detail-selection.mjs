import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync } from "node:fs";
import { join } from "node:path";

const output = mkdtempSync("/private/tmp/nradio-live-detail-");
const base = process.env.VISUAL_BASE_URL ?? "http://127.0.0.1:5174";
const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ??
  (existsSync("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome") ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : undefined) });
const id = "10000000-0000-4000-8000-000000000001";
const batchId = "00000000-0000-4000-8000-000000000007";
const item = {
  id, feedbackNumber: "10000000", userId: null, nickname: "本地模拟观众", topic: "appeal", customTopic: null,
  content: "本地模拟留言：验证详情页选入与取消直播展示，原始留言和回复都应保留。", contentPreview: "本地模拟留言",
  imageCount: 0, images: [], maskedPhone: null, shopPhone: null, createdAt: Date.UTC(2026, 8, 12, 15, 33),
  status: "replied", isTodo: false, replyCount: 1, latestReplyAdmin: "测试管理员", moderationStatus: "kept",
  routingStatus: "not_selected", liveSelected: false,
  replies: [{ id: "reply-1", content: "保留这条历史回复", replyType: "message", adminUsername: "测试管理员", createdAt: Date.UTC(2026, 8, 12, 15, 34) }],
};
const errors = [];
const requests = [];
let failNext = false;
try {
  const page = await browser.newPage({ reducedMotion: "reduce" });
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/api/studio/**", route => {
    const path = new URL(route.request().url()).pathname;
    const reply = json => route.fulfill({ json });
    if (path.endsWith("/session")) return reply({ ok: true, admin: { id: "fixture", username: "测试管理员" }, mode: "normal", expiresAt: Date.now() + 86400000 });
    if (path.endsWith("/stats")) return reply({ ok: true, todayFeedback: 1, unreplied: 0, todo: 0, todayReplied: 1 });
    if (path.endsWith("/new-feedback-count")) return reply({ ok: true, count: 0 });
    if (path.endsWith("/live/active")) return reply({ ok: true, batch: { id: batchId, status: "active", count: item.liveSelected ? 1 : 0 } });
    if (path.includes("/live/routing/") && route.request().method() === "POST") {
      requests.push({ path, body: route.request().postDataJSON() });
      if (failNext) { failNext = false; return route.fulfill({ status: 500, json: { error: { message: "模拟网络失败" } } }); }
      item.liveSelected = !path.endsWith("/remove"); item.routingStatus = item.liveSelected ? "selected" : "pending";
      return reply({ ok: true });
    }
    if (path.endsWith(`/feedbacks/${id}`)) return reply({ ok: true, item });
    return route.fulfill({ status: 404, json: { error: { message: `Unexpected fixture: ${path}` } } });
  });
  for (const [width, scale] of [[375, 100], [768, 100], [1280, 100], [768, 200]]) {
    item.liveSelected = false;
    await page.setViewportSize({ width, height: 800 });
    await page.goto(`${base}/studio/feedback/${id}?view=unreplied`);
    const section = page.locator(".studio-moderation-section");
    const select = section.getByRole("button", { name: "选入直播展示" });
    await expect(select).toBeVisible();
    if (scale === 200) await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
    await section.scrollIntoViewIfNeeded();
    await section.evaluate(element => {
      const toolbarBottom = document.querySelector(".studio-toolbar").getBoundingClientRect().bottom;
      window.scrollBy(0, element.getBoundingClientRect().top - toolbarBottom - 12);
    });
    const geometry = await section.locator("button").evaluateAll(elements => elements.map(element => {
      const rect = element.getBoundingClientRect(); return { left: rect.left, right: rect.right, height: rect.height };
    }));
    assert(geometry.every(rect => rect.left >= 0 && rect.right <= width && rect.height >= 44));
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: join(output, `select-${width}-${scale}.png`) });
    await select.focus(); await page.keyboard.press("Enter");
    const cancel = section.getByRole("button", { name: "取消直播展示" });
    await expect(cancel).toBeVisible();
    await expect(cancel).toBeFocused();
    await page.screenshot({ path: join(output, `cancel-${width}-${scale}.png`) });
    await cancel.click();
    await expect(select).toBeVisible();
    console.log(`PASS ${width}px / ${scale}% text: same-row controls, keyboard, selection/cancel, no overflow`);
  }
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`${base}/studio/feedback/${id}?view=live_display`);
  const draft = page.getByRole("textbox", { name: "回复内容" });
  await draft.fill("未提交草稿");
  failNext = true;
  await page.getByRole("button", { name: "选入直播展示" }).click();
  await expect(page.getByRole("alert")).toContainText("模拟网络失败");
  await expect(page.getByRole("button", { name: "标记为已过滤" })).toBeDisabled();
  await page.getByRole("button", { name: "重试直播展示操作" }).click();
  await expect(page.getByRole("button", { name: "取消直播展示" })).toBeVisible();
  assert.deepEqual(requests.at(-1), requests.at(-2));
  await expect(draft).toHaveValue("未提交草稿");
  await expect(page.getByText("保留这条历史回复", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "取消直播展示" })).toBeVisible();
  assert.deepEqual(errors, []);
  console.log(`PASS pinned retry, preserved draft/reply, persisted selection. Screenshots: ${output}`);
} finally { await browser.close(); }
