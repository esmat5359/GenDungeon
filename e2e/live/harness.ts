/**
 * Minimal test harness for the end-to-end run: records every check with its
 * outcome, timing and transaction hashes, and gives the suites a few helpers
 * for the patterns that repeat (expect, expect-rejected, observe).
 */

import type { GameApi } from "../../src/lib/api";
import type { TxOutcome } from "../../src/lib/types";

export type Kind = "functional" | "adversarial" | "economic" | "observation";
export type Outcome = "PASS" | "FAIL" | "SKIP" | "OBSERVED";

export interface CheckRecord {
  id: string;
  kind: Kind;
  title: string;
  outcome: Outcome;
  ms: number;
  note: string;
  txs: Array<{ method: string; hash: string; ok: boolean; status: string; error?: string }>;
}

export class AssertionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AssertionError";
  }
}

export function expect(condition: unknown, message: string): asserts condition {
  if (!condition) throw new AssertionError(message);
}

export function expectEqual<T>(actual: T, wanted: T, what: string): void {
  if (actual !== wanted) throw new AssertionError(`${what}: expected ${String(wanted)}, got ${String(actual)}`);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
export { sleep };

export interface World {
  target: "live" | "demo";
  networkLabel: string;
  address: string;
  /** Hash of the deployment transaction (empty for the simulation). */
  deployTx: string;
  owner: GameApi;
  alice: GameApi;
  bob: GameApi;
  /** Never plays legitimately; used for attacks. */
  carol: GameApi;
  /** Raw JSON of the most recent receipt, for matching revert reasons. */
  lastReceiptText(): string;
  /** Simulation only: move the clock forward. */
  advanceClock?(seconds: number): Promise<void>;
  /** Wait this long in real time (live runs that need the time limit to pass). */
  wallClockWaitAllowed: boolean;
  economy: { entryFee: bigint; minReward: bigint; maxReward: bigint };
  quick: boolean;
  maxAttempts: number;
}

export class Recorder {
  readonly checks: CheckRecord[] = [];
  readonly facts: Record<string, string> = {};
  private current: CheckRecord | null = null;
  private readonly log: (line: string) => void;

  constructor(log: (line: string) => void = (line) => console.log(line)) {
    this.log = log;
  }

  say(line: string) {
    this.log(line);
  }

  /** The id and title of the check currently running, if any (used when a run is interrupted). */
  get running(): string {
    return this.current ? `${this.current.id} ${this.current.title}` : "";
  }

  fact(key: string, value: string) {
    this.facts[key] = value;
  }

  /** Wraps a GameApi so every write it makes is attached to the running check. */
  track(api: GameApi): GameApi {
    const recorder = this;
    return new Proxy(api, {
      get(target, prop, receiver) {
        const value = Reflect.get(target, prop, receiver);
        if (typeof value !== "function") return value;
        return async (...args: unknown[]) => {
          try {
            const result = await (value as (...a: unknown[]) => Promise<unknown>).apply(target, args);
            const maybe = result as Partial<TxOutcome> | undefined;
            if (maybe && typeof maybe === "object" && "hash" in maybe && "ok" in maybe) {
              recorder.current?.txs.push({
                method: String(prop),
                hash: String(maybe.hash),
                ok: Boolean(maybe.ok),
                status: String(maybe.status ?? ""),
                error: maybe.error,
              });
            }
            return result;
          } catch (error) {
            recorder.current?.txs.push({
              method: String(prop),
              hash: "",
              ok: false,
              status: "THREW",
              error: error instanceof Error ? error.message : String(error),
            });
            throw error;
          }
        };
      },
    });
  }

  private async run(
    id: string,
    kind: Kind,
    title: string,
    body: () => Promise<string | void>,
    failureOutcome: Outcome,
  ): Promise<CheckRecord> {
    const record: CheckRecord = { id, kind, title, outcome: "PASS", ms: 0, note: "", txs: [] };
    this.current = record;
    const started = Date.now();
    this.log(`  [${id}] ${title}`);
    try {
      const note = await body();
      record.note = note ?? "";
      if (kind === "observation") record.outcome = "OBSERVED";
    } catch (error) {
      record.outcome = failureOutcome;
      record.note = error instanceof Error ? error.message : String(error);
    }
    record.ms = Date.now() - started;
    this.current = null;
    this.checks.push(record);
    this.log(`      -> ${record.outcome}${record.note ? `: ${record.note.split("\n")[0].slice(0, 160)}` : ""} (${(record.ms / 1000).toFixed(1)}s)`);
    return record;
  }

  check(id: string, kind: Exclude<Kind, "observation">, title: string, body: () => Promise<string | void>) {
    return this.run(id, kind, title, body, "FAIL");
  }

  /** Records what the system did without judging it (LLM-dependent behaviour). */
  observe(id: string, title: string, body: () => Promise<string | void>) {
    return this.run(id, "observation", title, body, "OBSERVED");
  }

  skip(id: string, kind: Kind, title: string, reason: string) {
    this.checks.push({ id, kind, title, outcome: "SKIP", ms: 0, note: reason, txs: [] });
    this.log(`  [${id}] ${title}\n      -> SKIP: ${reason}`);
  }

  get summary() {
    const count = (outcome: Outcome) => this.checks.filter((c) => c.outcome === outcome).length;
    return { total: this.checks.length, pass: count("PASS"), fail: count("FAIL"), skip: count("SKIP"), observed: count("OBSERVED") };
  }
}

export interface RejectionResult {
  reasonVerified: boolean;
  text: string;
}

/** Statuses that mean the network failed to reach a verdict. They are not a contract rejection. */
const NO_VERDICT = new Set(["UNDETERMINED", "CANCELED", "LEADER_TIMEOUT", "VALIDATORS_TIMEOUT"]);

/** How many refusals had their documented reason seen in the receipt (reported at the end of a run). */
export const rejectionStats = { total: 0, verified: 0 };

/**
 * Runs a write that must be refused by the contract.
 *
 * It fails when
 *   - the call is accepted,
 *   - the call throws an error that does not carry the documented reason (a timeout, a network or wallet error is
 *     not a contract rejection and must never be mistaken for one), or
 *   - the network ended without a verdict (UNDETERMINED, a timeout, CANCELED).
 *
 * When the revert text is visible it is matched against `needle`; when the network does not expose it the refusal
 * stands but the result says the reason could not be verified. Callers separately verify that state did not change.
 */
export async function expectRejected(
  world: World,
  run: () => Promise<TxOutcome>,
  needle: string | RegExp,
): Promise<RejectionResult> {
  let outcome: TxOutcome | undefined;
  let thrown = "";
  try {
    outcome = await run();
  } catch (error) {
    thrown = error instanceof Error ? error.message : String(error);
  }
  const matches = (text: string) => (typeof needle === "string" ? text.includes(needle.toLowerCase()) : needle.test(text));

  if (outcome?.ok) throw new AssertionError("the call was accepted but must be rejected");
  if (thrown && !matches(thrown.toLowerCase())) {
    throw new AssertionError(`the call failed without a contract rejection: ${thrown.slice(0, 200)}`);
  }
  if (outcome && NO_VERDICT.has(outcome.status)) {
    throw new AssertionError(`the network reached no verdict on the call (status ${outcome.status})`);
  }
  const text = [outcome?.error ?? "", thrown, world.lastReceiptText()].join(" ").toLowerCase();
  const verified = matches(text);
  rejectionStats.total += 1;
  if (verified) rejectionStats.verified += 1;
  return { reasonVerified: verified, text: text.slice(0, 240) };
}

export function describeRejection(r: RejectionResult): string {
  return r.reasonVerified ? "rejected, reason verified" : "rejected, reason text not exposed by the receipt";
}
