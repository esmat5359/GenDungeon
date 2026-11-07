/**
 * Two ways to build the cast of accounts the suites play with:
 *   - createLiveWorld: deploys contracts/GenDungeon.py to GenLayer and drives it
 *     through genlayer-js (the real thing; needs network access).
 *   - createDemoWorld: runs the very same suites against the in-memory
 *     simulation, which checks the harness and the report without a network.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createAccount, createClient, generatePrivateKey } from "genlayer-js";
import { localnet, studionet } from "genlayer-js/chains";
import { TransactionStatus } from "genlayer-js/types";
import type { GameApi } from "../../src/lib/api";
import { LiveGame, receiptFailed, extractRevertReason } from "../../src/lib/contract";
import { DEMO_ADVENTURER, DEMO_KEEPER, DemoChain } from "../../src/lib/demo";
import { isAddress } from "../../src/lib/env";
import { safeStringify, weiToGen } from "../../src/lib/format";
import { sleep, type World } from "./harness";
import { installRpcThrottle } from "./throttle";

const here = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(here, "../..");

const ENTRY_FEE = 1_000_000_000_000_000n; // 0.001 GEN
const MIN_REWARD = 1_500_000_000_000_000n;
const MAX_REWARD = 6_000_000_000_000_000n;
const SEED_DEPOSIT = 20_000_000_000_000_000n;
export const ECONOMY = { entryFee: ENTRY_FEE, minReward: MIN_REWARD, maxReward: MAX_REWARD, seedDeposit: SEED_DEPOSIT };

export interface WorldOptions {
  quick: boolean;
  maxAttempts: number;
  log: (line: string) => void;
}

// ------------------------------------------------------------------ demo
export interface DemoWorld extends World {
  carol: GameApi;
}

export function createDemoWorld(options: WorldOptions): DemoWorld {
  const chain = new DemoChain({ stageDelayMs: 0 });
  chain.entryFee = ENTRY_FEE;
  chain.minReward = MIN_REWARD;
  chain.maxReward = MAX_REWARD;
  const wallet = (n: number) => `0x${n.toString(16).padStart(40, "0")}`;
  return {
    target: "demo",
    networkLabel: "in-memory simulation (no network)",
    address: chain.address,
    deployTx: "",
    owner: chain.api(DEMO_KEEPER),
    alice: chain.api(DEMO_ADVENTURER),
    bob: chain.api(wallet(0xb0b)),
    carol: chain.api(wallet(0xca701)),
    lastReceiptText: () => "",
    advanceClock: async (seconds: number) => chain.advance(seconds),
    wallClockWaitAllowed: false,
    economy: { entryFee: ENTRY_FEE, minReward: MIN_REWARD, maxReward: MAX_REWARD },
    quick: options.quick,
    maxAttempts: options.maxAttempts,
  };
}

// ------------------------------------------------------------------ live
const KEY_FILE = resolve(ROOT, ".e2e/accounts.json");

interface Keys {
  owner: `0x${string}`;
  alice: `0x${string}`;
  bob: `0x${string}`;
  carol: `0x${string}`;
}

function loadKeys(log: (line: string) => void): Keys {
  const fromEnv = process.env.E2E_KEYS?.split(",").map((k) => k.trim()).filter(Boolean);
  if (fromEnv && fromEnv.length >= 4) {
    const [owner, alice, bob, carol] = fromEnv as `0x${string}`[];
    return { owner, alice, bob, carol };
  }
  if (existsSync(KEY_FILE)) return JSON.parse(readFileSync(KEY_FILE, "utf8")) as Keys;
  const keys: Keys = {
    owner: generatePrivateKey(),
    alice: generatePrivateKey(),
    bob: generatePrivateKey(),
    carol: generatePrivateKey(),
  };
  mkdirSync(dirname(KEY_FILE), { recursive: true });
  writeFileSync(KEY_FILE, JSON.stringify(keys, null, 2), { mode: 0o600 });
  log(`  generated four throwaway accounts in ${KEY_FILE} (git-ignored)`);
  return keys;
}

type Client = ReturnType<typeof createClient>;

async function balanceOf(client: Client, address: string): Promise<bigint | null> {
  try {
    return await (client as unknown as { getBalance: (a: { address: string }) => Promise<bigint> }).getBalance({ address });
  } catch {
    return null;
  }
}

async function ensureFunded(client: Client, label: string, address: string, log: (line: string) => void) {
  const wanted = BigInt(process.env.E2E_MIN_BALANCE_WEI ?? "50000000000000000"); // 0.05 GEN
  const before = await balanceOf(client, address);
  if (before !== null && before >= wanted) {
    log(`  ${label} ${address} holds ${weiToGen(before, 4)} GEN`);
    return;
  }
  // The faucet method takes a plain number and the unit differs between releases, so try a short ladder
  // of amounts and stop as soon as the balance is high enough.
  const ladder = process.env.E2E_FAUCET_AMOUNT ? [Number(process.env.E2E_FAUCET_AMOUNT)] : [100, 1_000_000, 1e18];
  let accepted = false;
  let readable = false;
  for (const value of ladder) {
    try {
      await (client as unknown as { request: (a: unknown) => Promise<unknown> }).request({
        method: "sim_fundAccount",
        params: [address, value],
      });
      accepted = true;
    } catch {
      continue;
    }
    await sleep(1500);
    const after = await balanceOf(client, address);
    if (after !== null) readable = true;
    if (after !== null && after >= wanted) {
      log(`  funded ${label} ${address} (${weiToGen(after, 4)} GEN)`);
      return;
    }
  }
  if (accepted && !readable) {
    log(`  funded ${label} ${address} (the balance cannot be read here, so it was not confirmed)`);
    return;
  }
  log(
    `  WARNING: could not fund ${label} ${address} automatically. ` +
      `Use the faucet in GenLayer Studio, or set E2E_FAUCET_AMOUNT, then re-run.`,
  );
}

function findDeployedAddress(receipt: any, exclude: string[]): `0x${string}` | null {
  const skip = new Set(exclude.map((a) => a.toLowerCase()));
  const zero = "0x0000000000000000000000000000000000000000";
  const candidates: unknown[] = [
    receipt?.data?.contract_address,
    receipt?.data?.contractAddress,
    receipt?.txDataDecoded?.contractAddress,
    receipt?.to_address,
    receipt?.recipient,
  ];
  for (const c of candidates) {
    if (isAddress(c) && c.toLowerCase() !== zero && !skip.has(c.toLowerCase())) return c;
  }
  const text = safeStringify(receipt);
  const named = /"(?:contract_address|contractAddress|to_address|recipient)":\s*"(0x[0-9a-fA-F]{40})"/g;
  for (const m of text.matchAll(named)) {
    if (m[1].toLowerCase() !== zero && !skip.has(m[1].toLowerCase())) return m[1] as `0x${string}`;
  }
  return null;
}

export async function createLiveWorld(options: WorldOptions): Promise<World & { carol: GameApi; contractSchemaMethods: string[] }> {
  const { log } = options;
  const networkName = (process.env.GENLAYER_NETWORK ?? "studionet").toLowerCase();
  const chain = networkName === "localnet" ? localnet : studionet;
  const endpoint = process.env.GENLAYER_RPC;
  const keys = loadKeys(log);

  const make = (key: `0x${string}`) =>
    createClient({ chain, account: createAccount(key), ...(endpoint ? { endpoint } : {}) }) as Client;
  const clients = { owner: make(keys.owner), alice: make(keys.alice), bob: make(keys.bob), carol: make(keys.carol) };
  const addrs = {
    owner: createAccount(keys.owner).address,
    alice: createAccount(keys.alice).address,
    bob: createAccount(keys.bob).address,
    carol: createAccount(keys.carol).address,
  };

  // The public endpoint allows 30 requests a minute; stay below it and retry when it still asks to slow down.
  const perMinute = Math.max(1, Number(process.env.E2E_RPC_PER_MIN ?? 24));
  installRpcThrottle({
    urls: [chain.rpcUrls.default.http[0], ...(endpoint ? [endpoint] : [])],
    perWindow: perMinute,
    log,
  });
  log(`  network: ${chain.name ?? networkName} (${endpoint ?? "default endpoint"}), at most ${perMinute} requests a minute`);
  for (const role of ["owner", "alice", "bob", "carol"] as const) {
    await ensureFunded(clients[role], role, addrs[role], log);
  }

  const code = readFileSync(resolve(ROOT, "contracts/GenDungeon.py"), "utf8");
  let contractSchemaMethods: string[] = [];
  try {
    const schema: any = await clients.owner.getContractSchemaForCode(code);
    contractSchemaMethods = Object.keys(schema?.methods ?? {});
    log(`  the network parsed the contract: ${contractSchemaMethods.length} public methods`);
  } catch (error) {
    log(`  schema check skipped: ${error instanceof Error ? error.message : String(error)}`);
  }

  const timeoutMs = Number(process.env.E2E_TX_TIMEOUT_MS ?? 10 * 60_000);
  let address: `0x${string}`;
  let deployHash = "";
  const existing = process.env.E2E_CONTRACT;
  if (existing) {
    if (!isAddress(existing)) throw new Error("E2E_CONTRACT is not a valid address");
    address = existing;
    log(`  using the contract already deployed at ${address} (E2E_CONTRACT); it must have been deployed by the owner key with the constructor arguments ${ENTRY_FEE}, ${MIN_REWARD}, ${MAX_REWARD}`);
  } else {
    log("  deploying contracts/GenDungeon.py ...");
    const hash = (await clients.owner.deployContract({
      code,
      args: [ENTRY_FEE, MIN_REWARD, MAX_REWARD],
    })) as unknown as `0x${string}` & { length: 66 };
    deployHash = hash;
    const receipt: any = await clients.owner.waitForTransactionReceipt({
      hash,
      status: TransactionStatus.ACCEPTED,
      interval: 4000,
      retries: Math.ceil(timeoutMs / 4000),
    });
    if (receiptFailed(receipt)) throw new Error(`deployment failed: ${extractRevertReason(receipt)}`);
    const found = findDeployedAddress(receipt, Object.values(addrs));
    if (!found) {
      log(`  receipt: ${safeStringify(receipt).slice(0, 3000)}`);
      throw new Error(
        `deployment ${hash} was accepted but the contract address was not found in the receipt. ` +
          "Copy the address from GenLayer Studio and re-run with E2E_CONTRACT=<address>.",
      );
    }
    address = found;
    log(`  deployed at ${address} (tx ${hash})`);
  }

  let lastReceipt = "";
  const onReceipt = (_fn: string, r: unknown) => {
    lastReceipt = safeStringify(r);
  };
  const game = (role: keyof typeof clients): GameApi =>
    new LiveGame(address, clients[role], clients[role], addrs[role], { pollMs: 4000, timeoutMs, onReceipt });

  const owner = game("owner");
  // Wait until the freshly deployed contract answers reads.
  for (let i = 0; i < 60; i++) {
    try {
      if ((await owner.getVersion()).startsWith("2.")) break;
    } catch {
      /* not indexed yet */
    }
    await sleep(2000);
  }

  return {
    target: "live",
    networkLabel: `${chain.name ?? networkName}${endpoint ? ` at ${endpoint}` : ""}`,
    address,
    deployTx: deployHash,
    owner,
    alice: game("alice"),
    bob: game("bob"),
    carol: game("carol"),
    lastReceiptText: () => lastReceipt,
    wallClockWaitAllowed: process.env.E2E_SLOW === "1",
    economy: { entryFee: ENTRY_FEE, minReward: MIN_REWARD, maxReward: MAX_REWARD },
    quick: options.quick,
    maxAttempts: options.maxAttempts,
    contractSchemaMethods,
  };
}
