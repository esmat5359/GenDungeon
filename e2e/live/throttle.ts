/**
 * Keeps the end-to-end run under the request limit of the public RPC endpoint.
 *
 * Studio answers at most 30 requests a minute per client and replies with a JSON-RPC error ("Rate limit exceeded")
 * beyond that. genlayer-js calls the global `fetch` for every RPC request, so wrapping it here covers all four
 * accounts at once. Two layers:
 *
 *   1. a sliding window that spaces requests so the limit is not reached in the first place, and
 *   2. a retry with a growing pause for the rare answer that still says "rate limit" (or HTTP 429).
 *
 * A third kind of answer is retried as well: a gateway hiccup. When the proxy in front of Studio drops out for a
 * moment it replies with HTTP 502/503/504 or with an HTML error page instead of JSON-RPC, which genlayer-js reports as
 * `Unexpected token '<', "<!DOCTYPE "... is not valid JSON`. That says nothing about the request, so it is repeated
 * after a few seconds instead of failing the check that happened to be running.
 */

export interface ThrottleOptions {
  /** Requests allowed per window (default 24, below the documented 30). */
  perWindow?: number;
  windowMs?: number;
  /** How often a rate-limited or gateway-failed request is retried before the answer is passed on. */
  maxRetries?: number;
  /** First pause after a rate-limited answer; it doubles per retry up to a minute (default 5000). */
  pauseMs?: number;
  /** First pause after a gateway error (502/503/504 or an HTML page); it doubles per retry up to 30 seconds (default 3000). */
  gatewayPauseMs?: number;
  /** Only requests to these URLs are limited. */
  urls: string[];
  log?: (line: string) => void;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export class SlidingWindow {
  private readonly stamps: number[] = [];
  private chain: Promise<void> = Promise.resolve();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
    private readonly wait: (ms: number) => Promise<void> = sleep,
  ) {}

  /** Resolves when a request may be sent; callers are served in order. */
  acquire(): Promise<void> {
    const turn = this.chain.then(async () => {
      for (;;) {
        const t = this.now();
        while (this.stamps.length && t - this.stamps[0] >= this.windowMs) this.stamps.shift();
        if (this.stamps.length < this.limit) {
          this.stamps.push(t);
          return;
        }
        await this.wait(this.stamps[0] + this.windowMs - t + 25);
      }
    });
    this.chain = turn.catch(() => undefined);
    return turn;
  }

  /** Called after the server said "slow down": treat the whole window as used. */
  saturate(): void {
    const t = this.now();
    while (this.stamps.length < this.limit) this.stamps.push(t);
  }
}

/** An error answer is small; a large body (contract code, a receipt) that happens to contain the words is not one. */
export function looksRateLimited(status: number, body: string): boolean {
  if (status === 429) return true;
  return body.length < 2_000 && /"error"/.test(body) && /rate limit|too many requests/i.test(body);
}

/**
 * True for an answer that came from a struggling gateway rather than from the node: HTTP 502/503/504, or a body that is
 * an HTML page (`<!DOCTYPE ...`, `<html ...`) where JSON-RPC was expected. A JSON-RPC answer always starts with `{` or `[`,
 * so a real result is never mistaken for one.
 */
export function looksGatewayError(status: number, body: string): boolean {
  if (status === 502 || status === 503 || status === 504) return true;
  return /^\s*<(?:!doctype|html)\b/i.test(body);
}

/** Installs the wrapper on `globalThis.fetch`; returns a function that restores the original. */
export function installRpcThrottle(options: ThrottleOptions): () => void {
  const original = globalThis.fetch;
  const window = new SlidingWindow(options.perWindow ?? 24, options.windowMs ?? 60_000);
  const maxRetries = options.maxRetries ?? 6;
  const limited = (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    return options.urls.includes(url);
  };

  const wrapped: typeof fetch = async (input, init) => {
    if (!limited(input)) return original(input, init);
    for (let attempt = 0; ; attempt++) {
      await window.acquire();
      const response = await original(input, init);
      const text = await response.clone().text().catch(() => "");
      const rateLimited = looksRateLimited(response.status, text);
      const gateway = !rateLimited && looksGatewayError(response.status, text);
      if ((!rateLimited && !gateway) || attempt >= maxRetries) return response;
      let pause: number;
      if (rateLimited) {
        window.saturate();
        pause = Math.min(60_000, (options.pauseMs ?? 5_000) * 2 ** attempt);
        options.log?.(`  the RPC endpoint asked to slow down; waiting ${Math.round(pause / 1000)}s (retry ${attempt + 1}/${maxRetries})`);
      } else {
        pause = Math.min(30_000, (options.gatewayPauseMs ?? 3_000) * 2 ** attempt);
        options.log?.(`  the RPC gateway answered with ${response.status >= 500 ? `HTTP ${response.status}` : "an HTML page"}; waiting ${Math.round(pause / 1000)}s (retry ${attempt + 1}/${maxRetries})`);
      }
      await sleep(pause);
    }
  };
  globalThis.fetch = wrapped;
  return () => {
    globalThis.fetch = original;
  };
}
