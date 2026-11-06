#!/usr/bin/env node
/**
 * Reports what a first visit costs: bytes per resource type, paint timings and
 * whether the three.js and genlayer-js chunks stay off the critical path.
 *
 *   node scripts/ui/perf.mjs http://localhost:4173
 *
 * Timings come from a software-rendered headless Chromium, so read them as
 * relative figures; the byte counts are exact.
 */
import { chromium } from "playwright";

const base = process.argv[2] ?? "http://localhost:4173";
const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });

async function visit(label, url, settleMs) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await page.addInitScript(() => {
    window.__lcp = 0;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) window.__lcp = entry.startTime;
    }).observe({ type: "largest-contentful-paint", buffered: true });
  });
  await page.goto(url, { waitUntil: "load" });
  await page.waitForTimeout(settleMs);
  const data = await page.evaluate(() => {
    const paint = Object.fromEntries(performance.getEntriesByType("paint").map((p) => [p.name, Math.round(p.startTime)]));
    const resources = performance.getEntriesByType("resource").map((r) => ({
      name: r.name.split("/").pop(),
      type: r.initiatorType,
      bytes: r.encodedBodySize || r.transferSize || 0,
    }));
    return { paint, lcp: Math.round(window.__lcp), resources };
  });
  const sum = (filter) => data.resources.filter(filter).reduce((n, r) => n + r.bytes, 0);
  const row = {
    page: label,
    fcpMs: data.paint["first-contentful-paint"],
    lcpMs: data.lcp,
    jsKB: Math.round(sum((r) => r.name.endsWith(".js")) / 1024),
    cssKB: Math.round(sum((r) => r.name.endsWith(".css")) / 1024),
    fontKB: Math.round(sum((r) => /\.woff2?$/.test(r.name)) / 1024),
    loadedThree: data.resources.some((r) => /^HeroScene/.test(r.name)),
    loadedGenlayer: data.resources.some((r) => /^liveSession/.test(r.name)),
  };
  await context.close();
  return row;
}

const rows = [
  await visit("gate (3D hero)", `${base}/#/?demo=1`, 2500),
  await visit("gate (?lowfx=1)", `${base}/#/?demo=1&lowfx=1`, 1200),
  await visit("play", `${base}/#/play?demo=1`, 1200),
  await visit("vault", `${base}/#/vault?demo=1`, 1200),
];
console.table(rows);
await browser.close();
