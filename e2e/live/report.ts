/**
 * Turns a finished (or interrupted, or blocked) run into a report that can be
 * committed next to the code: one Markdown file for people, one JSON file for
 * tooling, and a plain log.
 *
 * A report always says what it is evidence of. A run against the in-memory
 * simulation is labelled as such and is never presented as an on-chain result.
 */

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { CheckRecord, Recorder } from "./harness";

export type RunStatus = "PASSED" | "FAILED" | "BLOCKED" | "INTERRUPTED";

export interface RunMeta {
  target: "live" | "demo";
  status: RunStatus;
  network: string;
  address: string;
  deployTx: string;
  startedAt: string;
  finishedAt: string;
  quick: boolean;
  maxAttempts: number;
  /** Why a run could not start or finish (BLOCKED / INTERRUPTED). */
  reason?: string;
  schemaMethods?: number;
}

export interface Fingerprint {
  contractSha256: string;
  gitCommit: string;
  node: string;
  platform: string;
}

export function fingerprintEnvironment(root: string): Fingerprint {
  const code = readFileSync(resolve(root, "contracts/GenDungeon.py"));
  let gitCommit = "unknown";
  try {
    gitCommit = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: root, stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
    const dirty = execFileSync("git", ["status", "--porcelain"], { cwd: root, stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    if (dirty) gitCommit += " (uncommitted changes present)";
  } catch {
    /* not a git checkout */
  }
  return {
    contractSha256: createHash("sha256").update(code).digest("hex"),
    gitCommit,
    node: process.version,
    platform: `${process.platform}/${process.arch}`,
  };
}

const esc = (text: string) => text.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
const short = (hash: string) => (hash.length > 18 ? `${hash.slice(0, 10)}…${hash.slice(-6)}` : hash);

const ICON: Record<string, string> = { PASS: "PASS", FAIL: "**FAIL**", SKIP: "skip", OBSERVED: "observed" };

function banner(meta: RunMeta): string {
  if (meta.target === "demo") {
    return [
      "> **SIMULATION RUN. This is not on-chain evidence.**",
      "> These checks ran against the in-memory model of the contract that ships with the web app. They prove the scenarios",
      "> and this report generator work, nothing more. Run `npm run e2e:live` against GenLayer Studio to produce a real report.",
    ].join("\n");
  }
  if (meta.status === "BLOCKED") {
    return [
      "> **BLOCKED. No checks were executed.**",
      `> ${meta.reason ?? "The network could not be reached."}`,
      "> Nothing in this file is evidence about the contract.",
    ].join("\n");
  }
  if (meta.status === "INTERRUPTED") {
    return [
      "> **INTERRUPTED. The run did not finish.**",
      `> ${meta.reason ?? "The run was stopped early."} The table lists only the checks that completed.`,
    ].join("\n");
  }
  return `> Live run against **${meta.network}**. Every transaction hash below can be looked up on that network.`;
}

function verdictLine(meta: RunMeta, s: Recorder["summary"]): string {
  if (meta.status === "BLOCKED") return "**Result: BLOCKED** (no checks ran)";
  const counts = `${s.pass} passed, ${s.fail} failed, ${s.skip} skipped, ${s.observed} observed`;
  return `**Result: ${meta.status}** (${counts})`;
}

export function renderMarkdown(meta: RunMeta, env: Fingerprint, rec: Recorder, logName: string): string {
  const s = rec.summary;
  const out: string[] = [];
  const title = meta.target === "demo" ? "GenDungeon end-to-end report (simulation)" : "GenDungeon end-to-end report";
  out.push(`# ${title}`, "", banner(meta), "", verdictLine(meta, s), "");

  out.push("## Environment", "", "| | |", "|---|---|");
  const row = (k: string, v: string) => out.push(`| ${k} | ${esc(v)} |`);
  row("Target", meta.target === "live" ? "GenLayer (live)" : "in-memory simulation");
  row("Network", meta.network);
  row("Contract address", meta.address || "n/a");
  row("Deployment transaction", meta.deployTx || "n/a");
  row("Contract SHA-256", env.contractSha256);
  row("Repository commit", env.gitCommit);
  row("Started", meta.startedAt);
  row("Finished", meta.finishedAt);
  row("Mode", `${meta.quick ? "quick" : "full"}, up to ${meta.maxAttempts} play attempt(s) to obtain a victory`);
  row("Runtime", `Node ${env.node} on ${env.platform}`);
  if (meta.schemaMethods !== undefined) row("Public methods parsed by the network", String(meta.schemaMethods));
  out.push("");

  const failed = rec.checks.filter((c) => c.outcome === "FAIL");
  if (failed.length > 0) {
    out.push("## Failures", "");
    for (const c of failed) out.push(`- **${c.id}** ${c.title}: ${esc(c.note)}`);
    out.push("");
  }

  if (rec.checks.length > 0) {
    out.push("## Results", "", "| ID | Kind | Check | Result | Time | Txs |", "|---|---|---|---|---|---|");
    for (const c of rec.checks) {
      out.push(`| ${c.id} | ${c.kind} | ${esc(c.title)} | ${ICON[c.outcome]} | ${(c.ms / 1000).toFixed(1)}s | ${c.txs.length} |`);
    }
    out.push("");

    out.push("## Details", "");
    for (const c of rec.checks) out.push(...detail(c));
  }

  const observed = rec.checks.filter((c) => c.outcome === "OBSERVED");
  if (observed.length > 0) {
    out.push(
      "## Observations",
      "",
      "Observations record what the AI judges did. They are reported, not asserted, because a model's answer is not a property the test can demand.",
      "",
    );
    for (const c of observed) out.push(`- **${c.id}** ${c.title}: ${esc(c.note)}`);
    out.push("");
  }

  const skipped = rec.checks.filter((c) => c.outcome === "SKIP");
  if (skipped.length > 0) {
    out.push("## Skipped", "");
    for (const c of skipped) out.push(`- **${c.id}** ${c.title}: ${esc(c.note)}`);
    out.push("");
  }

  const facts = Object.entries(rec.facts);
  if (facts.length > 0) {
    out.push("## Final contract state", "", "| | |", "|---|---|");
    for (const [k, v] of facts) out.push(`| ${k} | ${esc(v)} |`);
    out.push("");
  }

  out.push(
    "## Reproduce",
    "",
    "```bash",
    "npm ci",
    meta.target === "live" ? "npm run e2e:live      # deploys a fresh contract and runs every scenario" : "npm run e2e:dry       # simulation only",
    "```",
    "",
    `Full console output: \`${logName}\``,
    "",
  );
  return out.join("\n");
}

function detail(c: CheckRecord): string[] {
  const lines = [`### ${c.id}. ${c.title}`, "", `Kind: ${c.kind}. Result: ${c.outcome}.`];
  if (c.note) lines.push("", esc(c.note));
  if (c.txs.length > 0) {
    lines.push("", "| Call | Transaction | Outcome |", "|---|---|---|");
    for (const t of c.txs) {
      const result = t.ok ? "accepted" : `rejected (${esc((t.error ?? t.status).slice(0, 90))})`;
      lines.push(`| ${t.method} | ${t.hash ? `\`${t.hash}\`` : "none"} | ${result} |`);
    }
  }
  lines.push("");
  return lines;
}

export function renderJson(meta: RunMeta, env: Fingerprint, rec: Recorder): string {
  return JSON.stringify(
    { schema: 1, meta, environment: env, summary: rec.summary, facts: rec.facts, checks: rec.checks },
    null,
    2,
  );
}

export interface WrittenReport {
  markdown: string;
  json: string;
  log: string;
}

export function writeReport(
  outDir: string,
  meta: RunMeta,
  env: Fingerprint,
  rec: Recorder,
  transcript: string[],
): WrittenReport {
  mkdirSync(outDir, { recursive: true });
  const stamp = meta.startedAt.replace(/[:.]/g, "-").replace(/Z$/, "Z");
  const label = meta.target === "live" ? "live" : "simulation";
  const base = `e2e-${stamp}-${label}`;
  const markdown = join(outDir, `${base}.md`);
  const json = join(outDir, `${base}.json`);
  const log = join(outDir, `${base}.log`);
  writeFileSync(log, transcript.join("\n") + "\n");
  writeFileSync(markdown, renderMarkdown(meta, env, rec, `${base}.log`));
  writeFileSync(json, renderJson(meta, env, rec));
  const latest = join(outDir, `LATEST-${label}.md`);
  copyFileSync(markdown, latest);
  if (!existsSync(latest)) throw new Error("could not write the latest-report copy");
  return { markdown, json, log };
}
