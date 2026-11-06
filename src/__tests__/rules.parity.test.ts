import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  COMPONENT_FLOOR,
  DEFAULT_MAX_PAYOUT_BPS,
  DEFAULT_QUEST_TTL,
  HALL_SIZE,
  MAX_ACTION_CHARS,
  MAX_QUEST_TTL,
  MIN_ACTION_CHARS,
  MIN_QUEST_TTL,
  RANK_NAMES,
  RANK_THRESHOLDS,
  RENOWN_ATTEMPT,
  RENOWN_PER_STREAK,
  RENOWN_STREAK_CAP,
  TIERS,
  WEIGHTS,
} from "../lib/rules";

const source = readFileSync(resolve(__dirname, "../../contracts/GenDungeon.py"), "utf8");

function constant(name: string): string {
  const match = source.match(new RegExp(`^${name}\\s*=\\s*(.+)$`, "m"));
  if (!match) throw new Error(`constant ${name} not found in the contract`);
  return match[1].replace(/#.*$/, "").trim();
}

function numbers(name: string): number[] {
  const raw = constant(name).replace(/[()]/g, "");
  return raw.split(",").map((s) => s.trim()).filter(Boolean).map((s) => Number(eval(s.replace(/\*\*/g, "**"))));
}

function strings(name: string): string[] {
  const raw = constant(name);
  return Array.from(raw.matchAll(/"([^"]*)"/g)).map((m) => m[1]);
}

describe("UI rules stay in sync with the contract", () => {
  it("tier tables", () => {
    expect(TIERS.map((t) => t.feeBps)).toEqual(numbers("TIER_FEE_BPS"));
    expect(TIERS.map((t) => t.rewardBps)).toEqual(numbers("TIER_REWARD_BPS"));
    expect(TIERS.map((t) => t.passScore)).toEqual(numbers("TIER_PASS_SCORE"));
    expect(TIERS.map((t) => t.renownWin)).toEqual(numbers("TIER_RENOWN_WIN"));
    expect(TIERS.map((t) => t.name)).toEqual(strings("TIER_NAMES"));
  });

  it("scoring weights and floors", () => {
    expect(WEIGHTS.relevance).toBe(Number(constant("WEIGHT_RELEVANCE")));
    expect(WEIGHTS.plausibility).toBe(Number(constant("WEIGHT_PLAUSIBILITY")));
    expect(WEIGHTS.creativity).toBe(Number(constant("WEIGHT_CREATIVITY")));
    expect(COMPONENT_FLOOR).toBe(Number(constant("COMPONENT_FLOOR")));
  });

  it("limits", () => {
    expect(MIN_ACTION_CHARS).toBe(Number(constant("MIN_ACTION_CHARS")));
    expect(MAX_ACTION_CHARS).toBe(Number(constant("MAX_ACTION_CHARS")));
    expect(DEFAULT_MAX_PAYOUT_BPS).toBe(Number(constant("DEFAULT_MAX_PAYOUT_BPS")));
    expect(DEFAULT_QUEST_TTL).toBe(Number(constant("DEFAULT_QUEST_TTL")));
    expect(MIN_QUEST_TTL).toBe(Number(constant("MIN_QUEST_TTL")));
    expect(MAX_QUEST_TTL).toBe(30 * 86400);
    expect(HALL_SIZE).toBe(Number(constant("HALL_SIZE")));
  });

  it("renown and ranks", () => {
    expect(RENOWN_ATTEMPT).toBe(Number(constant("RENOWN_ATTEMPT")));
    expect(RENOWN_PER_STREAK).toBe(Number(constant("RENOWN_PER_STREAK")));
    expect(RENOWN_STREAK_CAP).toBe(Number(constant("RENOWN_STREAK_CAP")));
    expect([...RANK_THRESHOLDS]).toEqual(numbers("RANK_THRESHOLDS"));
    expect([...RANK_NAMES]).toEqual(strings("RANK_NAMES"));
  });
});
