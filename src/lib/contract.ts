/**
 * LiveGame: the GameApi implementation backed by a deployed GenDungeon v2
 * contract on GenLayer, spoken to through genlayer-js.
 *
 * Nothing in here touches the DOM, so the live end-to-end script imports it
 * unchanged from Node (via tsx).
 */

import { TransactionStatus } from "genlayer-js/types";
import type { TransactionHash } from "genlayer-js/types";
import type { AppGenLayerClient } from "./genlayerClient";
import type { GameApi } from "./api";
import {
  asList,
  normalizeConfig,
  normalizeHallEntry,
  normalizeHistoryItem,
  normalizeOpenQuest,
  normalizeQuest,
  normalizeStats,
  normalizeTier,
  normalizeTreasury,
} from "./normalize";
import { safeStringify, toBigInt, toNumber, toText } from "./format";
import { localActionProblem } from "./rules";
import { GameError, type TxOutcome, type TxStatusListener } from "./types";

const TERMINAL = new Set<string>([
  TransactionStatus.ACCEPTED,
  TransactionStatus.FINALIZED,
  TransactionStatus.UNDETERMINED,
  TransactionStatus.CANCELED,
  TransactionStatus.LEADER_TIMEOUT,
  TransactionStatus.VALIDATORS_TIMEOUT,
]);

const FAILED_STATUSES = new Set<string>([
  TransactionStatus.UNDETERMINED,
  TransactionStatus.CANCELED,
  TransactionStatus.LEADER_TIMEOUT,
  TransactionStatus.VALIDATORS_TIMEOUT,
]);

const ERROR_KEYS = new Set(["error", "stderr", "message", "result", "reason", "payload"]);

/** Result kinds of a contract call that mean the call ended in an error (a `UserError` reads as "rollback"). */
const FAILED_RESULT_KINDS = new Set(["rollback", "contract_error", "error", "no_leaders"]);

function leaderReceipts(receipt: any): any[] {
  const data = receipt?.consensus_data ?? receipt?.consensusData;
  const leader = data?.leader_receipt ?? data?.leaderReceipt;
  if (!leader) return [];
  return Array.isArray(leader) ? leader : [leader];
}

const QUORUM_CANCEL_TEXT = /cancell?ed after quorum/i;
const QUORUM_CANCEL_CODE = /CONSENSUS_VALIDATOR_QUORUM_REACHED/i;
const QUORUM_CANCEL_CAUSE = /QUORUM_REACHED/i;

/**
 * True for a (leader or validator) receipt that only records "this validator was stopped because a quorum had already
 * been reached". Such an entry carries `execution_result: "ERROR"` and a `stderr`, but it is not a failure of the
 * contract call: the other validators finished and voted, and the transaction is accepted.
 *
 * A bare `raw_error.fatal === false` is NOT enough on its own: an ordinary contract error (a Python exception inside the
 * VM, say) is non-fatal as well, and treating it as a cancellation would turn a real failure into a success. The
 * `fatal === false` marker therefore only counts together with a quorum cause.
 */
export function isQuorumCancellation(entry: any): boolean {
  if (!entry || typeof entry !== "object") return false;
  const genvm = entry.genvm_result ?? entry.genvmResult ?? entry.genvm;
  if (!genvm || typeof genvm !== "object") return false;
  if (QUORUM_CANCEL_CODE.test(String(genvm.error_code ?? genvm.errorCode ?? ""))) return true;
  const texts = [genvm.stderr, genvm.error_description, genvm.errorDescription];
  if (texts.some((text) => typeof text === "string" && QUORUM_CANCEL_TEXT.test(text))) return true;
  const raw = genvm.raw_error ?? genvm.rawError;
  const causes: unknown[] = Array.isArray(raw?.causes) ? raw.causes : [];
  return raw?.fatal === false && causes.some((cause) => QUORUM_CANCEL_CAUSE.test(String(cause)));
}

/** Digs a short, human-readable failure reason out of a receipt. */
export function extractRevertReason(receipt: unknown): string {
  const found: string[] = [];
  const seen = new Set<unknown>();
  const walk = (node: unknown, depth: number) => {
    if (depth > 6 || node === null || typeof node !== "object" || seen.has(node)) return;
    seen.add(node);
    // A validator that was cancelled after the quorum is bookkeeping, never the reason a call failed.
    if (isQuorumCancellation(node)) return;
    const entries: Array<[string, unknown]> =
      node instanceof Map ? Array.from(node.entries()).map(([k, v]) => [String(k), v]) : Object.entries(node);
    for (const [key, value] of entries) {
      if (
        typeof value === "string" &&
        ERROR_KEYS.has(key) &&
        value.trim() &&
        !/^0x[0-9a-f]*$/i.test(value) &&
        !QUORUM_CANCEL_TEXT.test(value)
      ) {
        found.push(value.trim());
      } else if (typeof value === "object") {
        walk(value, depth + 1);
      }
    }
  };
  walk(receipt, 0);
  const useful = found.find((text) => /[a-z]{3}/i.test(text) && !/^(success|agree|return)$/i.test(text));
  return (useful ?? describeLeaderFailure(receipt) ?? "The transaction failed on-chain.").slice(0, 300);
}

/** A compact account of a leader receipt when no readable reason was found, so a failure is never a blank. */
function describeLeaderFailure(receipt: any): string | undefined {
  const parts: string[] = [];
  for (const leader of leaderReceipts(receipt)) {
    if (isQuorumCancellation(leader)) continue;
    const outcome = [leader?.execution_result, leader?.result?.status].filter(Boolean).join("/");
    if (outcome) parts.push(`leader ${outcome}`);
    for (const key of ["stderr", "stdout"]) {
      const text = leader?.genvm_result?.[key];
      if (typeof text === "string" && text.trim()) parts.push(`${key}: ${text.trim().slice(-120)}`);
    }
  }
  const votes = (receipt?.consensus_data ?? receipt?.consensusData)?.votes;
  if (votes && typeof votes === "object") {
    const tally: Record<string, number> = {};
    for (const vote of Object.values(votes)) tally[String(vote)] = (tally[String(vote)] ?? 0) + 1;
    if (Object.keys(tally).length) parts.push(`votes ${JSON.stringify(tally)}`);
  }
  return parts.length ? `The transaction failed on-chain (${parts.join("; ")}).` : undefined;
}

/**
 * True when the receipt shows the contract call itself ended in an error.
 *
 * A reverted call still reaches the consensus status ACCEPTED: the validators agree that the call failed. Where the
 * failure is recorded depends on the network. A consensus-contract receipt carries `txExecutionResultName`; a Studio
 * receipt has no such field and records the outcome on the leader's receipt instead (`execution_result` is "ERROR"
 * and `result.status` is "rollback" for a `UserError`).
 *
 * The leader receipt can be a list: besides the leader's own run it may hold entries for validators that were
 * cancelled once a quorum had voted (`CONSENSUS_VALIDATOR_QUORUM_REACHED`). Those also read `ERROR`, but they say
 * nothing about the call, so they are skipped.
 */
export function receiptFailed(receipt: any): boolean {
  if (!receipt) return true;
  const status = String(receipt.statusName ?? receipt.status_name ?? receipt.status ?? "");
  if (FAILED_STATUSES.has(status)) return true;
  if (String(receipt.txExecutionResultName ?? "") === "FINISHED_WITH_ERROR") return true;
  for (const leader of leaderReceipts(receipt)) {
    if (isQuorumCancellation(leader)) continue;
    if (String(leader?.execution_result ?? leader?.executionResult ?? "").toUpperCase() === "ERROR") return true;
    const kind = leader?.result?.status ?? leader?.genvm_result?.status;
    if (typeof kind === "string" && FAILED_RESULT_KINDS.has(kind.toLowerCase())) return true;
  }
  return false;
}

const RATE_LIMIT = /rate limit|too many requests|\b429\b/i;

/** True for an RPC error that only asks the caller to slow down. */
export function isRateLimited(error: unknown): boolean {
  return RATE_LIMIT.test(error instanceof Error ? error.message : String(error));
}

const GATEWAY_HICCUP =
  /<!DOCTYPE|<html\b|Unexpected token '?<|Bad Gateway|Service (?:Temporarily )?Unavailable|Gateway Time-?out|\b(?:HTTP|status(?: code)?)[ :]*50[234]\b/i;

/**
 * True for a transient failure of the gateway in front of the node: HTTP 502/503/504, or an HTML error page where
 * JSON was expected (genlayer-js reports that as `Unexpected token '<', "<!DOCTYPE "... is not valid JSON`). The
 * request itself was fine, so, like a rate limit, it is worth repeating after a pause.
 */
export function isGatewayHiccup(error: unknown): boolean {
  return GATEWAY_HICCUP.test(error instanceof Error ? error.message : String(error));
}

/** True when the node could not decode the request payload (seen with long read arguments on Studio). */
export function isPayloadRejected(error: unknown): boolean {
  return /RLP|superfluous|invalid (?:data|params)/i.test(error instanceof Error ? error.message : String(error));
}

function friendly(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  if (/user rejected|denied|rejected the request/i.test(text)) return "The wallet request was rejected.";
  if (/insufficient funds|exceeds balance/i.test(text)) return "The account does not hold enough GEN to pay for this.";
  return text.slice(0, 300);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export interface LiveGameOptions {
  /** Poll interval for the transaction narrator and the receipt wait. */
  pollMs?: number;
  /** How long to wait for consensus before giving up, in milliseconds. */
  timeoutMs?: number;
  /** Invoked with every raw receipt (the E2E report keeps them). */
  onReceipt?: (functionName: string, receipt: unknown) => void;
}

export class LiveGame implements GameApi {
  readonly mode = "live" as const;
  readonly address: `0x${string}`;
  readonly caller: string;
  /** Where the last validateAction answer came from: the contract, or the local length rules after a payload error. */
  lastValidationSource: "chain" | "local" = "chain";
  private readonly reader: AppGenLayerClient;
  private readonly writer: AppGenLayerClient | null;
  private readonly pollMs: number;
  private readonly timeoutMs: number;
  private readonly onReceipt?: (functionName: string, receipt: unknown) => void;

  constructor(
    address: `0x${string}`,
    reader: AppGenLayerClient,
    writer: AppGenLayerClient | null = null,
    caller = "",
    options: LiveGameOptions = {},
  ) {
    this.address = address;
    this.reader = reader;
    this.writer = writer;
    this.caller = caller;
    this.pollMs = options.pollMs ?? 1500;
    this.timeoutMs = options.timeoutMs ?? 6 * 60_000;
    this.onReceipt = options.onReceipt;
  }

  // ------------------------------------------------------------------ reads
  private async read(functionName: string, args: unknown[] = []): Promise<unknown> {
    let lastError: unknown;
    for (let attempt = 0; attempt < 6; attempt++) {
      try {
        return await this.reader.readContract({
          address: this.address,
          functionName,
          args: args as any[],
        });
      } catch (error) {
        lastError = error;
        // A request the node cannot decode will not decode on a retry either.
        if (isPayloadRejected(error)) break;
        // A rate limit needs a real pause (the public endpoint allows 30 requests a minute), and so does a gateway
        // hiccup (a 502/503/504 or an HTML page instead of JSON); other errors a short one.
        await sleep(isRateLimited(error) || isGatewayHiccup(error) ? 4000 * (attempt + 1) : 250 * (attempt + 1));
      }
    }
    throw new GameError(`Read of ${functionName} failed: ${friendly(lastError)}`);
  }

  async getVersion() {
    return toText(await this.read("get_version"));
  }
  async getOwner() {
    return toText(await this.read("get_owner"));
  }
  async getPendingOwner() {
    return toText(await this.read("get_pending_owner"));
  }
  async getConfig() {
    return normalizeConfig(await this.read("get_config"));
  }
  async getTreasury() {
    return normalizeTreasury(await this.read("get_treasury"));
  }
  async getTiers() {
    return asList(await this.read("get_tiers")).map(normalizeTier);
  }
  async quoteReward(tier: number, score: number) {
    return toBigInt(await this.read("quote_reward", [tier, score]));
  }
  async validateAction(action: string) {
    try {
      const answer = toText(await this.read("validate_action", [action]));
      this.lastValidationSource = "chain";
      return answer;
    } catch (error) {
      // The dry-run is a convenience; submit_action runs the same checks on-chain. When the node refuses to decode
      // a long argument, fall back to the length rules so the caller is not blocked by a read.
      if (isPayloadRejected(error)) {
        this.lastValidationSource = "local";
        return localActionProblem(action);
      }
      throw error;
    }
  }
  async getQuest(questId: number) {
    return normalizeQuest(await this.read("get_quest", [questId]));
  }
  async getActiveQuestId(player: string) {
    return toNumber(await this.read("get_player_active_quest", [player]));
  }
  async getStats(player: string) {
    return normalizeStats(await this.read("get_player_stats", [player]));
  }
  async getHistory(player: string, limit: number) {
    return asList(await this.read("get_player_history", [player, limit])).map(normalizeHistoryItem);
  }
  async listOpenQuests(limit: number) {
    return asList(await this.read("list_active_quests", [limit])).map(normalizeOpenQuest);
  }
  async getHall() {
    return asList(await this.read("get_hall_of_fame")).map(normalizeHallEntry);
  }

  // ----------------------------------------------------------------- writes
  private async send(
    functionName: string,
    args: unknown[],
    value: bigint,
    onStatus?: TxStatusListener,
  ): Promise<TxOutcome> {
    if (!this.writer) throw new GameError("Connect a wallet first.");

    let hash: TransactionHash;
    try {
      hash = (await this.writer.writeContract({
        address: this.address,
        functionName,
        args: args as any[],
        value,
      })) as TransactionHash;
    } catch (error) {
      throw new GameError(friendly(error));
    }

    onStatus?.(TransactionStatus.PENDING);
    const stopNarrator = this.narrate(hash, onStatus);
    try {
      const receipt: any = await this.writer.waitForTransactionReceipt({
        hash,
        status: TransactionStatus.ACCEPTED,
        interval: this.pollMs,
        retries: Math.ceil(this.timeoutMs / this.pollMs),
      });
      this.onReceipt?.(functionName, receipt);
      const status = String(receipt?.statusName ?? receipt?.status ?? "ACCEPTED");
      onStatus?.(status);
      if (receiptFailed(receipt)) {
        return { hash, status, ok: false, error: extractRevertReason(receipt) };
      }
      return { hash, status, ok: true };
    } catch (error) {
      throw new GameError(friendly(error));
    } finally {
      stopNarrator();
    }
  }

  /** Streams intermediate consensus states to the UI while a receipt is pending. */
  private narrate(hash: TransactionHash, onStatus?: TxStatusListener): () => void {
    if (!onStatus) return () => undefined;
    let stopped = false;
    void (async () => {
      let last = "";
      while (!stopped) {
        try {
          const tx: any = await this.reader.getTransaction({ hash });
          const status = String(tx?.statusName ?? tx?.status ?? "");
          if (status && status !== last) {
            last = status;
            onStatus(status);
          }
          if (TERMINAL.has(status)) return;
        } catch {
          // Not indexed yet; try again on the next tick.
        }
        await sleep(this.pollMs);
      }
    })();
    return () => {
      stopped = true;
    };
  }

  startQuest(tier: number, value: bigint, onStatus?: TxStatusListener) {
    return this.send("start_quest", [tier], value, onStatus);
  }
  submitAction(questId: number, action: string, onStatus?: TxStatusListener) {
    return this.send("submit_action", [questId, action], 0n, onStatus);
  }
  resolveQuest(questId: number, onStatus?: TxStatusListener) {
    return this.send("resolve_quest", [questId], 0n, onStatus);
  }
  claimReward(questId: number, onStatus?: TxStatusListener) {
    return this.send("claim_reward", [questId], 0n, onStatus);
  }
  surrenderQuest(onStatus?: TxStatusListener) {
    return this.send("surrender_quest", [], 0n, onStatus);
  }
  expireQuest(questId: number, onStatus?: TxStatusListener) {
    return this.send("expire_quest", [questId], 0n, onStatus);
  }
  fundPool(value: bigint, onStatus?: TxStatusListener) {
    return this.send("fund_pool", [], value, onStatus);
  }
  setFeeAndRewards(entryFee: bigint, minReward: bigint, maxReward: bigint, onStatus?: TxStatusListener) {
    return this.send("set_fee_and_rewards", [entryFee, minReward, maxReward], 0n, onStatus);
  }
  setPayoutCap(bps: number, onStatus?: TxStatusListener) {
    return this.send("set_payout_cap", [bps], 0n, onStatus);
  }
  setQuestTtl(seconds: number, onStatus?: TxStatusListener) {
    return this.send("set_quest_ttl", [seconds], 0n, onStatus);
  }
  setPaused(paused: boolean, onStatus?: TxStatusListener) {
    return this.send("set_paused", [paused], 0n, onStatus);
  }
  transferOwnership(newOwner: string, onStatus?: TxStatusListener) {
    return this.send("transfer_ownership", [newOwner], 0n, onStatus);
  }
  acceptOwnership(onStatus?: TxStatusListener) {
    return this.send("accept_ownership", [], 0n, onStatus);
  }
  cancelOwnershipTransfer(onStatus?: TxStatusListener) {
    return this.send("cancel_ownership_transfer", [], 0n, onStatus);
  }
}

/** Debug helper: a receipt as readable JSON. */
export function describeReceipt(receipt: unknown): string {
  return safeStringify(receipt);
}

/** True when the deployed contract exposes the v2 API. */
export async function detectVersion(game: Pick<GameApi, "getVersion">): Promise<"v2" | "legacy"> {
  try {
    const version = await game.getVersion();
    return version.startsWith("2.") ? "v2" : "legacy";
  } catch {
    return "legacy";
  }
}
