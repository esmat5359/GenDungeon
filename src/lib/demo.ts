/**
 * DemoChain / DemoGame: an in-memory simulation of the GenDungeon v2
 * contract. It enforces the same state machine, economy and error messages,
 * but the judge is a small deterministic heuristic instead of an LLM
 * consensus, so the whole UI can be explored (and screenshotted and tested)
 * without a network, a wallet or any funds.
 */

import type { GameApi } from "./api";
import { GameError, STATUS_LABELS, QuestStatus } from "./types";
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
import {
  DEFAULT_MAX_PAYOUT_BPS,
  DEFAULT_QUEST_TTL,
  HALL_SIZE,
  MAX_ACTION_CHARS,
  MAX_QUEST_TTL,
  MIN_ACTION_CHARS,
  MIN_QUEST_TTL,
  RANK_NAMES,
  RENOWN_ATTEMPT,
  TIERS,
  isSuccess,
  nextRankAt,
  overallScore,
  rankIndex,
  renownForWin,
  rewardFor,
  tierFee,
} from "./rules";

const GEN = 10n ** 18n;

export const DEMO_KEEPER = "0xDec0DE0000000000000000000000000000000001";
export const DEMO_ADVENTURER = "0xD3A0000000000000000000000000000000000002";

class Revert extends Error {}

// ---------------------------------------------------------------- judging
const INJECTION_PATTERNS: RegExp[] = [
  /ignore (all |any |the )?(previous|prior|above|earlier)/,
  /disregard (all |any |the )?(previous|prior|above|earlier|rules|instructions)/,
  /(system|developer) (prompt|message|instruction)/,
  /you are now/,
  /act as (the |an? )?(judge|dungeon master)/,
  /(give|award|grant) (me )?(a )?(full|perfect|max|100)/,
  /success ?[:=] ?true/,
  /(score|rating) ?[:=] ?\d+/,
  /override (the )?(rules|score|verdict)/,
];

function squash(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\u200b-\u200f\u2060\ufeff]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Mirrors the shape of the contract's submit-time check (not its full strength). */
export function demoActionProblem(action: string): string {
  const cleaned = action.replace(/[\u200b-\u200f\u2060\ufeff]/g, "").trim();
  if (cleaned.length === 0) return "empty";
  if (cleaned.length < MIN_ACTION_CHARS) return "too_short";
  if (cleaned.length > MAX_ACTION_CHARS) return "too_long";
  const flat = squash(cleaned);
  const compact = flat.replace(/ /g, "");
  for (const pattern of INJECTION_PATTERNS) {
    const hit = flat.match(pattern);
    if (hit) return `instruction_like:${hit[0]}`;
  }
  if (/ignorepreviousinstructions|successtrue|systemprompt/.test(compact)) {
    return "instruction_like:obfuscated instruction";
  }
  return "";
}

function hash32(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const STOP = new Set(
  "the and with that this from have into your their there then than they them what when over under about while which would could should onto only just very".split(" "),
);

function words(text: string): string[] {
  return squash(text)
    .split(" ")
    .filter((w) => w.length > 3 && !STOP.has(w));
}

const CAREFUL = ["carefully", "slowly", "first", "then", "test", "check", "inspect", "listen", "steady", "brace", "tie", "wedge", "shield", "lantern", "rope", "plan", "wait", "signal", "distract", "retreat"];
const RECKLESS = ["instantly", "simply", "magic", "teleport", "everything", "destroy", "kill", "invincible", "unstoppable", "impossible", "nothing happens"];

export interface Judgement {
  relevance: number;
  plausibility: number;
  creativity: number;
  tampering: boolean;
  narrative: string;
}

/** A deterministic stand-in for the validator LLMs. */
export function demoJudge(tier: number, scenario: string, action: string): Judgement {
  const tampering = demoActionProblem(action).startsWith("instruction_like");
  const sceneWords = new Set(words(scenario));
  const actWords = words(action);
  const overlap = actWords.filter((w) => sceneWords.has(w)).length;
  const lower = squash(action);
  const careful = CAREFUL.filter((w) => lower.includes(w)).length;
  const reckless = RECKLESS.filter((w) => lower.includes(w)).length;
  const distinct = new Set(actWords).size;
  const jitter = (salt: number) => (hash32(action + salt) % 13) - 6;

  const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));
  const relevance = clamp(28 + Math.min(overlap, 4) * 15 + Math.min(actWords.length, 12) * 1.5 + jitter(1));
  const plausibility = clamp(42 + Math.min(careful, 5) * 9 - reckless * 14 + jitter(2));
  const creativity = clamp(30 + Math.min(distinct, 18) * 2.6 + Math.min(careful, 3) * 3 + jitter(3));

  const passes = isSuccess(tier, relevance, plausibility, creativity, tampering);
  const narrative = tampering
    ? "The scribes sensed trickery."
    : passes
      ? "The plan holds, and the way forward opens."
      : "The plan falters and the dungeon closes in.";
  return { relevance, plausibility, creativity, tampering, narrative };
}

const SCENARIOS = [
  "A rope bridge sways over a storm-wrapped chasm, half its planks already missing.",
  "A mirror labyrinth keeps rearranging itself, and your own reflection points the wrong way.",
  "A flooded crypt hums with lantern spirits that drift toward any spoken lie.",
  "Singing crystals line a collapsing mine, and each note loosens another slab of rock.",
  "A frozen citadel's constructs sleep in rows; the only exit passes between them.",
  "A library's books whisper back, and the one you need keeps changing shelves.",
  "A volcanic forge's silent smiths lower a gate every time you look away.",
  "A drowned market glows with eels that dim whenever someone lies about a price.",
];

// ------------------------------------------------------------------ chain
interface DemoQuest extends QuestData {}

interface DemoStats {
  started: number;
  succeeded: number;
  failed: number;
  earned: bigint;
  renown: number;
  streak: number;
  best: number;
  tamper: number;
}

export interface DemoOptions {
  /** Pause between simulated consensus stages. 0 disables the animation. */
  stageDelayMs?: number;
  now?: () => number;
}

export class DemoChain {
  readonly address = "0xDe00000000000000000000000000000000000De0";
  owner = DEMO_KEEPER;
  pendingOwner = "";
  entryFee = GEN / 10n;
  minReward = (GEN * 15n) / 100n;
  maxReward = (GEN * 60n) / 100n;
  rewardPool = 0n;
  reserved = 0n;
  deposited = 0n;
  paidOut = 0n;
  maxPayoutBps = DEFAULT_MAX_PAYOUT_BPS;
  ttl = DEFAULT_QUEST_TTL;
  paused = false;

  readonly quests = new Map<number, DemoQuest>();
  readonly stats = new Map<string, DemoStats>();
  readonly slot = new Map<string, number>();
  readonly last = new Map<string, number>();
  hall: string[] = [];
  open: number[] = []; // newest first
  counter = 0;

  stageDelayMs: number;
  private readonly clock: () => number;
  private skew = 0;
  private readonly listeners = new Set<() => void>();

  constructor(options: DemoOptions = {}) {
    this.stageDelayMs = options.stageDelayMs ?? 420;
    this.clock = options.now ?? (() => Math.floor(Date.now() / 1000));
  }

  now(): number {
    return this.clock() + this.skew;
  }
  /** Moves the simulated clock (used by tests and the seed). */
  advance(seconds: number) {
    this.skew += seconds;
  }
  setSkew(seconds: number) {
    this.skew = seconds;
  }
  setStageDelay(ms: number) {
    this.stageDelayMs = ms;
  }
  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  private changed() {
    this.listeners.forEach((l) => l());
  }

  api(caller: string): DemoGame {
    return new DemoGame(this, caller);
  }

  // ---- internals shared with DemoGame ----
  statsFor(player: string): DemoStats {
    let s = this.stats.get(player);
    if (!s) {
      s = { started: 0, succeeded: 0, failed: 0, earned: 0n, renown: 0, streak: 0, best: 0, tamper: 0 };
      this.stats.set(player, s);
    }
    return s;
  }

  private award(player: string, gain: number) {
    if (gain <= 0) return;
    const s = this.statsFor(player);
    s.renown += gain;
    const others = this.hall.filter((p) => p !== player);
    let at = others.length;
    for (let i = 0; i < others.length; i++) {
      if (this.statsFor(others[i]).renown < s.renown) {
        at = i;
        break;
      }
    }
    others.splice(at, 0, player);
    this.hall = others.slice(0, HALL_SIZE);
  }

  private release(player: string, questId: number) {
    if (this.slot.get(player) === questId) this.slot.set(player, 0);
  }

  private unlink(questId: number) {
    this.open = this.open.filter((id) => id !== questId);
  }

  private load(questId: number): DemoQuest {
    const quest = this.quests.get(questId);
    if (!quest) throw new Revert("Quest does not exist");
    return quest;
  }

  // ---- state transitions (each throws Revert like the contract's UserError) ----
  start(player: string, tier: number, value: bigint): number {
    if (this.paused) throw new Revert("The dungeon is closed for now");
    if (!Number.isInteger(tier) || tier < 0 || tier >= TIERS.length) throw new Revert("Unknown difficulty tier");
    const required = tierFee(this.entryFee, tier);
    if (value < required) throw new Revert(`Insufficient entry fee: sent ${value}, required ${required}`);
    const active = this.slot.get(player) ?? 0;
    if (active !== 0) {
      const q = this.quests.get(active);
      if (q && [QuestStatus.ACTIVE, QuestStatus.SUBMITTED, QuestStatus.SUCCESS].includes(q.status as 0 | 1 | 2)) {
        throw new Revert(
          "You have a quest awaiting action, resolution, or reward claim - resolve or claim it before starting a new one",
        );
      }
    }
    const scenario = SCENARIOS[(hash32(player + this.counter) + tier) % SCENARIOS.length];
    this.rewardPool += value;
    this.deposited += value;
    this.counter += 1;
    const id = this.counter;
    this.quests.set(id, {
      questId: id,
      player,
      tier,
      tierName: TIERS[tier].name,
      scenario,
      action: "",
      status: QuestStatus.ACTIVE,
      statusLabel: STATUS_LABELS[QuestStatus.ACTIVE],
      relevance: 0,
      plausibility: 0,
      creativity: 0,
      score: 0,
      reward: 0n,
      paid: value,
      narrative: "",
      createdAt: this.now(),
      resolvedAt: 0,
    });
    this.open.unshift(id);
    this.slot.set(player, id);
    this.last.set(player, id);
    this.statsFor(player).started += 1;
    return id;
  }

  private setStatus(q: DemoQuest, status: number) {
    q.status = status;
    q.statusLabel = STATUS_LABELS[status];
  }

  submit(player: string, questId: number, action: string) {
    const q = this.load(questId);
    if (q.player !== player) throw new Revert("You do not own this quest");
    if (q.status !== QuestStatus.ACTIVE) throw new Revert("Quest is not awaiting an action");
    const problem = demoActionProblem(action);
    if (problem === "empty") throw new Revert("Action text must not be empty");
    if (problem === "too_short") throw new Revert("Action text is too short (min 10 chars)");
    if (problem === "too_long") throw new Revert("Action text is too long (max 1000 chars)");
    if (problem.startsWith("instruction_like")) throw new Revert("Action rejected: it contains instructions aimed at the judge");
    q.action = action.trim();
    this.setStatus(q, QuestStatus.SUBMITTED);
  }

  surrender(player: string) {
    const id = this.slot.get(player) ?? 0;
    if (id === 0) throw new Revert("You do not have an active quest");
    const q = this.load(id);
    if (q.status !== QuestStatus.ACTIVE) throw new Revert("Quest is currently being resolved or already finished");
    this.setStatus(q, QuestStatus.FAILED);
    q.narrative = "The adventurer fled from the challenge in terror.";
    q.resolvedAt = this.now();
    this.unlink(id);
    const s = this.statsFor(player);
    s.failed += 1;
    s.streak = 0;
    this.slot.set(player, 0);
  }

  expire(questId: number) {
    const q = this.load(questId);
    if (q.status !== QuestStatus.ACTIVE) throw new Revert("Only a quest awaiting an action can expire");
    if (this.now() < q.createdAt + this.ttl) throw new Revert("Quest has not expired yet");
    this.setStatus(q, QuestStatus.EXPIRED);
    q.narrative = "The adventurer never answered the call and the trail went cold.";
    q.resolvedAt = this.now();
    this.unlink(questId);
    const s = this.statsFor(q.player);
    s.failed += 1;
    s.streak = 0;
    this.release(q.player, questId);
  }

  resolve(questId: number): boolean {
    const q = this.load(questId);
    if (q.status !== QuestStatus.SUBMITTED) throw new Revert("Quest is not awaiting resolution");
    const j = demoJudge(q.tier, q.scenario, q.action);
    const score = overallScore(j.relevance, j.plausibility, j.creativity);
    const success = isSuccess(q.tier, j.relevance, j.plausibility, j.creativity, j.tampering);
    const s = this.statsFor(q.player);
    q.relevance = j.relevance;
    q.plausibility = j.plausibility;
    q.creativity = j.creativity;
    q.score = score;
    q.resolvedAt = this.now();
    this.unlink(questId);
    if (success) {
      const reward = rewardFor(q.tier, score, this.minReward, this.maxReward, this.rewardPool, this.maxPayoutBps);
      this.setStatus(q, QuestStatus.SUCCESS);
      q.reward = reward;
      q.narrative = j.narrative;
      this.rewardPool -= reward;
      this.reserved += reward;
      const before = s.streak;
      s.succeeded += 1;
      s.streak += 1;
      s.best = Math.max(s.best, s.streak);
      this.award(q.player, renownForWin(q.tier, score, before));
    } else {
      this.setStatus(q, QuestStatus.FAILED);
      q.reward = 0n;
      q.narrative = j.tampering ? "The scribes sensed trickery and struck the attempt from the chronicle." : j.narrative;
      s.failed += 1;
      s.streak = 0;
      if (j.tampering) s.tamper += 1;
      else this.award(q.player, RENOWN_ATTEMPT);
      this.release(q.player, questId);
    }
    return success;
  }

  claim(player: string, questId: number): bigint {
    const q = this.load(questId);
    if (q.player !== player) throw new Revert("You do not own this quest");
    if (q.status !== QuestStatus.SUCCESS) throw new Revert("Quest is not a claimable success");
    this.setStatus(q, QuestStatus.CLAIMED);
    this.reserved -= q.reward;
    this.paidOut += q.reward;
    this.statsFor(player).earned += q.reward;
    this.release(player, questId);
    return q.reward;
  }

  fund(value: bigint) {
    if (value === 0n) throw new Revert("Send some value to fund the pool");
    this.rewardPool += value;
    this.deposited += value;
  }

  requireOwner(caller: string) {
    if (caller.toLowerCase() !== this.owner.toLowerCase()) throw new Revert("Only the owner can do this");
  }

  notify() {
    this.changed();
  }
}

// ------------------------------------------------------------------ api
const STAGES = ["PENDING", "PROPOSING", "COMMITTING", "REVEALING", "ACCEPTED"] as const;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class DemoGame implements GameApi {
  readonly mode = "demo" as const;
  readonly address: string;

  constructor(
    private readonly chain: DemoChain,
    readonly caller: string,
  ) {
    this.address = chain.address;
  }

  // ---- reads ----
  async getVersion() {
    return "2.0.0";
  }
  async getOwner() {
    return this.chain.owner;
  }
  async getPendingOwner() {
    return this.chain.pendingOwner;
  }
  async getConfig(): Promise<ConfigData> {
    const c = this.chain;
    return {
      entryFee: c.entryFee,
      minReward: c.minReward,
      maxReward: c.maxReward,
      rewardPool: c.rewardPool,
      totalQuestsCreated: c.counter,
      reservedRewards: c.reserved,
      maxPayoutBps: c.maxPayoutBps,
      questTtlSeconds: c.ttl,
      paused: c.paused,
      openQuests: c.open.length,
      totalDeposited: c.deposited,
      totalPaidOut: c.paidOut,
      hallSize: c.hall.length,
      version: "2.0.0",
    };
  }
  async getTreasury(): Promise<TreasuryData> {
    const c = this.chain;
    return {
      contractBalance: c.rewardPool + c.reserved,
      rewardPool: c.rewardPool,
      reservedRewards: c.reserved,
      totalDeposited: c.deposited,
      totalPaidOut: c.paidOut,
      solvent: true,
      invariantHolds: c.deposited === c.rewardPool + c.reserved + c.paidOut,
    };
  }
  async getTiers(): Promise<TierData[]> {
    return TIERS.map((t) => ({
      tier: t.tier,
      name: t.name,
      fee: tierFee(this.chain.entryFee, t.tier),
      rewardBps: t.rewardBps,
      passScore: t.passScore,
      hint: t.hint,
    }));
  }
  async quoteReward(tier: number, score: number) {
    if (tier < 0 || tier >= TIERS.length || score < 0 || score > 100) return 0n;
    const c = this.chain;
    return rewardFor(tier, score, c.minReward, c.maxReward, c.rewardPool, c.maxPayoutBps);
  }
  async validateAction(action: string) {
    return demoActionProblem(action);
  }
  async getQuest(questId: number): Promise<QuestData> {
    const q = this.chain.quests.get(questId);
    if (!q) throw new GameError("Quest does not exist");
    return { ...q };
  }
  async getActiveQuestId(player: string) {
    return this.chain.slot.get(player) ?? 0;
  }
  async getStats(player: string): Promise<PlayerStatsData> {
    const s = this.chain.statsFor(player);
    const rank = rankIndex(s.renown);
    return {
      questsStarted: s.started,
      questsSucceeded: s.succeeded,
      questsFailed: s.failed,
      totalRewardsEarned: s.earned,
      renown: s.renown,
      rank,
      rankLabel: RANK_NAMES[rank],
      nextRankAt: nextRankAt(s.renown),
      winStreak: s.streak,
      bestStreak: s.best,
      tamperFlags: s.tamper,
    };
  }
  async getHistory(player: string, limit: number): Promise<HistoryItem[]> {
    return Array.from(this.chain.quests.values())
      .filter((q) => q.player === player)
      .sort((a, b) => b.questId - a.questId)
      .slice(0, limit)
      .map((q) => ({
        questId: q.questId,
        tier: q.tier,
        tierName: q.tierName,
        status: q.status,
        statusLabel: q.statusLabel,
        score: q.score,
        reward: q.reward,
        createdAt: q.createdAt,
      }));
  }
  async listOpenQuests(limit: number): Promise<OpenQuestItem[]> {
    return this.chain.open.slice(0, limit).map((id) => {
      const q = this.chain.quests.get(id)!;
      return {
        questId: q.questId,
        player: q.player,
        tier: q.tier,
        tierName: q.tierName,
        scenario: q.scenario,
        status: q.status,
        statusLabel: q.statusLabel,
        createdAt: q.createdAt,
      };
    });
  }
  async getHall(): Promise<HallEntry[]> {
    return this.chain.hall.map((player, index) => {
      const s = this.chain.statsFor(player);
      return {
        position: index + 1,
        player,
        renown: s.renown,
        rankLabel: RANK_NAMES[rankIndex(s.renown)],
        questsSucceeded: s.succeeded,
        bestStreak: s.best,
        totalRewardsEarned: s.earned,
      };
    });
  }

  // ---- writes ----
  private async run(
    label: string,
    work: () => void,
    onStatus?: TxStatusListener,
    slow = 1,
  ): Promise<TxOutcome> {
    const hash = `0xdemo${(hash32(label + this.chain.now() + Math.random()).toString(16)).padStart(8, "0")}${"0".repeat(52)}`;
    const delay = this.chain.stageDelayMs * slow;
    for (const stage of STAGES.slice(0, -1)) {
      onStatus?.(stage);
      if (delay > 0) await sleep(delay);
    }
    let outcome: TxOutcome;
    try {
      work();
      outcome = { hash, status: "ACCEPTED", ok: true };
    } catch (error) {
      if (!(error instanceof Revert)) throw error;
      outcome = { hash, status: "ACCEPTED", ok: false, error: error.message };
    }
    onStatus?.("ACCEPTED");
    this.chain.notify();
    return outcome;
  }

  startQuest(tier: number, value: bigint, onStatus?: TxStatusListener) {
    return this.run("start", () => this.chain.start(this.caller, tier, value), onStatus);
  }
  submitAction(questId: number, action: string, onStatus?: TxStatusListener) {
    return this.run("submit", () => this.chain.submit(this.caller, questId, action), onStatus);
  }
  resolveQuest(questId: number, onStatus?: TxStatusListener) {
    return this.run("resolve", () => void this.chain.resolve(questId), onStatus, 2);
  }
  claimReward(questId: number, onStatus?: TxStatusListener) {
    return this.run("claim", () => void this.chain.claim(this.caller, questId), onStatus);
  }
  surrenderQuest(onStatus?: TxStatusListener) {
    return this.run("surrender", () => this.chain.surrender(this.caller), onStatus);
  }
  expireQuest(questId: number, onStatus?: TxStatusListener) {
    return this.run("expire", () => this.chain.expire(questId), onStatus);
  }
  fundPool(value: bigint, onStatus?: TxStatusListener) {
    return this.run("fund", () => this.chain.fund(value), onStatus);
  }
  setFeeAndRewards(entryFee: bigint, minReward: bigint, maxReward: bigint, onStatus?: TxStatusListener) {
    return this.run(
      "config",
      () => {
        this.chain.requireOwner(this.caller);
        if (entryFee <= 0n) throw new Revert("entry_fee must be greater than zero");
        if (entryFee < 0n || minReward < 0n || maxReward < 0n) throw new Revert("rewards must not be negative");
        if (minReward > maxReward) throw new Revert("min_reward cannot exceed max_reward");
        const limit = 10n ** 30n;
        if (entryFee > limit || minReward > limit || maxReward > limit) throw new Revert("parameter is above the allowed maximum");
        this.chain.entryFee = entryFee;
        this.chain.minReward = minReward;
        this.chain.maxReward = maxReward;
      },
      onStatus,
    );
  }
  setPayoutCap(bps: number, onStatus?: TxStatusListener) {
    return this.run(
      "cap",
      () => {
        this.chain.requireOwner(this.caller);
        if (!Number.isInteger(bps) || bps < 1 || bps > 10_000) throw new Revert("Payout cap must be between 1 and 10000 bps");
        this.chain.maxPayoutBps = bps;
      },
      onStatus,
    );
  }
  setQuestTtl(seconds: number, onStatus?: TxStatusListener) {
    return this.run(
      "ttl",
      () => {
        this.chain.requireOwner(this.caller);
        if (seconds < MIN_QUEST_TTL || seconds > MAX_QUEST_TTL) throw new Revert("Quest TTL must be between 300 seconds and 30 days");
        this.chain.ttl = seconds;
      },
      onStatus,
    );
  }
  setPaused(paused: boolean, onStatus?: TxStatusListener) {
    return this.run(
      "pause",
      () => {
        this.chain.requireOwner(this.caller);
        this.chain.paused = paused;
      },
      onStatus,
    );
  }
  transferOwnership(newOwner: string, onStatus?: TxStatusListener) {
    return this.run(
      "transfer",
      () => {
        this.chain.requireOwner(this.caller);
        if (!/^0x[0-9a-fA-F]{40}$/.test(newOwner)) throw new Revert("Invalid address");
        if (newOwner.toLowerCase() === this.chain.owner.toLowerCase()) throw new Revert("Address is already the owner");
        this.chain.pendingOwner = newOwner;
      },
      onStatus,
    );
  }
  acceptOwnership(onStatus?: TxStatusListener) {
    return this.run(
      "accept",
      () => {
        if (!this.chain.pendingOwner) throw new Revert("No ownership transfer is pending");
        if (this.chain.pendingOwner.toLowerCase() !== this.caller.toLowerCase()) {
          throw new Revert("Only the pending owner can accept");
        }
        this.chain.owner = this.caller;
        this.chain.pendingOwner = "";
      },
      onStatus,
    );
  }
  cancelOwnershipTransfer(onStatus?: TxStatusListener) {
    return this.run(
      "cancel",
      () => {
        this.chain.requireOwner(this.caller);
        this.chain.pendingOwner = "";
      },
      onStatus,
    );
  }
}

// ------------------------------------------------------------------ seed
const SEED_PLAYERS = [
  "0x5eA1000000000000000000000000000000000101",
  "0x7b0C000000000000000000000000000000000202",
  "0x9a2F000000000000000000000000000000000303",
  "0xC4d8000000000000000000000000000000000404",
  "0xE17B000000000000000000000000000000000505",
];

const SEED_PLAYS: Array<[number, number, string]> = [
  [0, 0, "First I test each plank with my staff, then tie a rope to the sturdiest beam and cross slowly, one careful step at a time."],
  [1, 1, "I listen for the crystal notes, wedge my pick into the wall to brace the slab, then signal the others to retreat while I distract the singing stones with a lantern."],
  [2, 2, "I lower my lantern, check each reflection carefully, then chalk a plan on the floor and follow only the mirror that keeps its own light steady."],
  [0, 0, "I carefully inspect the bridge, then first lay my shield across the gap, test it, and cross slowly while holding the rope."],
  [3, 1, "I wait until the constructs settle, then slowly check each row, wedge a lantern behind the first one, and creep past while it is distracted."],
  [1, 0, "I first listen to the whispering, then plan which shelf the book moves toward, wait, and carefully take it when it settles."],
  [2, 1, "I check the eels first, then tie a rope to my belt, test the water slowly and follow the glow that dims for honest prices."],
  [4, 0, "I steady my breath and slowly test the floor, then brace against the wall and shield my lantern while I plan the next step."],
  [0, 2, "I carefully chalk the safe tiles, then wedge my shield in the gate, test it and slowly slip beneath while the smiths look away."],
  [3, 0, "I plan a route, then first check the rope, tie it carefully to the lantern hook and cross slowly."],
  [1, 1, "I test the stones first, then signal, brace, and carefully lead everyone through the gap while a lantern distracts the singing crystals."],
  [4, 2, "Simply teleport past everything with unstoppable magic."],
];

/** Builds a chain that already has a lively history. */
export function createSeededChain(options: DemoOptions = {}): DemoChain {
  const chain = new DemoChain({ ...options, stageDelayMs: 0 });
  chain.setSkew(-4 * 86_400);
  chain.fund(25n * GEN);
  SEED_PLAYS.forEach(([playerIndex, tier, text], index) => {
    const player = SEED_PLAYERS[playerIndex];
    chain.setSkew(-4 * 86_400 + index * 7 * 3600);
    const id = chain.start(player, tier, tierFee(chain.entryFee, tier));
    chain.submit(player, id, text);
    if (chain.resolve(id)) chain.claim(player, id);
  });
  // Two quests are still open so the live feed has something to show.
  chain.setSkew(-2400);
  chain.start(SEED_PLAYERS[2], 1, tierFee(chain.entryFee, 1));
  chain.setSkew(-700);
  const reviewing = chain.start(SEED_PLAYERS[4], 0, tierFee(chain.entryFee, 0));
  chain.submit(
    SEED_PLAYERS[4],
    reviewing,
    "I carefully check the floor, then plan a slow route along the wall and wait for the lantern spirits to pass.",
  );
  chain.setSkew(0);
  chain.setStageDelay(options.stageDelayMs ?? 420);
  return chain;
}
