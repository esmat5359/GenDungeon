/**
 * Decoders for the dataclasses returned by the contract's view methods.
 * Depending on the SDK path a dataclass arrives as a plain object or a Map,
 * so every field is looked up by its snake_case name and a camelCase alias.
 */

import { toBigInt, toBool, toNumber, toText } from "./format";
import {
  STATUS_LABELS,
  type ConfigData,
  type HallEntry,
  type HistoryItem,
  type OpenQuestItem,
  type PlayerStatsData,
  type QuestData,
  type TierData,
  type TreasuryData,
} from "./types";

function camel(key: string): string {
  return key.replace(/_([a-z])/g, (_m, c: string) => c.toUpperCase());
}

export function field(raw: unknown, key: string): unknown {
  if (raw === null || typeof raw !== "object") return undefined;
  if (raw instanceof Map) {
    return raw.has(key) ? raw.get(key) : raw.get(camel(key));
  }
  const record = raw as Record<string, unknown>;
  return record[key] !== undefined ? record[key] : record[camel(key)];
}

function statusLabel(raw: unknown, status: number): string {
  return toText(field(raw, "status_label"), STATUS_LABELS[status] ?? "Unknown");
}

export function normalizeConfig(raw: unknown): ConfigData {
  return {
    entryFee: toBigInt(field(raw, "entry_fee")),
    minReward: toBigInt(field(raw, "min_reward")),
    maxReward: toBigInt(field(raw, "max_reward")),
    rewardPool: toBigInt(field(raw, "reward_pool")),
    totalQuestsCreated: toNumber(field(raw, "total_quests_created")),
    reservedRewards: toBigInt(field(raw, "reserved_rewards")),
    maxPayoutBps: toNumber(field(raw, "max_payout_bps")),
    questTtlSeconds: toNumber(field(raw, "quest_ttl_seconds")),
    paused: toBool(field(raw, "paused")),
    openQuests: toNumber(field(raw, "open_quests")),
    totalDeposited: toBigInt(field(raw, "total_deposited")),
    totalPaidOut: toBigInt(field(raw, "total_paid_out")),
    hallSize: toNumber(field(raw, "hall_size")),
    version: toText(field(raw, "version"), "unknown"),
  };
}

export function normalizeTreasury(raw: unknown): TreasuryData {
  return {
    contractBalance: toBigInt(field(raw, "contract_balance")),
    rewardPool: toBigInt(field(raw, "reward_pool")),
    reservedRewards: toBigInt(field(raw, "reserved_rewards")),
    totalDeposited: toBigInt(field(raw, "total_deposited")),
    totalPaidOut: toBigInt(field(raw, "total_paid_out")),
    solvent: toBool(field(raw, "solvent")),
    invariantHolds: toBool(field(raw, "invariant_holds")),
  };
}

export function normalizeTier(raw: unknown): TierData {
  return {
    tier: toNumber(field(raw, "tier")),
    name: toText(field(raw, "name")),
    fee: toBigInt(field(raw, "fee")),
    rewardBps: toNumber(field(raw, "reward_bps")),
    passScore: toNumber(field(raw, "pass_score")),
    hint: toText(field(raw, "hint")),
  };
}

export function normalizeQuest(raw: unknown): QuestData {
  const status = toNumber(field(raw, "status"));
  return {
    questId: toNumber(field(raw, "quest_id")),
    player: toText(field(raw, "player")),
    tier: toNumber(field(raw, "tier")),
    tierName: toText(field(raw, "tier_name")),
    scenario: toText(field(raw, "scenario")),
    action: toText(field(raw, "action")),
    status,
    statusLabel: statusLabel(raw, status),
    relevance: toNumber(field(raw, "relevance")),
    plausibility: toNumber(field(raw, "plausibility")),
    creativity: toNumber(field(raw, "creativity")),
    score: toNumber(field(raw, "score")),
    reward: toBigInt(field(raw, "reward")),
    paid: toBigInt(field(raw, "paid")),
    narrative: toText(field(raw, "narrative_outcome")),
    createdAt: toNumber(field(raw, "created_at")),
    resolvedAt: toNumber(field(raw, "resolved_at")),
  };
}

export function normalizeStats(raw: unknown): PlayerStatsData {
  return {
    questsStarted: toNumber(field(raw, "quests_started")),
    questsSucceeded: toNumber(field(raw, "quests_succeeded")),
    questsFailed: toNumber(field(raw, "quests_failed")),
    totalRewardsEarned: toBigInt(field(raw, "total_rewards_earned")),
    renown: toNumber(field(raw, "renown")),
    rank: toNumber(field(raw, "rank")),
    rankLabel: toText(field(raw, "rank_label"), "Wanderer"),
    nextRankAt: toNumber(field(raw, "next_rank_at")),
    winStreak: toNumber(field(raw, "win_streak")),
    bestStreak: toNumber(field(raw, "best_streak")),
    tamperFlags: toNumber(field(raw, "tamper_flags")),
  };
}

export function normalizeHistoryItem(raw: unknown): HistoryItem {
  const status = toNumber(field(raw, "status"));
  return {
    questId: toNumber(field(raw, "quest_id")),
    tier: toNumber(field(raw, "tier")),
    tierName: toText(field(raw, "tier_name")),
    status,
    statusLabel: statusLabel(raw, status),
    score: toNumber(field(raw, "score")),
    reward: toBigInt(field(raw, "reward")),
    createdAt: toNumber(field(raw, "created_at")),
  };
}

export function normalizeOpenQuest(raw: unknown): OpenQuestItem {
  const status = toNumber(field(raw, "status"));
  return {
    questId: toNumber(field(raw, "quest_id")),
    player: toText(field(raw, "player")),
    tier: toNumber(field(raw, "tier")),
    tierName: toText(field(raw, "tier_name")),
    scenario: toText(field(raw, "scenario")),
    status,
    statusLabel: statusLabel(raw, status),
    createdAt: toNumber(field(raw, "created_at")),
  };
}

export function normalizeHallEntry(raw: unknown): HallEntry {
  return {
    position: toNumber(field(raw, "position")),
    player: toText(field(raw, "player")),
    renown: toNumber(field(raw, "renown")),
    rankLabel: toText(field(raw, "rank_label")),
    questsSucceeded: toNumber(field(raw, "quests_succeeded")),
    bestStreak: toNumber(field(raw, "best_streak")),
    totalRewardsEarned: toBigInt(field(raw, "total_rewards_earned")),
  };
}

export function asList(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (raw instanceof Map) return Array.from(raw.values());
  return [];
}
