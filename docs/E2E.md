# Live end-to-end suite

`e2e/live/` deploys a **fresh** copy of the contract to GenLayer, plays it with four accounts, attacks it, and writes a
report you can commit as evidence.

> **Status of this suite.** The first live run on Studio (see `reports/`) exposed three problems in the script itself,
> all fixed since:
>
> 1. **Reverted calls were reported as accepted.** On Studio a call that the contract refuses still reaches the
>    consensus status `ACCEPTED`; the refusal is recorded on the leader's receipt (`execution_result` is `ERROR`,
>    `result.status` is `rollback`). The first version only looked at `txExecutionResultName`, which Studio does not
>    send, so every attack check (`A01` to `A11`) saw "accepted" and failed even though the contract had refused the
>    call and the state was untouched.
> 2. **The public endpoint allows 30 requests a minute.** Polling every two seconds and many reads exceeded it. The run
>    now spaces requests (default 24 a minute, `E2E_RPC_PER_MIN`), polls every four seconds, and retries a
>    rate-limited answer with a growing pause.
> 3. **Read arguments of a few hundred bytes were rejected by the node** (`RLP string ends with … superfluous bytes`),
>    while short ones worked. The suite now uses compact plans, falls back to the local length rules when a
>    `validate_action` read is refused, and records which lengths the node accepts (`P01`, `O02`).
>
> Findings from the second live run: long **writes** work (`O02`), long **reads** above roughly 200 characters are refused by
> the node, and `resolve_quest` sometimes fails for infrastructure reasons (validators cancelled after a quorum), so the suite
> retries it.
>
> Treat the next live run as the first real test of those fixes.

## Run it in a GitHub Codespace

1. On the repository page choose **Code → Codespaces → Create codespace on main**. The dev container installs Node 22,
   Python 3.13, `npm ci` and the Python test requirements.
2. In the terminal:

   ```bash
   npm run e2e:live            # full run
   # or
   npm run e2e:live:quick      # fewer attacks, no observation, minutes instead of tens of minutes
   ```
3. When it finishes, the report is in `reports/`. If it passed:

   ```bash
   npm run e2e:commit          # commits the newest live report
   git push
   ```

   `e2e:commit` refuses a report that is `BLOCKED`, `INTERRUPTED`, a simulation, and (unless you pass `--allow-failed`)
   one that contains failures. A failing report is still worth committing as evidence of a bug, and `--allow-failed`
   exists for that.

You can also start it from the **Actions** tab with the workflow *Live end-to-end (GenLayer Studio)*. Tick
*commit_report* to push the report to a new branch `e2e-report-<run id>`, then open a pull request. The workflow was
not executed in the author's environment either.

## What a run does

1. Checks that the RPC endpoint answers. If not, writes a `BLOCKED` report and exits with code 2.
2. Creates (or loads) four throwaway accounts `owner`, `alice`, `bob`, `carol` and funds them with the Studio faucet.
   Keys are stored in `.e2e/accounts.json`, which is git-ignored.
3. Asks the network to parse `contracts/GenDungeon.py`, deploys it with a 0.001 GEN entry fee, and waits until it
   answers.
4. Runs the suites below, recording every transaction hash.
5. Writes `reports/e2e-<time>-live.{md,json,log}` and `reports/LATEST-live.md`.

## Checks

Kinds: **functional** (a feature works), **economic** (the books balance), **adversarial** (an attack fails), and
**observed** (recorded, never asserted).

| ID | Kind | What it checks |
|---|---|---|
| F01 | functional | The deployed contract is v2 and holds the constructor settings |
| F02 | economic | A fresh treasury balances and is solvent |
| F03 | economic | The owner can fund the pool and the deposit is accounted |
| F04 | functional | Starting a quest writes an obstacle, takes the fee and opens the slot |
| F05 | functional | Submitting an action stores it and moves the quest to review |
| F06 | functional | Resolution scores the action; the verdict equals the documented formula applied to the stored scores; the reward equals the documented reward formula |
| F06.n | functional | Further attempts with a different plan when the judges were strict (up to `E2E_MAX_ATTEMPTS`) |
| A05b | adversarial | A stranger cannot claim a won quest; nothing moves |
| F07 | economic | Claiming pays exactly the reserved reward once and releases the player |
| F08 | functional | Stats, history, renown and the hall reflect the win |
| F09 | functional | Surrender closes a quest, frees the slot, clears the open feed |
| F10 | functional | `quote_reward` agrees with the client-side formula over a grid of inputs |
| F11 | functional | `validate_action` dry-runs the submit-time checks |
| F12 | functional | The owner can tune the payout cap and the quest time limit |
| F13 | functional | Two-step ownership handover and its undo |
| A01 | adversarial | A stranger cannot change any owner setting |
| A02 | adversarial | Accepting ownership without a nomination, or as the wrong account, fails |
| A03 | adversarial | The owner cannot set nonsense parameters |
| A04 | adversarial | Wrong payments and unknown tiers create nothing |
| A05 | adversarial | Strangers cannot act on someone else's quest |
| A06 | adversarial | A second concurrent quest is refused |
| A07 | adversarial | Six injection styles are flagged by the contract's own dry-run |
| A08 | adversarial | Injected text is refused on-chain and the quest is left untouched |
| A09 | adversarial | Empty, too short and too long actions are refused on-chain |
| A10 | adversarial | While paused nobody can start a quest, but an open quest can still be answered and judged |
| A11 | adversarial | Replays are refused: double claim, re-submit, re-resolve |
| A12 | adversarial | A quest cannot be expired early; with `E2E_SLOW=1` the run waits out the time limit and anyone can then close it |
| A13 | economic | After everything above the books still balance |
| O01 | observed | What the judges do with persuasion that contains no trigger phrase (also records a refused resolve) |
| P01 | observed | Which read argument lengths (100 to 1000 characters) the node accepts |
| O02 | observed | Whether a long action (about 600 characters) can be submitted on-chain |
| A14 | economic | Final accounting |

### How a rejection is proven

An attack check does not pass just because "something went wrong". `expectRejected` fails the check when

- the call was **accepted**;
- the call **threw** an error that does not carry the documented reason (a timeout, a network or a wallet error is not
  a contract rejection);
- the network ended **without a verdict** (`UNDETERMINED`, `LEADER_TIMEOUT`, `VALIDATORS_TIMEOUT`, `CANCELED`).

On top of that, the checks that attack state compare a fingerprint of the configuration, the treasury, the player
stats and the quest before and after, and require it to be identical. When the revert text is visible in the receipt
it is matched against the documented message; when the receipt does not expose it, the refusal still stands and the
report counts it under *refusals whose documented reason was seen in the receipt* (shown as `x of y`), so a reader
can see how much of the evidence rests on state comparison alone. A refusal for a different, undocumented reason that
leaves the state untouched is therefore not distinguishable from the expected one when the receipt hides the text;
that is a limit of what the network exposes, and the report states the count rather than hiding it.

### Why some results are "observed" or "skipped"

Real judges are language models. A test cannot demand "this plan must win". So:

- If no victory is obtained within `E2E_MAX_ATTEMPTS` plays, the win-dependent checks (A05b, F07, F08) are reported as
  **skipped**, not passed.
- O01 and the verdicts of failed attempts are **observations**: the report shows them, the exit code ignores them.
- The verdict **formula** is asserted exactly, because the contract computes it deterministically from the stored scores.

## Reading the report

Open `reports/LATEST-live.md`. Its banner says what the file is evidence of:

| Banner | Meaning |
|---|---|
| *Live run against …* | Real network. Every transaction hash can be looked up. |
| **SIMULATION RUN** | `npm run e2e:dry`. Proves the scripts work, not the contract. Git-ignored. |
| **BLOCKED** | The network could not be reached. No checks ran. |
| **INTERRUPTED** | The time limit or a cancel stopped the run; only finished checks are listed. |

The JSON file has the same content for tooling; the log file is the full console output. Exit codes: `0` every check
passed, `1` a check failed or the run was interrupted, `2` the network was unreachable.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `GENLAYER_NETWORK` | `studionet` | or `localnet` |
| `GENLAYER_RPC` | network default | override the endpoint |
| `E2E_KEYS` | generated | four private keys: owner,alice,bob,carol |
| `E2E_CONTRACT` | deploy fresh | use a contract you deployed yourself (owner key and constructor arguments `1000000000000000`, `1500000000000000`, `6000000000000000` must match) |
| `E2E_MAX_ATTEMPTS` | 3 | plays tried to obtain a victory |
| `E2E_TIMEOUT_MIN` | 90 | hard limit for the run |
| `E2E_TX_TIMEOUT_MS` | 600000 | wait per transaction |
| `E2E_RPC_PER_MIN` | 24 | requests a minute the run may send to the RPC endpoint (the public one allows 30) |
| `E2E_SLOW` | 0 | also wait out the real quest time limit (about 5 minutes) |
| `E2E_FAUCET_AMOUNT` | ladder | amount passed to `sim_fundAccount` |
| `E2E_MIN_BALANCE_WEI` | 0.05 GEN | balance each account needs before the run |

## If something goes wrong

| Symptom | What to do |
|---|---|
| `BLOCKED` | The endpoint is unreachable from this machine. Run from a machine with internet access. |
| "could not fund … automatically" | Fund the printed address from the Studio faucet or set `E2E_FAUCET_AMOUNT`, then re-run. |
| "contract address was not found in the receipt" | The receipt is printed in the log. Take the address from Studio and re-run with `E2E_CONTRACT=0x…`. |
| Many "skipped" | The judges were strict. Raise `E2E_MAX_ATTEMPTS`. |
| Timeouts | Raise `E2E_TX_TIMEOUT_MS`. Consensus with LLM calls can take minutes per transaction. |
| "Rate limit exceeded" in the log | The run already waits and retries. If it still gives up, lower `E2E_RPC_PER_MIN` (for example 15). |
| `Unexpected token '<', "<!DOCTYPE "... is not valid JSON`, or HTTP 502/503/504 | The gateway in front of Studio dropped out for a moment. The run already waits (3 s, doubling up to 30 s) and retries up to 6 times; the log shows "the RPC gateway answered with …". If it still gives up, the endpoint is down: re-run later. |
| `P01` shows long lengths refused | The node rejects long read arguments. Reads fall back to the local rules; check `O02` to see whether long writes work. |

A full run makes dozens of transactions and several of them involve LLM consensus. The first live run took about
eight minutes while most checks failed early; with request spacing a complete run takes noticeably longer.
