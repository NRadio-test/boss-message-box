import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const output = mkdtempSync("/private/tmp/nradio-ultra-preview-");
const browser = await chromium.launch({ headless: true, executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
const source = "/Users/dawn/Desktop/未命名文件夹";
const files = readdirSync(source).filter(name => name.endsWith(".jpg"));
const items = files.map((fileName, i) => ({ id: `photo-${i}`, fileName, senderName: fileName.replace(/\.jpg$/i, ""), uploadedAt: Date.now() - i * 1000,
  byteSize: readFileSync(join(source, fileName)).length, imageUrl: `/api/studio/ultra-photos/photo-${i}/image` }));
const errors = [];
let uploadAttempts = 0;
const uploadKeys = [];
try {
  const page = await browser.newPage({ reducedMotion: "reduce" });
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/api/studio/**", async route => {
    const path = new URL(route.request().url()).pathname;
    const reply = json => route.fulfill({ json });
    if (path.endsWith("/session")) return reply({ ok: true, admin: { id: "fixture", username: "本地管理员" }, mode: "normal", expiresAt: Date.now() + 86400000 });
    if (path.endsWith("/stats")) return reply({ ok: true, todayFeedback: 0, unreplied: 0, todo: 0, todayReplied: 0 });
    if (path.endsWith("/ultra-photos")) {
      if (route.request().method() === "POST") {
        uploadAttempts++;
        uploadKeys.push(route.request().postData().match(/name="requestKey"\r\n\r\n([^\r]+)/)?.[1]);
        if (uploadAttempts === 1) return route.fulfill({ status: 500, json: { error: { message: "模拟上传失败" } } });
        const item = { ...items[0], id: "new-photo", senderName: "新上传观众", fileName: "新上传观众.jpg", uploadedAt: Date.now() + 10000, imageUrl: items[0].imageUrl };
        if (!items.some(old => old.id === item.id)) items.unshift(item);
        return reply({ ok: true, item });
      }
      return reply({ ok: true, items });
    }
    const photoId = path.match(/\/ultra-photos\/([^/]+)\/image$/)?.[1];
    if (photoId) {
      const item = items.find(item => item.id === photoId);
      return route.fulfill({ body: readFileSync(join(source, item.fileName)), contentType: "image/jpeg" });
    }
    throw new Error(`Unexpected API request: ${path}`);
  });
  for (const width of [375, 768, 1280]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto("http://127.0.0.1:5174/studio/ultra-photos");
    await expect(page.locator(".studio-ultra-preview")).toHaveCount(17);
    if (width === 1280) {
      const navigation = page.locator(".studio-sidebar .studio-nav");
      const links = await navigation.locator(":scope > a").allTextContents();
      assert.equal(links[links.indexOf("待办") + 1], "Ultra 到货照片");
      await expect(navigation.getByRole("link", { name: "Ultra 到货照片" })).toBeInViewport();
    }
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    const upload = page.getByRole("button", { name: "上传照片", exact: true });
    const live = page.getByRole("button", { name: "直播展示", exact: true });
    const a = await upload.boundingBox(); const b = await live.boundingBox();
    assert(a.x < b.x && a.y + a.height <= 800 && b.y + b.height <= 800);
    await page.screenshot({ path: join(output, `gallery-${width}.png`) });
    await page.locator(".studio-ultra-preview").first().click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.locator(".studio-lightbox-stage img")).toBeVisible();
    await page.keyboard.press("Escape");
    await live.click();
    await expect(page.locator(".studio-live-identity h1")).toHaveText(items[0].senderName);
    await expect(page.locator(".studio-ultra-stage-image img")).toBeVisible();
    await page.waitForFunction(() => document.querySelector(".studio-ultra-stage-image img")?.naturalWidth > 0);
    await page.screenshot({ path: join(output, `live-${width}.png`) });
    await page.keyboard.press("ArrowRight");
    await expect(page.locator(".studio-live-identity h1")).toHaveText(items[1].senderName);
    await page.keyboard.press("ArrowLeft");
    await expect(page.locator(".studio-live-identity h1")).toHaveText(items[0].senderName);
    await page.mouse.move(1, 1);
    await page.getByRole("button", { name: "退出直播模式" }).click();
    await expect(page.getByRole("heading", { name: "Ultra 到货照片" })).toBeVisible();
    console.log(`PASS ${width}px gallery, corner actions, preview, live image, newest-first navigation, exit`);
  }
  await page.locator('input[type="file"]').setInputFiles({ name: "新上传观众.jpg", mimeType: "image/jpeg", buffer: readFileSync(join(source, files[0])) });
  await expect(page.getByRole("alert")).toContainText("模拟上传失败");
  await page.getByRole("button", { name: "重试剩余照片" }).click();
  await expect(page.locator(".studio-ultra-preview").first()).toContainText("新上传观众");
  assert(uploadKeys[0] && uploadKeys[0] === uploadKeys[1]);
  await page.reload();
  await expect(page.locator(".studio-ultra-preview").first()).toContainText("新上传观众");
  assert.deepEqual(errors, []);
  console.log(`PASS upload retry and persisted reload. Screenshots: ${output}`);
} finally { await browser.close(); }
