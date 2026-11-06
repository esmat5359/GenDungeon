/**
 * Runtime configuration. The same module is imported by the browser app
 * (Vite) and by the Node scripts (tsx), so every lookup is guarded.
 */

/** The v1 deployment that shipped with the first release (read-only legacy). */
export const LEGACY_V1_ADDRESS = "0xc49d63f60e651700777fA35d0F0aF05AF5AeA928";

export function readEnv(key: string): string | undefined {
  try {
    const viteEnv = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
    const fromVite = viteEnv?.[key];
    if (fromVite) return fromVite;
  } catch {
    /* not running under Vite */
  }
  try {
    if (typeof process !== "undefined" && process.env?.[key]) return process.env[key];
  } catch {
    /* no process object in the browser */
  }
  return undefined;
}

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

export function isAddress(value: unknown): value is `0x${string}` {
  return typeof value === "string" && ADDRESS_RE.test(value);
}

function queryParam(name: string): string | null {
  try {
    if (typeof window === "undefined") return null;
    // Works for both the hash router (#/play?x=1) and a plain query string.
    const direct = new URLSearchParams(window.location.search).get(name);
    if (direct !== null) return direct;
    const hash = window.location.hash;
    const at = hash.indexOf("?");
    return at >= 0 ? new URLSearchParams(hash.slice(at + 1)).get(name) : null;
  } catch {
    return null;
  }
}

export type AppMode = "live" | "demo";

export interface AppConfig {
  mode: AppMode;
  /** Present only in live mode. */
  address: `0x${string}` | null;
  /** Why the app picked this mode (shown in the UI). */
  reason: string;
}

/**
 * Picks live or demo mode.
 *   ?demo=1                   always demo
 *   ?contract=0x...           live, against that contract
 *   VITE_CONTRACT_ADDRESS     live, against the configured deployment
 *   (nothing configured)      demo
 */
export function resolveConfig(): AppConfig {
  if (queryParam("demo") === "1") {
    return { mode: "demo", address: null, reason: "Demo requested with ?demo=1" };
  }
  const fromQuery = queryParam("contract");
  if (isAddress(fromQuery)) {
    return { mode: "live", address: fromQuery, reason: "Contract chosen with ?contract=" };
  }
  const fromEnv = readEnv("VITE_CONTRACT_ADDRESS") ?? readEnv("GENDUNGEON_ADDRESS");
  if (isAddress(fromEnv)) {
    return { mode: "live", address: fromEnv, reason: "Contract from VITE_CONTRACT_ADDRESS" };
  }
  return {
    mode: "demo",
    address: null,
    reason: "No contract address is configured, so the app runs against a local simulation",
  };
}
