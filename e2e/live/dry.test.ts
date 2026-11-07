/**
 * Self-checks for the end-to-end suites. They run without a network.
 *
 *  1. The suites pass against a correct simulation.
 *  2. The suites FAIL when a specific fault is injected into the simulation.
 *     A suite that cannot fail proves nothing, so each fault below must be
 *     caught by the named check.
 *  3. The report generator labels simulations, blocked runs and failures.
 */

import { describe, expect, it } from "vitest";
import { LiveGame } from "../../src/lib/contract";
import { QuestStatus } from "../../src/lib/types";
import { DemoChain } from "../../src/lib/demo";
import { Recorder, expectRejected, type World } from "./harness";
import { fingerprintEnvironment, renderJson, renderMarkdown, type RunMeta } from "./report";
import { runSuites } from "./suites";
import { ROOT, createDemoWorld } from "./world";

async function play(options: { quick?: boolean } = {}) {
  const rec = new Recorder(() => undefined);
  const world = createDemoWorld({ quick: options.quick ?? false, maxAttempts: 3, log: () => undefined });
  await runSuites(world, rec);
  return rec;
}

const failedIds = (rec: Recorder) => rec.checks.filter((c) => c.outcome === "FAIL").map((c) => c.id);

type Proto = Record<string, (...args: any[]) => any>;

/** Replaces a method for the duration of `body` and always restores it. */
async function withFault(name: string, make: (original: (...a: any[]) => any) => (...a: any[]) => any, body: () => Promise<void>) {
  const proto = DemoChain.prototype as unknown as Proto;
  const original = proto[name];
  proto[name] = make(original);
  try {
    await body();
  } finally {
    proto[name] = original;
  }
}

describe("end-to-end suites against the simulation", () => {
  it("pass on a correct simulation", async () => {
    const rec = await play();
    expect(failedIds(rec)).toEqual([]);
    expect(rec.summary.pass).toBeGreaterThanOrEqual(25);
    expect(rec.checks.some((c) => c.kind === "adversarial")).toBe(true);
    expect(rec.checks.find((c) => c.id === "O01")?.outcome).toBe("OBSERVED");
    // every rejection in the adversarial suites had its reason verified in the simulation
    const unverified = rec.checks.filter((c) => c.kind === "adversarial" && /reason text not exposed/.test(c.note));
    expect(unverified).toEqual([]);
  });

  it("quick mode skips the observation and the long attack list", async () => {
    const rec = await play({ quick: true });
    expect(failedIds(rec)).toEqual([]);
    expect(rec.checks.some((c) => c.id === "O01")).toBe(false);
  });

  it("records the transaction hashes of the writes a check made", async () => {
    const rec = await play({ quick: true });
    const f04 = rec.checks.find((c) => c.id === "F04");
    expect(f04?.txs.length).toBeGreaterThan(0);
    expect(f04?.txs[0].method).toBe("startQuest");
    expect(f04?.txs[0].hash).toMatch(/^0x/);
  });
});

describe("the suites have teeth: injected faults are caught", () => {
  it("missing owner check -> A01", async () => {
    await withFault("requireOwner", () => () => undefined, async () => {
      expect(failedIds(await play({ quick: true }))).toContain("A01");
    });
  });

  it("stranger can answer someone else's quest -> A05", async () => {
    await withFault(
      "submit",
      (orig) =>
        function (this: DemoChain, player: string, questId: number, action: string) {
          const quest = this.quests.get(questId);
          return orig.call(this, quest ? quest.player : player, questId, action);
        },
      async () => {
        expect(failedIds(await play({ quick: true }))).toContain("A05");
      },
    );
  });

  it("stranger can claim someone else's reward -> A05b", async () => {
    await withFault(
      "claim",
      (orig) =>
        function (this: DemoChain, player: string, questId: number) {
          const quest = this.quests.get(questId);
          return orig.call(this, quest ? quest.player : player, questId);
        },
      async () => {
        expect(failedIds(await play({ quick: true }))).toContain("A05b");
      },
    );
  });

  it("zero-value deposits accepted -> A04", async () => {
    await withFault(
      "fund",
      () =>
        function (this: DemoChain, value: bigint) {
          this.rewardPool += value;
          this.deposited += value;
        },
      async () => {
        expect(failedIds(await play({ quick: true }))).toContain("A04");
      },
    );
  });

  it("reward leaves the books out of balance on claim -> F07 and A13", async () => {
    await withFault(
      "claim",
      (orig) =>
        function (this: DemoChain, player: string, questId: number) {
          const paid = orig.call(this, player, questId) as bigint;
          this.paidOut += 1n; // pays one wei that was never reserved
          return paid;
        },
      async () => {
        const failed = failedIds(await play({ quick: true }));
        expect(failed).toContain("F07");
        expect(failed).toContain("A13");
      },
    );
  });

  it("reward off by one wei -> F06", async () => {
    await withFault(
      "resolve",
      (orig) =>
        function (this: DemoChain, questId: number) {
          const result = orig.call(this, questId);
          const quest = this.quests.get(questId);
          if (quest && quest.status === QuestStatus.SUCCESS) {
            quest.reward += 1n;
            this.reserved += 1n;
            this.rewardPool -= 1n;
          }
          return result;
        },
      async () => {
        expect(failedIds(await play({ quick: true }))).toContain("F06");
      },
    );
  });

  it("quests can be expired before the time limit -> A12", async () => {
    await withFault(
      "expire",
      (orig) =>
        function (this: DemoChain, questId: number) {
          this.advance(100_000);
          return orig.call(this, questId);
        },
      async () => {
        expect(failedIds(await play({ quick: true }))).toContain("A12");
      },
    );
  });

  it("pause does not stop new quests -> A10", async () => {
    await withFault(
      "start",
      (orig) =>
        function (this: DemoChain, player: string, tier: number, value: bigint) {
          this.paused = false;
          return orig.call(this, player, tier, value);
        },
      async () => {
        expect(failedIds(await play({ quick: true }))).toContain("A10");
      },
    );
  });

  it("entry fee is not enforced -> A04", async () => {
    await withFault(
      "start",
      (orig) =>
        function (this: DemoChain, player: string, tier: number, value: bigint) {
          return orig.call(this, player, tier, value + 10n ** 18n);
        },
      async () => {
        expect(failedIds(await play({ quick: true }))).toContain("A04");
      },
    );
  });
});

describe("report generator", () => {
  const meta = (patch: Partial<RunMeta>): RunMeta => ({
    target: "demo",
    status: "PASSED",
    network: "in-memory simulation (no network)",
    address: "0x1",
    deployTx: "",
    startedAt: "2026-01-01T00:00:00.000Z",
    finishedAt: "2026-01-01T00:01:00.000Z",
    quick: false,
    maxAttempts: 3,
    ...patch,
  });

  it("labels a simulation as not being on-chain evidence", async () => {
    const rec = await play({ quick: true });
    const md = renderMarkdown(meta({}), fingerprintEnvironment(ROOT), rec, "x.log");
    expect(md).toContain("SIMULATION RUN. This is not on-chain evidence.");
    expect(md).toContain("| F01 |");
    expect(md).toMatch(/Contract SHA-256 \| [0-9a-f]{64}/);
    const json = JSON.parse(renderJson(meta({}), fingerprintEnvironment(ROOT), rec));
    expect(json.summary.fail).toBe(0);
    expect(json.checks.length).toBe(rec.checks.length);
  });

  it("states that a blocked run executed nothing", () => {
    const rec = new Recorder(() => undefined);
    const md = renderMarkdown(
      meta({ target: "live", status: "BLOCKED", reason: "The RPC endpoint could not be reached." }),
      fingerprintEnvironment(ROOT),
      rec,
      "x.log",
    );
    expect(md).toContain("BLOCKED. No checks were executed.");
    expect(md).toContain("Nothing in this file is evidence about the contract.");
    expect(md).not.toContain("## Results");
  });

  it("lists failures prominently", async () => {
    await withFault("requireOwner", () => () => undefined, async () => {
      const rec = await play({ quick: true });
      const md = renderMarkdown(meta({ status: "FAILED" }), fingerprintEnvironment(ROOT), rec, "x.log");
      expect(md).toContain("## Failures");
      expect(md).toContain("**FAIL**");
    });
  });
});

describe("a refusal only counts when the contract refused", () => {
  const world = { lastReceiptText: () => "" } as unknown as World;
  const outcome = (patch: Record<string, unknown>) => async () => ({ hash: "0x1", status: "ACCEPTED", ok: false, ...patch }) as never;

  it("accepts a contract revert and records whether its reason was seen", async () => {
    const seen = await expectRejected(world, outcome({ error: "Quest is not awaiting an action" }), "not awaiting an action");
    expect(seen.reasonVerified).toBe(true);
    const unseen = await expectRejected(world, outcome({ error: "The transaction failed on-chain." }), "not awaiting an action");
    expect(unseen.reasonVerified).toBe(false);
  });

  it("rejects a call that was accepted", async () => {
    await expect(expectRejected(world, outcome({ ok: true }), "x")).rejects.toThrow(/accepted/);
  });

  it("does not mistake a timeout or network error for a contract rejection", async () => {
    const boom = async () => {
      throw new Error("Timed out waiting for the transaction receipt");
    };
    await expect(expectRejected(world, boom, "not awaiting an action")).rejects.toThrow(/without a contract rejection/);
  });

  it("does not mistake a consensus failure for a contract rejection", async () => {
    for (const status of ["UNDETERMINED", "LEADER_TIMEOUT", "VALIDATORS_TIMEOUT", "CANCELED"]) {
      await expect(expectRejected(world, outcome({ status }), "x")).rejects.toThrow(/no verdict/);
    }
  });
});

describe("expectRejected on Studio-shaped receipts", () => {
  const address = "0x0000000000000000000000000000000000000001" as const;
  const world = { lastReceiptText: () => "" } as unknown as World;
  const receipt = (leader: Record<string, unknown>) => ({
    statusName: "ACCEPTED",
    consensus_data: { leader_receipt: [leader] },
  });
  const gameWith = (r: unknown) =>
    new LiveGame(address, {} as any, { writeContract: async () => "0xabc", waitForTransactionReceipt: async () => r } as any, "0xme", {
      pollMs: 1,
      timeoutMs: 10,
    });

  it("accepts a call the contract reverted, and reads the reason from the receipt", async () => {
    const game = gameWith(receipt({ execution_result: "ERROR", result: { status: "rollback", payload: "Only the owner can do this" } }));
    const result = await expectRejected(world, () => game.setPaused(true), "only the owner");
    expect(result.reasonVerified).toBe(true);
  });

  it("still fails a call the contract executed", async () => {
    const game = gameWith(receipt({ execution_result: "SUCCESS", result: { status: "return", payload: null } }));
    await expect(expectRejected(world, () => game.setPaused(true), "only the owner")).rejects.toThrow(/accepted but must be rejected/);
  });
});
