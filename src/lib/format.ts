/**
 * Formatting and decoding helpers. GenVM returns sized integers across the
 * calldata boundary as `number`, `string` or `bigint` depending on the SDK
 * path, so every decoder accepts all three.
 */

const WEI_PER_GEN = 1_000_000_000_000_000_000n;

export function toBigInt(value: unknown): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isFinite(value)) return BigInt(Math.trunc(value));
  if (typeof value === "string" && value.trim().length > 0) {
    try {
      return BigInt(value.trim());
    } catch {
      return 0n;
    }
  }
  return 0n;
}

export function toNumber(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

export function toText(value: unknown, fallback = ""): string {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return fallback;
  return String(value);
}

export function toBool(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value.toLowerCase() === "true";
  if (typeof value === "number" || typeof value === "bigint") return Number(value) !== 0;
  return false;
}

export function weiToGen(value: unknown, fractionDigits = 4): string {
  const wei = toBigInt(value);
  const whole = wei / WEI_PER_GEN;
  const remainder = wei % WEI_PER_GEN;
  if (fractionDigits <= 0) return whole.toString();
  const fraction = remainder.toString().padStart(18, "0").slice(0, fractionDigits);
  const trimmed = fraction.replace(/0+$/, "");
  return trimmed.length > 0 ? `${whole}.${trimmed}` : whole.toString();
}

export function genToWei(value: string | number): bigint {
  const raw = String(value).trim();
  if (!/^-?\d*(\.\d*)?$/.test(raw) || raw === "" || raw === "-" || raw === ".") {
    throw new Error("Enter a number such as 0.5");
  }
  const negative = raw.startsWith("-");
  const unsigned = negative ? raw.slice(1) : raw;
  const [wholeRaw, fracRaw = ""] = unsigned.split(".");
  const whole = wholeRaw.length > 0 ? BigInt(wholeRaw) : 0n;
  const frac = (fracRaw + "0".repeat(18)).slice(0, 18);
  const magnitude = whole * WEI_PER_GEN + BigInt(frac || "0");
  return negative ? -magnitude : magnitude;
}

export function shortAddress(address?: string | null): string {
  if (!address) return "none";
  if (address.length <= 12) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function sameAddress(a?: string | null, b?: string | null): boolean {
  return !!a && !!b && a.toLowerCase() === b.toLowerCase();
}

/** Basis points as a percentage string, e.g. 5000 -> "50%". */
export function bpsToPercent(bps: number): string {
  const pct = bps / 100;
  return `${Number.isInteger(pct) ? pct : pct.toFixed(2)}%`;
}

export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
  if (seconds < 86_400) {
    const hours = seconds / 3600;
    return `${Number.isInteger(hours) ? hours : hours.toFixed(1)} h`;
  }
  const days = seconds / 86_400;
  return `${Number.isInteger(days) ? days : days.toFixed(1)} d`;
}

export function timeAgo(epochSeconds: number, nowMs = Date.now()): string {
  if (!epochSeconds) return "unknown";
  const diff = Math.max(0, Math.floor(nowMs / 1000) - epochSeconds);
  if (diff < 45) return "just now";
  if (diff < 3600) return `${Math.round(diff / 60)} min ago`;
  if (diff < 86_400) return `${Math.round(diff / 3600)} h ago`;
  return `${Math.round(diff / 86_400)} d ago`;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** JSON.stringify that survives bigint and Map values (used for diagnostics). */
export function safeStringify(value: unknown): string {
  return JSON.stringify(
    value,
    (_key, v) => {
      if (typeof v === "bigint") return v.toString();
      if (v instanceof Map) return Object.fromEntries(v);
      return v;
    },
    2,
  );
}
