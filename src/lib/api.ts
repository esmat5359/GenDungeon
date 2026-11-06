import type {
  ConfigData,
  HallEntry,
  HistoryItem,
  OpenQuestItem,
  PlayerStatsData,
  QuestData,
  TierData,
  TreasuryData,
  TxOutcome,
  TxStatusListener,
} from "./types";

/**
 * Everything the UI (and the live end-to-end script) needs from a GenDungeon
 * deployment. `LiveGame` talks to a real contract through genlayer-js and
 * `DemoGame` runs the same rules in memory, so every page works either way.
 */
export interface GameApi {
  readonly mode: "live" | "demo";
  /** Contract address (live) or a placeholder (demo). */
  readonly address: string;
  /** The account that signs writes; empty when read-only. */
  readonly caller: string;

  // ---- reads ----
  getVersion(): Promise<string>;
  getOwner(): Promise<string>;
  getPendingOwner(): Promise<string>;
  getConfig(): Promise<ConfigData>;
  getTreasury(): Promise<TreasuryData>;
  getTiers(): Promise<TierData[]>;
  quoteReward(tier: number, score: number): Promise<bigint>;
  validateAction(action: string): Promise<string>;
  getQuest(questId: number): Promise<QuestData>;
  getActiveQuestId(player: string): Promise<number>;
  getStats(player: string): Promise<PlayerStatsData>;
  getHistory(player: string, limit: number): Promise<HistoryItem[]>;
  listOpenQuests(limit: number): Promise<OpenQuestItem[]>;
  getHall(): Promise<HallEntry[]>;

  // ---- player writes ----
  startQuest(tier: number, value: bigint, onStatus?: TxStatusListener): Promise<TxOutcome>;
  submitAction(questId: number, action: string, onStatus?: TxStatusListener): Promise<TxOutcome>;
  resolveQuest(questId: number, onStatus?: TxStatusListener): Promise<TxOutcome>;
  claimReward(questId: number, onStatus?: TxStatusListener): Promise<TxOutcome>;
  surrenderQuest(onStatus?: TxStatusListener): Promise<TxOutcome>;
  expireQuest(questId: number, onStatus?: TxStatusListener): Promise<TxOutcome>;
  fundPool(value: bigint, onStatus?: TxStatusListener): Promise<TxOutcome>;

  // ---- keeper (owner) writes ----
  setFeeAndRewards(entryFee: bigint, minReward: bigint, maxReward: bigint, onStatus?: TxStatusListener): Promise<TxOutcome>;
  setPayoutCap(bps: number, onStatus?: TxStatusListener): Promise<TxOutcome>;
  setQuestTtl(seconds: number, onStatus?: TxStatusListener): Promise<TxOutcome>;
  setPaused(paused: boolean, onStatus?: TxStatusListener): Promise<TxOutcome>;
  transferOwnership(newOwner: string, onStatus?: TxStatusListener): Promise<TxOutcome>;
  acceptOwnership(onStatus?: TxStatusListener): Promise<TxOutcome>;
  cancelOwnershipTransfer(onStatus?: TxStatusListener): Promise<TxOutcome>;
}
