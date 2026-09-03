import { chromium } from "@playwright/test";

const browser = await chromium.launch({
  headless: true,
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
});
const results = [];

try {
  for (const viewport of [
    { name: "mobile", width: 375, height: 700 },
    { name: "tablet", width: 768, height: 800 },
    { name: "desktop", width: 1280, height: 800 },
  ]) {
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      deviceScaleFactor: 1,
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    const failures = [];
    page.on("pageerror", (error) => failures.push(`pageerror: ${error.message}`));
    page.on("console", (message) => {
      if (message.type() === "error" && !message.text().includes("challenges.cloudflare.com")) {
        failures.push(`console: ${message.text()}`);
      }
    });
    await page.route("https://challenges.cloudflare.com/turnstile/v0/api.js*", (route) =>
      route.fulfill({
        contentType: "application/javascript",
        body: "window.turnstile={render:()=>1,execute:()=>{},reset:()=>{},remove:()=>{}};",
      }),
    );
    await page.goto("http://127.0.0.1:5173/", { waitUntil: "networkidle" });
    await page.getByRole("heading", { name: "想说什么，直接写下来" }).waitFor();
    const dimensions = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      page: document.documentElement.scrollWidth,
    }));
    if (dimensions.page > dimensions.viewport) {
      failures.push(`horizontal overflow ${dimensions.page}px > ${dimensions.viewport}px`);
    }
    await page.screenshot({ path: `/private/tmp/boss-message-box-${viewport.name}.png`, fullPage: true });

    await page.goto("http://127.0.0.1:5173/my", { waitUntil: "networkidle" });
    await page.getByRole("heading", { name: "查看我的留言" }).waitFor();
    const historyDimensions = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      page: document.documentElement.scrollWidth,
    }));
    if (historyDimensions.page > historyDimensions.viewport) {
      failures.push(`history overflow ${historyDimensions.page}px > ${historyDimensions.viewport}px`);
    }
    await page.screenshot({ path: `/private/tmp/boss-message-box-history-${viewport.name}.png`, fullPage: true });
    results.push({ viewport, failures });
    await context.close();
  }

  const context = await browser.newContext({ viewport: { width: 375, height: 700 } });
  const page = await context.newPage();
  await page.route("https://challenges.cloudflare.com/turnstile/v0/api.js*", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: "window.turnstile={render:()=>1,execute:()=>{},reset:()=>{},remove:()=>{}};",
    }),
  );
  await page.goto("http://127.0.0.1:5173/", { waitUntil: "networkidle" });
  await page.getByRole("combobox", { name: /留言主题/ }).selectOption("other");
  await page.getByRole("textbox", { name: /请填写留言主题/ }).fill("试用建议");
  await page.getByRole("textbox", { name: /留言内容/ }).fill("希望直播中讲一下设置方法。");
  await page.getByRole("textbox", { name: /抖音昵称/ }).fill("测试观众");
  await page.getByRole("textbox", { name: /手机号/ }).fill("13800138000");
  await page.getByRole("button", { name: "《隐私政策》" }).click();
  await page.getByRole("dialog").waitFor();
  console.log(
    "Dialog focus:",
    await page.evaluate(() => ({
      tag: document.activeElement?.tagName,
      text: document.activeElement?.textContent?.trim(),
      className: document.activeElement?.className,
    })),
  );
  await page.screenshot({ path: "/private/tmp/boss-message-box-policy-mobile.png", fullPage: true });
  await page.getByRole("button", { name: "我知道了" }).click();
  const retained = await page.getByRole("textbox", { name: /留言内容/ }).inputValue();
  if (retained !== "希望直播中讲一下设置方法。") throw new Error("Policy dialog cleared the draft");
  await context.close();
} finally {
  await browser.close();
}

console.log(JSON.stringify(results, null, 2));
if (results.some((result) => result.failures.length > 0)) process.exitCode = 1;
