# Changelog

## Unreleased

Fixes from the first live run on Studio. The contract is unchanged.

- Fixed: a reverted call was reported as accepted. Studio records the refusal on the leader receipt, not in
  `txExecutionResultName`; `receiptFailed` now reads `execution_result` and `result.status`, and the revert reason is
  taken from `result.payload`.
- Fixed: the live run exceeded the endpoint's 30 requests a minute. Requests are now spaced (`E2E_RPC_PER_MIN`), polling
  is every four seconds, and a rate-limited answer is retried with a growing pause. Reads in the app also wait longer
  before retrying a rate limit.
- Fixed: `validate_action` reads with a long argument were refused by the node (`RLP ... superfluous bytes`). The client
  falls back to the local length rules instead of failing, and does not retry an undecodable request.
- Fixed: the live run failed a check when validators were cancelled after a quorum (`A10`). `resolve_quest` is open to anyone and
  safe to repeat while a quest is under review, so the suite now retries it (up to 3 attempts) and lists every error.
  A failure without a readable reason now shows the leader's outcome and the vote tally instead of a blank message.
- Fixed: a successful call was reported as failed when one validator entry in the leader receipt was cancelled after the
  quorum (`CONSENSUS_VALIDATOR_QUORUM_REACHED`, tx `0x4b6c600bed`). That entry reads `ERROR` but says nothing about the
  call; `receiptFailed` and `extractRevertReason` now skip it (`isQuorumCancellation`). This made `F04` fail and then
  `F06`/`F06.n` re-send `start_quest` into an already open quest. A non-fatal contract error is still a failure.
- Fixed: a momentary gateway failure of the RPC endpoint (HTTP 502/503/504, or an HTML page instead of JSON, reported as
  `Unexpected token '<', "<!DOCTYPE "...`) failed the check that was running (`F12`). The live run's fetch wrapper now
  treats it like a rate limit: it waits 3 s (doubling, up to 30 s) and retries up to 6 times (`looksGatewayError`). App
  reads do the same (`isGatewayHiccup`). The throttle now also covers a custom `GENLAYER_RPC` endpoint.
- Added: checks `P01` and `O02` record which argument lengths the node accepts; `O01` records a refused resolve.
- Added: tests for Studio-shaped receipts, the request limiter and the rate-limit retry.

## 2.0.0

A rebuild of the contract's decision logic, a new web app, and a verification pipeline. The v1 contract keeps working;
the app opens it in a read-only legacy mode.

### Contract

**Verdicts are computed, not reported**
- The LLM returns `relevance`, `plausibility`, `creativity` (0 to 100) and a `tampering` flag. The contract derives the
  verdict in one pure function (`_is_success`): weights 35/35/30, a floor of 40 on relevance and plausibility, tier pass
  marks 40/55/70 (inclusive), and tampering always fails.
- Validators run the judge again and accept when the tamper flag and the derived verdict match and every sub-score is
  within 15 points.
- Strict parsing of model output: scores are clamped integers, flags accept only real booleans or the exact strings
  `true` and `false`, malformed output is rejected.

**Economy**
- The reservation of a reward at verdict time (already done in v1) is now an explicit counter, `reserved_rewards`, next
  to `total_deposited` and `total_paid_out`, so the books can be audited.
- Fixed: a win against an empty pool locked the player out. A zero reward is now claimable and frees the slot.
- Treasury invariant `total_deposited == reward_pool + reserved_rewards + total_paid_out`, exposed with a solvency
  check in `get_treasury()`.
- Per-quest payout cap (`max_payout_bps`, default 50%), overpayment goes to the pool, parameters are bounded.

**Security**
- Action sanitising (invisible and direction-override code points, delimiters, whitespace, length) and a normalising
  marker filter (case, homoglyphs, leetspeak, separators, letter spacing) that refuses judge-addressing text before it
  is stored.
- The judge prompt frames player text as untrusted data and asks for a tamper flag.
- A generated scenario must pass an independent audit call in every validator.
- A leader error is accepted only if the validator reproduces the same deterministic error.

**Game**
- Three difficulty tiers (Shallows, Depths, Abyss) with their own fee, reward factor, pass mark and renown.
- Renown, six ranks, win streaks, an on-chain hall of fame of ten, tamper counter, continuity from the previous
  outcome into the next obstacle.

**Operations**
- Quest time limit with `expire_quest` callable by anyone, `surrender_quest`, pause switch that only closes new quests,
  two-step ownership transfer, owner setters with bounds.
- O(limit) views through linked lists: `get_player_history`, `list_active_quests`.
- `quote_reward`, `validate_action`, `get_tiers`, `get_config`, `get_treasury`, `get_hall_of_fame`.
- Events: `QuestStarted`, `QuestResolved`, `RewardClaimed`, `QuestClosed`, `ConfigChanged`.

### Web app

- New logo: the official GenLayer mark traced to vector (IoU 0.9988 against the source) and set in a dungeon archway.
- Seven pages: Gate, Play, Chronicle, Hall, Vault, Codex, Keeper.
- Three-dimensional hero with adaptive quality and static fallbacks; a consensus overlay that follows the transaction
  through GenLayer's states.
- Demo mode: an in-memory model of the contract with the same rules and messages.
- Self-hosted fonts, route-level code splitting, lazy-loaded `genlayer-js` and three.js, one shared contract store.
- axe-core audit: no violations on 7 routes at two widths.

### Verification

- 276 contract test cases (121 functions), including seeded fuzzing with invariants.
- Mutation testing: 14 injected bugs, all caught.
- 52 TypeScript tests, including a parity test that reads the contract source and a test that every demo revert message
  exists in the contract.
- Live end-to-end suite (`npm run e2e:live`): 29 functional, economic, adversarial and observed checks, a report
  generator (Markdown, JSON, log), a script that commits only real reports, a dev container for GitHub Codespaces and
  two workflows. The suites are themselves tested by injecting faults into the simulation and requiring them to fail.

### Not done in this release

- The live end-to-end suite and the two GitHub workflows have not been executed on a real network or on GitHub; the
  first live run produces the first on-chain evidence.
- No v2 address is recorded in this repository.

## 1.0.0

First release: a single-call judge, one difficulty, flat rewards. Deployed on GenLayer Studio at
`0xc49d63f60e651700777fA35d0F0aF05AF5AeA928`.
