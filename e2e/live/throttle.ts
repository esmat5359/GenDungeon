/**
 * Keeps the end-to-end run under the request limit of the public RPC endpoint.
 *
 * Studio answers at most 30 requests a minute per client and replies with a JSON-RPC error ("Rate limit exceeded")
 * beyond that. genlayer-js calls the global `fetch` for every RPC request, so wrapping it here covers all four
 * accounts at once. Two layers:
 *
 *   1. a sliding window that spaces requests so the limit is not reached in the first place, and
 *   2. a retry with a growing pause for the rare answer that still says "rate limit" (or HTTP 429).
 */

export interface ThrottleOptions {
  /** Requests allowed per window (default 24, below the documented 30). */
  perWindow?: number;
  windowMs?: number;
  /** How often a rate-limited request is retried before the error is passed on. */
  maxRetries?: number;
  /** First pause after a rate-limited answer; it doubles per retry up to a minute (default 5000). */
  pauseMs?: number;
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
      if (!looksRateLimited(response.status, text) || attempt >= maxRetries) return response;
      window.saturate();
      const pause = Math.min(60_000, (options.pauseMs ?? 5_000) * 2 ** attempt);
      options.log?.(`  the RPC endpoint asked to slow down; waiting ${Math.round(pause / 1000)}s (retry ${attempt + 1}/${maxRetries})`);
      await sleep(pause);
    }
  };
  globalThis.fetch = wrapped;
  return () => {
    globalThis.fetch = original;
  };
}
