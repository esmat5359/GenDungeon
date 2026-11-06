/** Typed view of everything the GenDungeon v2 contract exposes. */

export const QuestStatus = {
  ACTIVE: 0,
  SUBMITTED: 1,
  SUCCESS: 2,
  FAILED: 3,
  CLAIMED: 4,
  EXPIRED: 5,
} as const;

export type QuestStatusId = (typeof QuestStatus)[keyof typeof QuestStatus];

export const STATUS_LABELS = [
  "Awaiting action",
  "Under review",
  "Victory",
  "Defeat",
  "Reward claimed",
  "Expired",
] as const;

export interface ConfigData {
  entryFee: bigint;
  minReward: bigint;
  maxReward: bigint;
  rewardPool: bigint;
  totalQuestsCreated: number;
  reservedRewards: bigint;
  maxPayoutBps: number;
  questTtlSeconds: number;
  paused: boolean;
  openQuests: number;
  totalDeposited: bigint;
  totalPaidOut: bigint;
  hallSize: number;
  version: string;
}

export interface TreasuryData {
  contractBalance: bigint;
  rewardPool: bigint;
  reservedRewards: bigint;
  totalDeposited: bigint;
  totalPaidOut: bigint;
  solvent: boolean;
  invariantHolds: boolean;
}

export interface TierData {
  tier: number;
  name: string;
  fee: bigint;
  rewardBps: number;
  passScore: number;
  hint: string;
}

export interface QuestData {
  questId: number;
  player: string;
  tier: number;
  tierName: string;
  scenario: string;
  action: string;
  status: number;
  statusLabel: string;
  relevance: number;
  plausibility: number;
  creativity: number;
  score: number;
  reward: bigint;
  paid: bigint;
  narrative: string;
  createdAt: number;
  resolvedAt: number;
}

export interface PlayerStatsData {
  questsStarted: number;
  questsSucceeded: number;
  questsFailed: number;
  totalRewardsEarned: bigint;
  renown: number;
  rank: number;
  rankLabel: string;
  nextRankAt: number;
  winStreak: number;
  bestStreak: number;
  tamperFlags: number;
}

export interface HistoryItem {
  questId: number;
  tier: number;
  tierName: string;
  status: number;
  statusLabel: string;
  score: number;
  reward: bigint;
  createdAt: number;
}

export interface OpenQuestItem {
  questId: number;
  player: string;
  tier: number;
  tierName: string;
  scenario: string;
  status: number;
  statusLabel: string;
  createdAt: number;
}

export interface HallEntry {
  position: number;
  player: string;
  renown: number;
  rankLabel: string;
  questsSucceeded: number;
  bestStreak: number;
  totalRewardsEarned: bigint;
}

/** Consensus pipeline states, in the order a transaction moves through them. */
export type TxStage =
  | "PENDING"
  | "PROPOSING"
  | "COMMITTING"
  | "REVEALING"
  | "ACCEPTED"
  | "FINALIZED";

export const TX_STAGES: readonly TxStage[] = [
  "PENDING",
  "PROPOSING",
  "COMMITTING",
  "REVEALING",
  "ACCEPTED",
  "FINALIZED",
];

export type TxStatusListener = (status: string) => void;

export interface TxOutcome {
  hash: string;
  status: string;
  ok: boolean;
  /** Human-readable reason when `ok` is false. */
  error?: string;
}

export class GameError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GameError";
  }
}
