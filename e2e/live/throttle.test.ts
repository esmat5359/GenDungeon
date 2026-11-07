import { afterEach, describe, expect, it } from "vitest";
import { SlidingWindow, installRpcThrottle, looksRateLimited } from "./throttle";

describe("SlidingWindow", () => {
  it("never lets more than `limit` requests start inside one window", async () => {
    let clock = 0;
    const started: number[] = [];
    const window = new SlidingWindow(3, 1000, () => clock, async (ms) => void (clock += ms));
    for (let i = 0; i < 10; i++) {
      await window.acquire();
      started.push(clock);
    }
    for (let i = 3; i < started.length; i++) expect(started[i] - started[i - 3]).toBeGreaterThanOrEqual(1000);
    expect(started.slice(0, 3)).toEqual([0, 0, 0]);
  });

  it("serves concurrent callers in order", async () => {
    let clock = 0;
    const order: number[] = [];
    const window = new SlidingWindow(1, 100, () => clock, async (ms) => void (clock += ms));
    await Promise.all([1, 2, 3, 4].map((n) => window.acquire().then(() => order.push(n))));
    expect(order).toEqual([1, 2, 3, 4]);
  });

  it("saturate() makes the next request wait for the window", async () => {
    let clock = 0;
    const window = new SlidingWindow(5, 1000, () => clock, async (ms) => void (clock += ms));
    await window.acquire();
    window.saturate();
    await window.acquire();
    expect(clock).toBeGreaterThanOrEqual(1000);
  });
});

describe("looksRateLimited", () => {
  it("matches the Studio message and HTTP 429", () => {
    expect(looksRateLimited(200, '{"error":{"message":"Rate limit exceeded: 30 requests per minute"}}')).toBe(true);
    expect(looksRateLimited(429, "")).toBe(true);
    expect(looksRateLimited(200, '{"result":"0x1"}')).toBe(false);
    expect(looksRateLimited(200, JSON.stringify({ result: "# rate limit docs ".repeat(300) }))).toBe(false);
  });
});

describe("installRpcThrottle", () => {
  const original = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = original;
  });

  it("retries a rate-limited answer and leaves other URLs alone", async () => {
    const url = "https://rpc.test/";
    let rpcCalls = 0;
    let otherCalls = 0;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      if (String(input) === url) {
        rpcCalls++;
        const body = rpcCalls < 3 ? { error: { message: "Rate limit exceeded: 30 requests per minute" } } : { result: "0x1" };
        return new Response(JSON.stringify(body), { status: 200 });
      }
      otherCalls++;
      return new Response("{}", { status: 200 });
    }) as typeof fetch;

    const restore = installRpcThrottle({ urls: [url], perWindow: 100, windowMs: 20, maxRetries: 5, pauseMs: 1 });
    const response = await fetch(url, { method: "POST" });
    expect(await response.json()).toEqual({ result: "0x1" });
    expect(rpcCalls).toBe(3);

    await fetch("https://elsewhere.test/");
    expect(otherCalls).toBe(1);
    restore();
  });

  it("gives up after maxRetries and returns the last answer", async () => {
    const url = "https://rpc.test/";
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      return new Response(JSON.stringify({ error: { message: "Rate limit exceeded" } }), { status: 200 });
    }) as typeof fetch;
    installRpcThrottle({ urls: [url], perWindow: 100, windowMs: 20, maxRetries: 2, pauseMs: 1 });
    expect(await (await fetch(url)).text()).toContain("Rate limit");
    expect(calls).toBe(3);
  });
});
