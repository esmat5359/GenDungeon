/**
 * The game rules, mirrored from the contract so the UI can preview results
 * and the demo simulator can follow the same arithmetic. The contract is the
 * source of truth; `tests/rules.parity.test.ts` reads GenDungeon.py and
 * fails when any constant here drifts from it.
 */

export const BPS = 10_000;

export const TIERS = [
  {
    tier: 0,
    name: "Shallows",
    feeBps: 10_000,
    rewardBps: 10_000,
    passScore: 40,
    renownWin: 20,
    hint: "a manageable hazard for a novice with a little common sense",
  },
  {
    tier: 1,
    name: "Depths",
    feeBps: 15_000,
    rewardBps: 15_000,
    passScore: 55,
    renownWin: 35,
    hint: "a demanding challenge that punishes carelessness",
  },
  {
    tier: 2,
    name: "Abyss",
    feeBps: 20_000,
    rewardBps: 25_000,
    passScore: 70,
    renownWin: 60,
    hint: "a brutal, near-hopeless trial that only a genuinely clever plan can solve",
  },
] as const;

export const WEIGHTS = { relevance: 35, plausibility: 35, creativity: 30 } as const;
export const COMPONENT_FLOOR = 40;

export const MIN_ACTION_CHARS = 10;
export const MAX_ACTION_CHARS = 1000;

export const RENOWN_ATTEMPT = 2;
export const RENOWN_PER_STREAK = 4;
export const RENOWN_STREAK_CAP = 5;
export const RANK_THRESHOLDS = [0, 100, 300, 700, 1500, 3000] as const;
export const RANK_NAMES = ["Wanderer", "Squire", "Knight", "Champion", "Archmage", "Legend"] as const;

export const DEFAULT_MAX_PAYOUT_BPS = 5000;
export const DEFAULT_QUEST_TTL = 86_400;
export const MIN_QUEST_TTL = 300;
export const MAX_QUEST_TTL = 30 * 86_400;
export const HALL_SIZE = 10;

export function overallScore(relevance: number, plausibility: number, creativity: number): number {
  return Math.floor(
    (relevance * WEIGHTS.relevance + plausibility * WEIGHTS.plausibility + creativity * WEIGHTS.creativity) / 100,
  );
}

export function isSuccess(
  tier: number,
  relevance: number,
  plausibility: number,
  creativity: number,
  tampering: boolean,
): boolean {
  if (tampering) return false;
  if (relevance < COMPONENT_FLOOR || plausibility < COMPONENT_FLOOR) return false;
  return overallScore(relevance, plausibility, creativity) >= TIERS[tier].passScore;
}

export function tierFee(entryFee: bigint, tier: number): bigint {
  return (entryFee * BigInt(TIERS[tier].feeBps)) / BigInt(BPS);
}

/** Reward a winning quest receives, capped by the pool and the payout cap. */
export function rewardFor(
  tier: number,
  score: number,
  minReward: bigint,
  maxReward: bigint,
  pool: bigint,
  maxPayoutBps: number,
): bigint {
  const span = maxReward > minReward ? maxReward - minReward : 0n;
  const base = minReward + (span * BigInt(score)) / 100n;
  const scaled = (base * BigInt(TIERS[tier].rewardBps)) / BigInt(BPS);
  const byCap = (pool * BigInt(maxPayoutBps)) / BigInt(BPS);
  let reward = scaled;
  if (pool < reward) reward = pool;
  if (byCap < reward) reward = byCap;
  return reward < 0n ? 0n : reward;
}

export function rankIndex(renown: number): number {
  let index = 0;
  RANK_THRESHOLDS.forEach((threshold, position) => {
    if (renown >= threshold) index = position;
  });
  return index;
}

export function nextRankAt(renown: number): number {
  const index = rankIndex(renown);
  return index + 1 >= RANK_THRESHOLDS.length ? 0 : RANK_THRESHOLDS[index + 1];
}

export function renownForWin(tier: number, score: number, streakBefore: number): number {
  return (
    TIERS[tier].renownWin +
    Math.floor(score / 5) +
    Math.min(streakBefore, RENOWN_STREAK_CAP) * RENOWN_PER_STREAK
  );
}

/** Progress (0..1) from the current rank threshold to the next one. */
export function rankProgress(renown: number): number {
  const next = nextRankAt(renown);
  if (next === 0) return 1;
  const floor = RANK_THRESHOLDS[rankIndex(renown)];
  return Math.min(1, Math.max(0, (renown - floor) / (next - floor)));
}

/** Cheap client-side length check; the contract does the authoritative one. */
export function localActionProblem(action: string): "" | "empty" | "too_short" | "too_long" {
  const trimmed = action.trim();
  if (trimmed.length === 0) return "empty";
  if (trimmed.length < MIN_ACTION_CHARS) return "too_short";
  if (trimmed.length > MAX_ACTION_CHARS) return "too_long";
  return "";
}

export function describeProblem(code: string): string {
  if (code === "") return "";
  if (code === "empty") return "Describe what your adventurer does.";
  if (code === "too_short") return `Use at least ${MIN_ACTION_CHARS} characters.`;
  if (code === "too_long") return `Keep it under ${MAX_ACTION_CHARS} characters.`;
  if (code.startsWith("instruction_like")) {
    return "This reads like an instruction to the judge. Describe an in-world action instead.";
  }
  return "This action cannot be submitted.";
}
