#!/usr/bin/env node
/**
 * Captures screenshots of every page (desktop and phone) and walks one full
 * quest in demo mode, collecting console errors and basic timing on the way.
 *
 *   npm run build && npm run preview &
 *   node scripts/ui/capture.mjs http://localhost:4173 docs/assets/screens
 *
 * Requires Playwright with a Chromium build (npx playwright install chromium).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";

const base = process.argv[2] ?? "http://localhost:4173";
const out = process.argv[3] ?? "docs/assets/screens";
mkdirSync(out, { recursive: true });

const ROUTES = [
  ["gate", "/#/?demo=1"],
  ["play", "/#/play?demo=1"],
  ["chronicle", "/#/chronicle?demo=1"],
  ["hall", "/#/hall?demo=1"],
  ["vault", "/#/vault?demo=1"],
  ["codex", "/#/codex?demo=1"],
  ["keeper", "/#/keeper?demo=1"],
];

const problems = [];
const report = { pages: [], flow: [] };

const browser = await chromium.launch({
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--enable-webgl"],
});

async function open(context, label) {
  const page = await context.newPage();
  page.on("console", (m) => m.type() === "error" && problems.push(`[${label}] console: ${m.text()}`));
  page.on("pageerror", (e) => problems.push(`[${label}] pageerror: ${e.message}`));
  page.on("requestfailed", (r) => problems.push(`[${label}] request failed: ${r.url()}`));
  return page;
}

for (const [name, viewport] of [
  ["desktop", { width: 1440, height: 900 }],
  ["phone", { width: 390, height: 844 }],
]) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  for (const [route, path] of ROUTES) {
    const page = await open(context, `${name}/${route}`);
    await page.goto(base + path, { waitUntil: "networkidle" });
    await page.waitForTimeout(route === "gate" ? 2200 : 500);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    const hero = route === "gate" ? await page.getAttribute("[data-testid=hero-visual]", "data-mode") : null;
    report.pages.push({ viewport: name, route, horizontalOverflowPx: overflow, heroMode: hero });
    await page.screenshot({ path: join(out, `${route}-${name}.png`), fullPage: route !== "gate" });
    if (route === "gate") await page.screenshot({ path: join(out, `gate-${name}-full.png`), fullPage: true });
    await page.close();
  }
  await context.close();
}

// One complete quest in demo mode.
{
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await open(context, "flow");
  const step = async (label, fn, shot) => {
    const started = Date.now();
    await fn();
    report.flow.push({ step: label, ms: Date.now() - started });
    if (shot) await page.screenshot({ path: join(out, `flow-${shot}.png`) });
  };
  await page.goto(base + "/#/play?demo=1", { waitUntil: "networkidle" });
  await step("choose the second door", async () => {
    await page.getByRole("button", { name: /Depths/ }).click();
  }, "1-doors");
  await step("pay and descend", async () => {
    await page.getByRole("button", { name: "Pay and descend" }).click();
    await page.getByRole("dialog").waitFor();
    await page.waitForTimeout(1300); // let the entry animation finish and the pipeline advance
  }, "2-consensus");
  await step("scroll appears", async () => {
    await page.getByRole("dialog").waitFor({ state: "detached", timeout: 20000 });
    await page.getByLabel("What does your adventurer do?").waitFor({ timeout: 15000 });
  }, "3-scroll");
  await step("write an action", async () => {
    await page
      .getByLabel("What does your adventurer do?")
      .fill("I carefully inspect the area first, then plan a slow route, test each step with a rope and shield the lantern before moving on.");
    await page.waitForTimeout(700);
  }, "4-action");
  await step("seal the action", async () => {
    await page.getByRole("button", { name: "Seal this action" }).click();
    await page.getByRole("dialog").waitFor({ state: "detached", timeout: 20000 });
    await page.getByRole("button", { name: "Call the scribes" }).waitFor({ timeout: 15000 });
  }, "5-review");
  await step("call the scribes", async () => {
    await page.getByRole("button", { name: "Call the scribes" }).click();
    await page.getByRole("dialog").waitFor();
    await page.waitForTimeout(2600);
    await page.screenshot({ path: join(out, "flow-6a-judging.png") });
    await page.getByRole("dialog").waitFor({ state: "detached", timeout: 30000 });
    await page.locator(".scroll").getByText(/^(Victory|Defeat)/).first().waitFor({ timeout: 10000 });
  }, "6-verdict");
  await step("claim the reward", async () => {
    const claim = page.getByRole("button", { name: /^(Claim|Close this quest)/ });
    if (await claim.count()) {
      await claim.first().click();
      await page.getByRole("dialog").waitFor({ state: "detached", timeout: 30000 });
    }
    await page.waitForTimeout(400);
  }, "7-after");
  await context.close();
}

await browser.close();
writeFileSync(join(out, "capture-report.json"), JSON.stringify({ report, problems }, null, 2));
console.log(JSON.stringify({ report, problems }, null, 2));
process.exit(problems.length ? 1 : 0);
