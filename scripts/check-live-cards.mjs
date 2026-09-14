import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";

const output = mkdtempSync("/private/tmp/nradio-live-cards-");
const base = process.env.VISUAL_BASE_URL ?? "http://127.0.0.1:5174";
const scaled = process.env.VISUAL_TEXT_SCALE === "200";
const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
const batch = { id: "00000000-0000-4000-8000-000000000007", startedAt: 1, status: "active", archivedAt: null, revision: 0, count: 32 };
const items = Array.from({ length: 32 }, (_, i) => ({
  id: `10000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`, batchId: batch.id,
  feedbackId: `20000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`, sourceType: i === 8 ? "imported" : "public",
  filename: "本地测试.xlsx", importRowNumber: i + 2, importOrder: i + 2, addedAt: 1, queueGroup: 0, sortOrder: i + 1,
  feedbackNumber: String(i + 1), userId: null, nickname: `测试观众${i + 1}`, topic: "appeal", customTopic: null,
  content: i === 6 ? ("这是用于本地测试的长留言。希望列表保持紧凑，同时可以展开阅读全文，打开详情后返回原来的位置。\n\n").repeat(8) : `这是一条本地模拟留言 ${i + 1}。`,
  contentPreview: "本地模拟留言", imageCount: 0, images: [], maskedPhone: null, shopPhone: null, createdAt: 1789000000000,
  status: i % 3 ? "replied" : "unreplied", isTodo: false, replyCount: i % 3, latestReplyAdmin: null, replies: [], moderationStatus: "kept", liveSelected: true,
}));
items[8].feedbackId = null;
items[8].replyCount = 0;
items[8].status = "unreplied";
const errors = []; let moves = 0; let removals = 0;
try {
  const page = await browser.newPage({ reducedMotion: "reduce" });
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/api/studio/**", route => {
    const url = new URL(route.request().url()); const path = url.pathname;
    const reply = json => route.fulfill({ json });
    if (path.endsWith("/session")) return reply({ ok: true, admin: { id: "fixture", username: "测试管理员" }, mode: "normal", expiresAt: Date.now() + 86400000 });
    if (path.endsWith("/live/batches")) return reply({ ok: true, batches: [batch] });
    if (path.endsWith("/live/entries")) {
      const current = Number(url.searchParams.get("page") ?? 1);
      return reply({ ok: true, batch, items: items.slice((current - 1) * 30, current * 30), total: items.length, page: current, totalPages: 2 });
    }
    if (path.endsWith("/move")) { moves++; batch.revision++; return reply({ ok: true }); }
    if (path.endsWith("/remove")) { removals++; return reply({ ok: true }); }
    if (path.includes("/live/entries/")) return reply({ ok: true, item: items.find(item => path.endsWith(item.id)), batchId: batch.id });
    if (path.includes("/feedbacks/")) return reply({ ok: true, item: items.find(item => path.endsWith(item.feedbackId)) });
    if (path.endsWith("/stats")) return reply({ ok: true, todayFeedback: 0, unreplied: 0, todo: 0, todayReplied: 0 });
    if (path.endsWith("/new-feedback-count")) return reply({ ok: true, count: 0 });
    return route.fulfill({ status: 404, json: { error: { message: `Unexpected fixture: ${path}` } } });
  });
  const card = n => page.locator(`[data-feedback-id="${items[n - 1].id}"]`);
  for (const width of scaled ? [768] : [375, 768, 1280]) {
    await page.setViewportSize({ width, height: 800 });
    if (page.url() !== "about:blank") await page.evaluate(() => sessionStorage.clear());
    await page.goto(`${base}/studio/live-display`);
    if (scaled) await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
    await expect(card(7).getByRole("button", { name: "展开全文" })).toBeVisible();
    await card(7).evaluate(el => el.scrollIntoView({ block: "center" }));
    const height = await card(7).locator(".studio-live-entry-content").evaluate(el => el.clientHeight);
    const lineHeight = await card(7).locator(".studio-live-entry-content").evaluate(el => parseFloat(getComputedStyle(el).lineHeight));
    assert(height <= lineHeight * 3 + 1);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: join(output, `cards-${width}.png`) });
    await card(7).getByRole("button", { name: "展开全文" }).click();
    await expect(card(7).getByRole("button", { name: "收起正文" })).toHaveAttribute("aria-expanded", "true");
    assert.equal(new URL(page.url()).pathname, "/studio/live-display");
    await card(8).locator("h2").evaluate(el => el.scrollIntoView({ block: "center" }));
    if (scaled) await card(8).locator("h2").evaluate(el => window.scrollBy({ top: el.getBoundingClientRect().top - 400, behavior: "instant" }));
    const top = await card(8).evaluate(el => el.getBoundingClientRect().top);
    // Click blank space in the card, not the nickname/link text.
    const box = await card(8).boundingBox();
    const heading = await card(8).locator("h2").boundingBox();
    assert(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest("a")?.classList.contains("studio-live-card-link"),
      { x: box.x + box.width - 30, y: heading.y + heading.height / 2 }), "whole-card hit target must be below the sticky header");
    await page.mouse.click(box.x + box.width - 30, heading.y + heading.height / 2);
    await expect(page).toHaveURL(new RegExp(`/studio/feedback/${items[7].feedbackId}`));
    items[7].replyCount = 2;
    await page.getByRole("button", { name: "返回", exact: true }).first().click();
    await expect(card(8).getByText("已回复·两条")).toBeVisible();
    await expect(page.getByRole("combobox", { name: "按直播批次筛选" })).toHaveValue(batch.id);
    await expect.poll(() => card(8).evaluate(el => el.getBoundingClientRect().top)).toBeCloseTo(top, -1);
    await expect(card(7).getByRole("button", { name: "收起正文" })).toHaveAttribute("aria-expanded", "true");
    await card(8).getByRole("link").focus(); await page.keyboard.press("Enter");
    await expect(page).toHaveURL(new RegExp(`/studio/feedback/${items[7].feedbackId}`));
    await page.goBack();
    await expect.poll(() => card(8).evaluate(el => el.getBoundingClientRect().top)).toBeCloseTo(top, -1);
    console.log(`PASS ${width}px: three-line collapse, whole-card click, reply badge, explicit return and browser back at eighth row`);
  }
  await card(9).getByRole("link").click();
  await expect(page).toHaveURL(new RegExp(`/studio/live-display/${items[8].id}`));
  await page.getByRole("link", { name: "返回列表" }).click();
  await expect(card(9)).toBeVisible();
  await card(9).getByRole("button", { name: "上移", exact: true }).click();
  assert.equal(new URL(page.url()).pathname, "/studio/live-display"); assert.equal(moves, 1);
  await card(9).getByRole("button", { name: "取消直播展示" }).click();
  await expect.poll(() => removals).toBe(1);
  assert.equal(new URL(page.url()).pathname, "/studio/live-display");
  await page.getByRole("button", { name: "下一页", exact: true }).click();
  await card(32).getByRole("link").click();
  await page.getByRole("button", { name: "返回", exact: true }).first().click();
  await expect(card(32)).toBeVisible(); assert.equal(new URL(page.url()).searchParams.get("page"), "2");
  assert.deepEqual(errors, []);
  console.log(`PASS imported detail, independent row controls, page-two return. Screenshots: ${output}`);
} finally { await browser.close(); }
