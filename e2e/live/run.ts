/**
 * Entry point of the end-to-end run.
 *
 *   npm run e2e:live            deploy a fresh contract to GenLayer and run every scenario
 *   npm run e2e:live -- --quick shorter run (fewer attacks, no observation)
 *   npm run e2e:dry             same scenarios against the in-memory simulation
 *
 * Environment (all optional):
 *   GENLAYER_NETWORK     studionet (default) or localnet
 *   GENLAYER_RPC         override the RPC endpoint
 *   E2E_KEYS             four comma separated private keys: owner,alice,bob,carol
 *   E2E_MAX_ATTEMPTS     plays tried before giving up on a victory (default 3)
 *   E2E_TIMEOUT_MIN      hard limit for the whole run (default 90)
 *   E2E_TX_TIMEOUT_MS    wait per transaction (default 600000)
 *   E2E_SLOW=1           also wait out the real quest time limit (about 5 minutes)
 *   E2E_CONTRACT=0x...   use a contract you deployed yourself instead of deploying a fresh one
 *
 * Exit codes: 0 every check passed, 1 at least one check failed or the run was
 * interrupted, 2 the network could not be reached (nothing was tested).
 */

import { resolve } from "node:path";
import { studionet, localnet } from "genlayer-js/chains";
import { Recorder } from "./harness";
import { fingerprintEnvironment, writeReport, type RunMeta, type RunStatus } from "./report";
import { ROOT, createDemoWorld, createLiveWorld } from "./world";
import { runSuites } from "./suites";

interface Args {
  dry: boolean;
  quick: boolean;
  out: string;
  maxAttempts: number;
  timeoutMin: number;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    dry: false,
    quick: false,
    out: resolve(ROOT, "reports"),
    maxAttempts: Math.max(1, Number(process.env.E2E_MAX_ATTEMPTS ?? 3)),
    timeoutMin: Math.max(1, Number(process.env.E2E_TIMEOUT_MIN ?? 90)),
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run" || a === "--demo") args.dry = true;
    else if (a === "--quick") args.quick = true;
    else if (a === "--out") args.out = resolve(argv[++i] ?? "reports");
    else if (a === "--max-attempts") args.maxAttempts = Math.max(1, Number(argv[++i]));
    else if (a === "--help" || a === "-h") {
      console.log("usage: tsx e2e/live/run.ts [--dry-run] [--quick] [--out DIR] [--max-attempts N]");
      process.exit(0);
    } else {
      console.error(`unknown argument: ${a}`);
      process.exit(2);
    }
  }
  return args;
}

async function checkReachable(): Promise<string | null> {
  const name = (process.env.GENLAYER_NETWORK ?? "studionet").toLowerCase();
  const chain = name === "localnet" ? localnet : studionet;
  const url = process.env.GENLAYER_RPC ?? chain.rpcUrls.default.http[0];
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
      signal: AbortSignal.timeout(20_000),
    });
    // Any HTTP answer means the host is reachable; the JSON body is not inspected here.
    void response.status;
    return null;
  } catch (error) {
    const cause = (error as { cause?: { code?: string; message?: string } }).cause;
    const detail = cause?.code ?? cause?.message ?? (error instanceof Error ? error.message : String(error));
    return `The RPC endpoint ${url} could not be reached from this machine (${detail}).`;
  }
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  const transcript: string[] = [];
  const stamp = () => new Date().toISOString().slice(11, 19);
  const log = (line: string) => {
    const text = line.startsWith("\n") || line === "" ? line : `${stamp()} ${line}`;
    transcript.push(text);
    console.log(text);
  };

  const rec = new Recorder(log);
  const env = fingerprintEnvironment(ROOT);
  const startedAt = new Date().toISOString();
  const target = args.dry ? "demo" : "live";

  const meta: RunMeta = {
    target,
    status: "FAILED",
    network: args.dry ? "in-memory simulation (no network)" : `${process.env.GENLAYER_NETWORK ?? "studionet"}`,
    address: "",
    deployTx: "",
    startedAt,
    finishedAt: startedAt,
    quick: args.quick,
    maxAttempts: args.maxAttempts,
  };

  let finalized = false;
  const finalize = (status: RunStatus, reason?: string): number => {
    if (finalized) return 0;
    finalized = true;
    meta.status = status;
    meta.reason = reason;
    meta.finishedAt = new Date().toISOString();
    const files = writeReport(args.out, meta, env, rec, transcript);
    const s = rec.summary;
    log(`\n${status}: ${s.pass} passed, ${s.fail} failed, ${s.skip} skipped, ${s.observed} observed`);
    log(`report: ${files.markdown}`);
    return status === "PASSED" ? 0 : status === "BLOCKED" ? 2 : 1;
  };

  const interrupt = (why: string) => {
    const running = rec.running ? ` while running ${rec.running}` : "";
    process.exitCode = finalize("INTERRUPTED", `${why}${running}`);
    setTimeout(() => process.exit(process.exitCode ?? 1), 200);
  };
  const timer = setTimeout(() => interrupt(`The ${args.timeoutMin} minute limit was reached`), args.timeoutMin * 60_000);
  timer.unref();
  process.once("SIGINT", () => interrupt("The run was cancelled"));
  process.once("SIGTERM", () => interrupt("The run was terminated"));

  log(`GenDungeon end-to-end run (${args.dry ? "simulation" : "live"}${args.quick ? ", quick" : ""})`);
  log(`contract sha256 ${env.contractSha256.slice(0, 16)}…  commit ${env.gitCommit}  node ${env.node}`);

  try {
    if (!args.dry) {
      log("checking that the network is reachable ...");
      const problem = await checkReachable();
      if (problem) {
        log(`  ${problem}`);
        return finalize("BLOCKED", `${problem} Run this script from a machine with internet access, for example a GitHub Codespace.`);
      }
    }

    const options = { quick: args.quick, maxAttempts: args.maxAttempts, log };
    const world = args.dry ? createDemoWorld(options) : await createLiveWorld(options);
    meta.network = world.networkLabel;
    meta.address = world.address;
    meta.deployTx = world.deployTx;
    const methods = (world as { contractSchemaMethods?: string[] }).contractSchemaMethods;
    if (methods) meta.schemaMethods = methods.length;
    log(`  contract ${world.address || "(simulated)"}`);

    await runSuites(world, rec);
    const s = rec.summary;
    return finalize(s.fail === 0 ? "PASSED" : "FAILED");
  } catch (error) {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    log(`\nThe run stopped with an error before all checks completed:\n${message}`);
    rec.checks.push({
      id: "SETUP",
      kind: "functional",
      title: "Run setup and execution",
      outcome: "FAIL",
      ms: 0,
      note: error instanceof Error ? error.message : String(error),
      txs: [],
    });
    return finalize("FAILED", "A setup or execution error stopped the run.");
  } finally {
    clearTimeout(timer);
  }
}

main().then(
  (code) => process.exit(code),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
