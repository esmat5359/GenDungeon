import type { GameApi } from "../lib/api";
import type {
  ConfigData,
  HallEntry,
  HistoryItem,
  OpenQuestItem,
  PlayerStatsData,
  QuestData,
  TierData,
  TreasuryData,
} from "../lib/types";

export interface Snapshot {
  phase: "loading" | "ready" | "error";
  error: string | null;
  /** True when the contract at this address does not speak the v2 API. */
  legacy: boolean;
  config: ConfigData | null;
  treasury: TreasuryData | null;
  tiers: TierData[];
  hall: HallEntry[];
  openQuests: OpenQuestItem[];
  owner: string;
  pendingOwner: string;
  stats: PlayerStatsData | null;
  activeQuest: QuestData | null;
  lastQuest: QuestData | null;
  history: HistoryItem[];
  updatedAt: number;
}

const INITIAL: Snapshot = {
  phase: "loading",
  error: null,
  legacy: false,
  config: null,
  treasury: null,
  tiers: [],
  hall: [],
  openQuests: [],
  owner: "",
  pendingOwner: "",
  stats: null,
  activeQuest: null,
  lastQuest: null,
  history: [],
  updatedAt: 0,
};

async function settle<T>(work: Promise<T>): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
  try {
    return { ok: true, value: await work };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * One shared, de-duplicated view of the chain for every page. Reads for the
 * public data and for the connected player run together; a failed read keeps
 * the last good value instead of blanking the screen.
 */
export class GameStore {
  private snap: Snapshot = INITIAL;
  private readonly listeners = new Set<() => void>();
  private inflight: Promise<void> | null = null;
  private rerun = false;
  private versionChecked = false;

  constructor(
    readonly api: GameApi,
    readonly account: string,
  ) {}

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = () => this.snap;

  private set(patch: Partial<Snapshot>) {
    this.snap = { ...this.snap, ...patch };
    this.listeners.forEach((l) => l());
  }

  refresh(): Promise<void> {
    if (this.inflight) {
      this.rerun = true;
      return this.inflight;
    }
    this.inflight = this.load().finally(() => {
      this.inflight = null;
      if (this.rerun) {
        this.rerun = false;
        void this.refresh();
      }
    });
    return this.inflight;
  }

  private async load(): Promise<void> {
    const api = this.api;

    if (!this.versionChecked) {
      const version = await settle(api.getVersion());
      if (!version.ok || !version.value.startsWith("2.")) {
        this.set({ phase: "ready", legacy: true, error: null, updatedAt: Date.now() });
        return;
      }
      this.versionChecked = true;
      this.snap = { ...this.snap, legacy: false };
    }

    const [config, treasury, tiers, hall, open, owner, pending] = await Promise.all([
      settle(api.getConfig()),
      settle(api.getTreasury()),
      settle(api.getTiers()),
      settle(api.getHall()),
      settle(api.listOpenQuests(20)),
      settle(api.getOwner()),
      settle(api.getPendingOwner()),
    ]);

    const patch: Partial<Snapshot> = { updatedAt: Date.now() };
    if (config.ok) patch.config = config.value;
    if (treasury.ok) patch.treasury = treasury.value;
    if (tiers.ok) patch.tiers = tiers.value;
    if (hall.ok) patch.hall = hall.value;
    if (open.ok) patch.openQuests = open.value;
    if (owner.ok) patch.owner = owner.value;
    if (pending.ok) patch.pendingOwner = pending.value;

    if (this.account) {
      const [stats, activeId, history] = await Promise.all([
        settle(api.getStats(this.account)),
        settle(api.getActiveQuestId(this.account)),
        settle(api.getHistory(this.account, 25)),
      ]);
      if (stats.ok) patch.stats = stats.value;
      if (history.ok) patch.history = history.value;
      if (activeId.ok) {
        patch.activeQuest = null;
        patch.lastQuest = null;
        if (activeId.value > 0) {
          const quest = await settle(api.getQuest(activeId.value));
          if (quest.ok) patch.activeQuest = quest.value;
        } else if (history.ok && history.value.length > 0) {
          const quest = await settle(api.getQuest(history.value[0].questId));
          if (quest.ok) patch.lastQuest = quest.value;
        }
      }
    } else {
      patch.stats = null;
      patch.activeQuest = null;
      patch.lastQuest = null;
      patch.history = [];
    }

    if (!config.ok && !this.snap.config) {
      this.set({ ...patch, phase: "error", error: config.error });
      return;
    }
    this.set({ ...patch, phase: "ready", error: config.ok ? null : config.error });
  }
}
