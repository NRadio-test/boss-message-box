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
      const expectedStudioSessionMiss = message.text().includes("401 (Unauthorized)");
      if (
        message.type() === "error" &&
        !message.text().includes("challenges.cloudflare.com") &&
        !expectedStudioSessionMiss
      ) {
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

    await page.getByRole("button", { name: "《隐私政策》" }).click();
    const policyAction = page.getByRole("button", { name: "我知道了" });
    await policyAction.waitFor();
    const actionBox = await policyAction.boundingBox();
    if (!actionBox || actionBox.y < 0 || actionBox.y + actionBox.height > viewport.height) {
      failures.push("policy action is clipped outside the viewport");
    }
    await page.screenshot({ path: `/private/tmp/boss-message-box-policy-${viewport.name}.png` });
    await policyAction.click();

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

    await page.goto("http://127.0.0.1:5173/studio", { waitUntil: "networkidle" });
    await page.getByRole("heading", { name: "登录 Studio" }).waitFor();
    await page.getByLabel("账号").fill("zd");
    await page.getByLabel("密码").fill("admin");
    await page.getByRole("button", { name: "登录" }).click();
    await page.getByRole("heading", { name: "未回复留言" }).waitFor();
    await page.locator(".studio-feedback-card, .studio-empty").first().waitFor();
    const studioDimensions = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      page: document.documentElement.scrollWidth,
    }));
    if (studioDimensions.page > studioDimensions.viewport) {
      failures.push(`studio overflow ${studioDimensions.page}px > ${studioDimensions.viewport}px`);
    }
    if (await page.getByRole("link", { name: "提交留言" }).count()) {
      failures.push("public navigation leaked into Studio");
    }
    await page.screenshot({ path: `/private/tmp/boss-message-box-studio-${viewport.name}.png`, fullPage: true });

    if (viewport.name === "desktop" && await page.locator(".studio-feedback-card-main").count()) {
      await page.locator(".studio-feedback-card-main").first().click();
      await page.getByRole("heading", { name: "已发布硬件" }).waitFor();
      const detailOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
      if (detailOverflow) failures.push("studio detail has horizontal overflow");
      await page.screenshot({ path: "/private/tmp/boss-message-box-studio-detail-desktop.png", fullPage: true });
      await page.locator(".studio-back-button").click();
      await page.getByRole("heading", { name: "未回复留言" }).waitFor();
      await page.locator(".studio-live-toggle:visible").click();
      await page.getByRole("button", { name: "退出直播模式" }).waitFor();
      if (await page.locator(".studio-search:visible").count()) failures.push("Studio search remains visible in live mode");
      if (await page.getByText("双击显示完整号码").count()) failures.push("phone reveal remains visible in live mode");
      await page.screenshot({ path: "/private/tmp/boss-message-box-studio-live-desktop.png", fullPage: true });
      await page.getByRole("button", { name: "退出直播模式" }).click();
      await page.locator('.studio-shell[data-mode="normal"]').waitFor();
      await page.getByRole("heading", { name: "未回复留言" }).waitFor();
    }

    if (viewport.width < 1024) {
      await page.locator(".studio-mobile-menu > summary").click();
      await page.locator(".studio-mobile-menu[open] .studio-logout-row").click();
    } else {
      const desktopLogout = page.locator('.studio-sidebar .studio-icon-button[aria-label="退出登录"]');
      if (!(await desktopLogout.isVisible())) {
        const shellState = await page.evaluate(() => ({
          width: window.innerWidth,
          mode: document.querySelector(".studio-shell")?.getAttribute("data-mode"),
          sidebarDisplay: getComputedStyle(document.querySelector(".studio-sidebar")).display,
          href: location.href,
        }));
        failures.push(`desktop logout is hidden: ${JSON.stringify(shellState)}`);
      } else {
        await desktopLogout.click();
      }
    }
    if (!failures.some((failure) => failure.startsWith("desktop logout is hidden"))) {
      const logoutDialog = page.getByRole("dialog");
      await logoutDialog.getByRole("heading", { name: "确定退出登录吗？" }).waitFor();
      await logoutDialog.locator("button.button--quiet", { hasText: "取消" }).click();
    }
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
