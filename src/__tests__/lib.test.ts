import { describe, expect, it, vi } from "vitest";
import { genToWei, weiToGen, toBigInt, toBool, shortAddress, bpsToPercent, formatDuration, safeStringify } from "../lib/format";
import { field, normalizeConfig, normalizeQuest, normalizeStats, asList } from "../lib/normalize";
import { LiveGame, extractRevertReason, isGatewayHiccup, isPayloadRejected, isQuorumCancellation, isRateLimited, receiptFailed } from "../lib/contract";
import { isSuccess, overallScore, rewardFor, rankIndex, nextRankAt, rankProgress, localActionProblem } from "../lib/rules";
import { isAddress, resolveConfig } from "../lib/env";

describe("format", () => {
  it("round-trips GEN amounts", () => {
    for (const v of ["0", "1", "0.5", "12.345678", "0.000000000000000001"]) {
      expect(weiToGen(genToWei(v), 18)).toBe(v);
    }
  });
  it("rejects garbage input", () => {
    for (const v of ["", "abc", "1.2.3", "-", ".", "1e5"]) expect(() => genToWei(v)).toThrow();
  });
  it("decodes loose calldata scalars", () => {
    expect(toBigInt("42")).toBe(42n);
    expect(toBigInt(7)).toBe(7n);
    expect(toBigInt("nope")).toBe(0n);
    expect(toBigInt(Number.NaN)).toBe(0n);
    expect(toBool("true")).toBe(true);
    expect(toBool("false")).toBe(false);
    expect(toBool(0)).toBe(false);
  });
  it("formats addresses, bps and durations", () => {
    expect(shortAddress("0x1234567890abcdef1234567890abcdef12345678")).toBe("0x1234…5678");
    expect(shortAddress("")).toBe("none");
    expect(bpsToPercent(5000)).toBe("50%");
    expect(bpsToPercent(1250)).toBe("12.50%");
    expect(formatDuration(86_400)).toBe("1 d");
    expect(formatDuration(5400)).toBe("1.5 h");
  });
  it("serialises bigint and Map safely", () => {
    expect(JSON.parse(safeStringify({ a: 1n, b: new Map([["k", 2n]]) }))).toEqual({ a: "1", b: { k: "2" } });
  });
});

describe("normalizers", () => {
  it("accept plain objects, Maps and camelCase keys", () => {
    const base = { entry_fee: "100", min_reward: 5, max_reward: 9n, reward_pool: "1000", paused: "false", version: "2.0.0" };
    expect(normalizeConfig(base).entryFee).toBe(100n);
    expect(normalizeConfig(new Map(Object.entries(base))).maxReward).toBe(9n);
    expect(normalizeConfig({ entryFee: 3 }).entryFee).toBe(3n);
    expect(normalizeConfig(base).paused).toBe(false);
    expect(normalizeConfig(null).version).toBe("unknown");
  });
  it("fills status labels when the contract omits them", () => {
    expect(normalizeQuest({ status: 2 }).statusLabel).toBe("Victory");
    expect(normalizeQuest({ status: 99 }).statusLabel).toBe("Unknown");
  });
  it("decodes player stats with defaults", () => {
    const s = normalizeStats({ renown: "150", rank_label: "Squire" });
    expect(s.renown).toBe(150);
    expect(s.rankLabel).toBe("Squire");
    expect(s.winStreak).toBe(0);
  });
  it("reads fields and lists defensively", () => {
    expect(field(undefined, "x")).toBeUndefined();
    expect(asList(new Map([[1, "a"]]))).toEqual(["a"]);
    expect(asList("nope")).toEqual([]);
  });
});

describe("receipt helpers", () => {
  it("finds the revert reason inside nested receipts", () => {
    const receipt = { consensus_data: { leader_receipt: [{ error: "Only the owner can do this", result: "rollback" }] } };
    expect(extractRevertReason(receipt)).toBe("Only the owner can do this");
    expect(extractRevertReason({})).toBe("The transaction failed on-chain.");
  });
  it("flags failed receipts", () => {
    expect(receiptFailed({ statusName: "ACCEPTED", txExecutionResultName: "FINISHED_WITH_RETURN" })).toBe(false);
    expect(receiptFailed({ statusName: "ACCEPTED", txExecutionResultName: "FINISHED_WITH_ERROR" })).toBe(true);
    expect(receiptFailed({ statusName: "UNDETERMINED" })).toBe(true);
    expect(receiptFailed(undefined)).toBe(true);
  });
});

/** The shape of a Studio receipt after genlayer-js has simplified it (see decodeLocalnetTransaction). */
function studioReceipt(leader: Record<string, unknown>, statusName = "ACCEPTED") {
  return { statusName, status_name: statusName, consensus_data: { leader_receipt: [leader], votes: {} } };
}

describe("Studio receipts", () => {
  it("treats a reverted call as failed even though consensus accepted it", () => {
    const reverted = studioReceipt({
      execution_result: "ERROR",
      result: { status: "rollback", payload: "Only the owner can do this" },
    });
    expect(receiptFailed(reverted)).toBe(true);
    expect(extractRevertReason(reverted)).toBe("Only the owner can do this");
  });
  it("recognises each failure marker on its own", () => {
    expect(receiptFailed(studioReceipt({ execution_result: "ERROR" }))).toBe(true);
    expect(receiptFailed(studioReceipt({ result: { status: "rollback", payload: "x" } }))).toBe(true);
    expect(receiptFailed(studioReceipt({ result: { status: "contract_error", payload: "x" } }))).toBe(true);
    expect(receiptFailed(studioReceipt({ genvm_result: { status: "error" } }))).toBe(true);
  });
  it("does not flag a successful call", () => {
    expect(receiptFailed(studioReceipt({ execution_result: "SUCCESS", result: { status: "return", payload: null } }))).toBe(false);
    expect(receiptFailed(studioReceipt({ execution_result: "SUCCESS" }))).toBe(false);
  });
  it("describes a failure that carries no readable reason", () => {
    const text = extractRevertReason({
      statusName: "ACCEPTED",
      consensus_data: { leader_receipt: [{ execution_result: "ERROR", result: { status: "contract_error" } }], votes: { a: "agree", b: "disagree", c: "agree" } },
    });
    expect(text).toContain("leader ERROR/contract_error");
    expect(text).toContain('"agree":2');
  });
  it("reads the camelCase spelling too", () => {
    expect(receiptFailed({ status: "ACCEPTED", consensusData: { leaderReceipt: { executionResult: "ERROR" } } })).toBe(true);
  });
});

/** Leader-receipt entries as seen in tx 0x4b6c600bed: the leader succeeded, a second validator was cancelled after quorum. */
const QUORUM_CANCELLED = {
  execution_result: "ERROR",
  genvm_result: {
    stderr: "Validator execution cancelled after quorum",
    stdout: "",
    raw_error: { fatal: false, causes: ["VALIDATOR_QUORUM_REACHED"] },
    error_code: "CONSENSUS_VALIDATOR_QUORUM_REACHED",
  },
  vote: "idle",
};
const LEADER_OK = { execution_result: "SUCCESS", genvm_result: { stderr: "", stdout: "", raw_error: null, error_code: null }, vote: null };

describe("validators cancelled after a quorum", () => {
  const accepted = (...leaders: unknown[]) => ({
    statusName: "ACCEPTED",
    consensus_data: { leader_receipt: leaders, votes: { a: "agree", b: "disagree", c: "agree", d: "agree" } },
  });

  it("does not fail a call that succeeded and then had a validator cancelled", () => {
    expect(receiptFailed(accepted(LEADER_OK, QUORUM_CANCELLED))).toBe(false);
    expect(receiptFailed(accepted(QUORUM_CANCELLED, LEADER_OK))).toBe(false);
  });
  it("recognises the cancellation by code, by text or by a non-fatal quorum cause", () => {
    const byCode = { execution_result: "ERROR", genvm_result: { error_code: "CONSENSUS_VALIDATOR_QUORUM_REACHED" } };
    const byText = { execution_result: "ERROR", genvm_result: { stderr: "Validator execution cancelled after quorum" } };
    const byCause = { execution_result: "ERROR", genvm_result: { raw_error: { fatal: false, causes: ["VALIDATOR_QUORUM_REACHED"] } } };
    for (const entry of [byCode, byText, byCause]) {
      expect(isQuorumCancellation(entry)).toBe(true);
      expect(receiptFailed(accepted(LEADER_OK, entry))).toBe(false);
    }
  });
  it("still fails a real contract error, even a non-fatal one", () => {
    const nonFatal = { execution_result: "ERROR", genvm_result: { stderr: "ValueError: boom", raw_error: { fatal: false, causes: ["VM_ERROR"] } } };
    expect(isQuorumCancellation(nonFatal)).toBe(false);
    expect(receiptFailed(accepted(nonFatal))).toBe(true);
    expect(receiptFailed(accepted(LEADER_OK, nonFatal))).toBe(true);
    expect(receiptFailed(accepted(QUORUM_CANCELLED, { execution_result: "ERROR", result: { status: "rollback", payload: "x" } }))).toBe(true);
  });
  it("still fails on a bad consensus status or a FINISHED_WITH_ERROR receipt", () => {
    expect(receiptFailed({ ...accepted(LEADER_OK, QUORUM_CANCELLED), statusName: "UNDETERMINED" })).toBe(true);
    expect(receiptFailed({ ...accepted(LEADER_OK, QUORUM_CANCELLED), txExecutionResultName: "FINISHED_WITH_ERROR" })).toBe(true);
  });
  it("never reports the cancellation as the revert reason", () => {
    const real = { execution_result: "ERROR", result: { status: "rollback", payload: "Only the owner can do this" } };
    expect(extractRevertReason(accepted(QUORUM_CANCELLED, real))).toBe("Only the owner can do this");
    expect(extractRevertReason(accepted(real, QUORUM_CANCELLED))).toBe("Only the owner can do this");
    expect(extractRevertReason(accepted(QUORUM_CANCELLED))).not.toMatch(/cancell?ed after quorum/i);
    expect(extractRevertReason(accepted(QUORUM_CANCELLED))).toBe('The transaction failed on-chain (votes {"agree":3,"disagree":1}).');
  });
});

describe("error classes", () => {
  it("separates a rate limit from an undecodable payload", () => {
    expect(isRateLimited(new Error("An unknown RPC error occurred. Details: Rate limit exceeded: 30 requests per minute"))).toBe(true);
    expect(isRateLimited(new Error("HTTP 429"))).toBe(true);
    expect(isRateLimited(new Error("RLP string ends with 383 superfluous bytes"))).toBe(false);
    expect(isPayloadRejected(new Error("An internal error was received. Details: RLP string ends with 383 superfluous bytes"))).toBe(true);
    expect(isPayloadRejected(new Error("Rate limit exceeded"))).toBe(false);
  });
  it("recognises a gateway hiccup and nothing else", () => {
    expect(isGatewayHiccup(new Error('GenLayer RPC error (eth_gasPrice): Unexpected token \'<\', "<!DOCTYPE "... is not valid JSON'))).toBe(true);
    expect(isGatewayHiccup(new Error("<html><head><title>502 Bad Gateway</title></head>"))).toBe(true);
    expect(isGatewayHiccup(new Error("HTTP 503"))).toBe(true);
    expect(isGatewayHiccup(new Error("HTTP request failed. Status: 504"))).toBe(true);
    expect(isGatewayHiccup(new Error("Service Unavailable"))).toBe(true);
    expect(isGatewayHiccup("504 Gateway Timeout")).toBe(true);
    expect(isGatewayHiccup(new Error("Rate limit exceeded"))).toBe(false);
    expect(isGatewayHiccup(new Error("Only the owner can do this"))).toBe(false);
    expect(isGatewayHiccup(new Error("RLP string ends with 502 superfluous bytes"))).toBe(false);
  });
});

describe("LiveGame against a fake node", () => {
  const address = "0x0000000000000000000000000000000000000001" as const;
  const failedReceipt = studioReceipt({ execution_result: "ERROR", result: { status: "rollback", payload: "Quest is not awaiting resolution" } });

  it("reports a reverted write as not ok, with the contract's reason", async () => {
    const writer = {
      writeContract: async () => "0xabc",
      waitForTransactionReceipt: async () => failedReceipt,
    };
    const game = new LiveGame(address, {} as any, writer as any, "0xme", { pollMs: 1, timeoutMs: 10 });
    const outcome = await game.resolveQuest(1);
    expect(outcome.ok).toBe(false);
    expect(outcome.status).toBe("ACCEPTED");
    expect(outcome.error).toBe("Quest is not awaiting resolution");
  });

  it("falls back to the local length rules when the node cannot decode a long read", async () => {
    const reader = {
      readContract: async () => {
        throw new Error("An internal error was received. Details: RLP string ends with 383 superfluous bytes");
      },
    };
    let calls = 0;
    const counting = { readContract: async (a: unknown) => (calls++, reader.readContract()) };
    const game = new LiveGame(address, counting as any, null, "", { pollMs: 1 });
    expect(await game.validateAction("x".repeat(1001))).toBe("too_long");
    expect(game.lastValidationSource).toBe("local");
    expect(calls).toBe(1); // an undecodable payload is not retried
  });

  it("retries a rate-limited read instead of failing at once", async () => {
    vi.useFakeTimers();
    try {
      let calls = 0;
      const reader = {
        readContract: async () => {
          if (++calls < 3) throw new Error("Rate limit exceeded: 30 requests per minute");
          return "";
        },
      };
      const game = new LiveGame(address, reader as any, null, "", { pollMs: 1 });
      const pending = game.validateAction("a perfectly fine action");
      await vi.advanceTimersByTimeAsync(60_000);
      expect(await pending).toBe("");
      expect(calls).toBe(3);
      expect(game.lastValidationSource).toBe("chain");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("rules", () => {
  it("scores and judges like the contract", () => {
    expect(overallScore(90, 85, 80)).toBe(85);
    expect(overallScore(0, 0, 0)).toBe(0);
    expect(isSuccess(0, 40, 40, 40, false)).toBe(true);
    expect(isSuccess(0, 39, 90, 90, false)).toBe(false); // component floor
    expect(isSuccess(2, 90, 90, 90, true)).toBe(false); // tampering
    expect(isSuccess(2, 70, 70, 70, false)).toBe(true); // inclusive pass mark
    expect(isSuccess(2, 69, 70, 70, false)).toBe(false);
  });
  it("caps rewards by the pool and the payout share", () => {
    expect(rewardFor(0, 100, 20n, 100n, 10_000n, 10_000)).toBe(100n);
    expect(rewardFor(0, 100, 20n, 100n, 50n, 10_000)).toBe(50n);
    expect(rewardFor(0, 100, 20n, 100n, 1000n, 2500)).toBe(100n);
    expect(rewardFor(2, 100, 20n, 100n, 1000n, 1000)).toBe(100n);
    expect(rewardFor(0, 50, 100n, 20n, 1000n, 10_000)).toBe(100n); // inverted bounds never underflow
    expect(rewardFor(0, 50, 20n, 100n, 0n, 10_000)).toBe(0n);
  });
  it("derives ranks", () => {
    expect(rankIndex(0)).toBe(0);
    expect(rankIndex(100)).toBe(1);
    expect(rankIndex(99)).toBe(0);
    expect(nextRankAt(3000)).toBe(0);
    expect(rankProgress(50)).toBeCloseTo(0.5);
    expect(rankProgress(5000)).toBe(1);
  });
  it("checks action length locally", () => {
    expect(localActionProblem("")).toBe("empty");
    expect(localActionProblem("tiny")).toBe("too_short");
    expect(localActionProblem("x".repeat(1001))).toBe("too_long");
    expect(localActionProblem("a perfectly fine action")).toBe("");
  });
});

describe("env", () => {
  it("validates addresses", () => {
    expect(isAddress("0xc49d63f60e651700777fA35d0F0aF05AF5AeA928")).toBe(true);
    expect(isAddress("0x123")).toBe(false);
    expect(isAddress(null)).toBe(false);
  });
  it("falls back to demo mode when nothing is configured", () => {
    const saved = process.env.VITE_CONTRACT_ADDRESS;
    delete process.env.VITE_CONTRACT_ADDRESS;
    delete process.env.GENDUNGEON_ADDRESS;
    expect(resolveConfig().mode).toBe("demo");
    process.env.VITE_CONTRACT_ADDRESS = "0xc49d63f60e651700777fA35d0F0aF05AF5AeA928";
    expect(resolveConfig().mode).toBe("live");
    process.env.VITE_CONTRACT_ADDRESS = "not-an-address";
    expect(resolveConfig().mode).toBe("demo");
    if (saved) process.env.VITE_CONTRACT_ADDRESS = saved;
    else delete process.env.VITE_CONTRACT_ADDRESS;
  });
});
