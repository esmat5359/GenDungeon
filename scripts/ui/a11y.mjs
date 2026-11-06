#!/usr/bin/env node
/**
 * Runs axe-core (WCAG 2.0/2.1 A and AA plus best practices) against every
 * page at desktop and phone width, in demo mode. Exits non-zero on any
 * violation.
 *
 *   node scripts/ui/a11y.mjs http://localhost:4173
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { chromium } from "playwright";

const require = createRequire(import.meta.url);
const axeSource = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
const base = process.argv[2] ?? "http://localhost:4173";
const routes = ["", "play", "chronicle", "hall", "vault", "codex", "keeper"];

const browser = await chromium.launch();
let failures = 0;
for (const viewport of [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
]) {
  const context = await browser.newContext({ viewport });
  for (const route of routes) {
    const page = await context.newPage();
    await page.goto(`${base}/#/${route}?demo=1&lowfx=1`, { waitUntil: "load" });
    await page.waitForTimeout(600);
    await page.evaluate(axeSource);
    const violations = await page.evaluate(async () => {
      const result = await window.axe.run(document, {
        runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"] },
      });
      return result.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.map((n) => n.target.join(" ")) }));
    });
    failures += violations.length;
    console.log(`${viewport.width}px /${route || ""}: ${violations.length ? JSON.stringify(violations) : "no violations"}`);
    await page.close();
  }
  await context.close();
}
await browser.close();
console.log(failures ? `${failures} violation group(s)` : "Accessibility audit passed");
process.exit(failures ? 1 : 0);
