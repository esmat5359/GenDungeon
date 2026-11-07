# Testing

Four layers, from the contract outward. Each layer exists because the one below cannot see what it sees.

| Layer | Where | Command | What it proves |
|---|---|---|---|
| Contract tests | `tests/` (7 files, 121 test functions, 276 cases) | `npm run test:contract` | The contract's rules, run in GenVM's direct mode with the LLM mocked |
| Mutation testing | `scripts/mutation_check.py` | `npm run mutation` | The contract tests notice 14 deliberately introduced bugs |
| App and harness tests | `src/__tests__/`, `e2e/live/*.test.ts` (68 cases) | `npm test` | Client formulas match the contract, the in-memory model behaves, the end-to-end suites can fail |
| Live end-to-end | `e2e/live/` | `npm run e2e:live` | The same behaviour on a real GenLayer network ([E2E.md](E2E.md)) |

## 1. Contract tests

They load `contracts/GenDungeon.py` through `genlayer-test` (SDK pinned to GenVM v0.2.16) and replace the LLM with
scripted answers, so a failing test always points at contract logic.

| File | Test functions | Focus |
|---|---|---|
| `test_game_flow.py` | 20 | The happy path and every status transition |
| `test_lifecycle.py` | 11 | Surrender, expiry, slot release, pause, two-step ownership |
| `test_economy.py` | 19 | Reservation, payout cap, empty pool, accounting after parameter changes, events |
| `test_progression.py` | 11 | Renown, streaks, ranks, hall of fame ordering and de-duplication |
| `test_security.py` | 35 | Injection families, obfuscation, access control, replay, malformed model output |
| `test_helpers.py` | 24 (many parametrised) | Pure functions: sanitising, marker filter, strict parsing, score rule, equivalence rule, rank ladder, date parsing |
| `test_fuzz_invariants.py` | 1 × 10 seeds | 350 random valid and invalid calls per seed, invariants checked every 10 steps |

After every tenth call the fuzz test checks, against the full list of quests:

- the treasury equation, `reserved` equal to the sum of unclaimed winning rewards and `paid_out` equal to the sum of
  claimed rewards;
- the open-quest feed is exactly the quests awaiting action or judgment, newest first;
- per player: history order, at most one live quest, the slot points at it, and the started, won, lost and earned
  counters match the quest records;
- verdict integrity: every stored win reproduces its verdict and score from its three sub-scores, and nothing that is
  not a win carries a reward;
- the hall of fame is sorted, free of duplicates, matches each player's renown and equals the true top ten.

### A regression that mattered

`test_victory_with_empty_pool_is_claimable_and_frees_the_player` reproduces the v1 lock-out: a win against an empty
pool used to leave the player holding a quest that could never be claimed.

## 2. Mutation testing

Passing tests only show the code does what the tests expect. A mutation run shows whether the tests would **notice** if
the code were wrong: it copies the contract, applies one small deliberate bug, runs the whole suite and requires it to
fail. A mutant that survives is a hole in the tests.

```
npm run mutation          # about one pytest run per mutant
```

| # | Mutant |
|---|---|
| 1 | claim forgets to release the reserved reward |
| 2 | resolve forgets to unlink the quest from the open feed |
| 3 | pass mark is exclusive instead of inclusive |
| 4 | reward ignores the pool |
| 5 | injection filter disabled |
| 6 | claim lacks the owner check |
| 7 | expiry off by one |
| 8 | hall keeps stale duplicate entries |
| 9 | fee check removed |
| 10 | strict flag parsing replaced by `bool()` |
| 11 | tampering no longer fails a quest |
| 12 | zero-reward claims emit a transfer |
| 13 | surrender does not reset the streak |
| 14 | pause is ignored |

All 14 are killed.

## 3. App and harness tests

- `rules.parity.test.ts` reads `GenDungeon.py` as text and compares every constant and table (weights, floor, pass
  marks, tier factors, rank ladder, limits) with `src/lib/rules.ts`. If the contract changes and the client does not,
  this fails.
- `demo.test.ts` checks that the in-memory model follows the contract's state machine, that random play never breaks
  the treasury equation, and that **every literal revert message in the model exists in `GenDungeon.py`**, so the
  simulation cannot drift to messages the real contract never sends.
- `lib.test.ts` covers formatting, normalisation of wire data (plain objects, Maps, camelCase), revert-reason
  extraction from nested receipts, the client-side rules and environment resolution.
- `e2e/live/dry.test.ts` is explained in the next section.

## 4. Do the end-to-end suites have teeth?

A suite that cannot fail proves nothing, and adversarial scenarios that always pass are the easiest kind to write by
accident. `dry.test.ts` therefore runs the whole end-to-end suite against the in-memory model **with a bug injected**,
and requires the named check to fail:

| Injected fault | Check that must fail |
|---|---|
| owner check removed | A01 |
| a stranger may answer someone else's quest | A05 |
| a stranger may claim someone else's win | A05b |
| zero-value deposits accepted | A04 |
| claim pays one wei that was never reserved | F07 and A13 |
| reward off by one wei | F06 |
| quests can be expired before the time limit | A12 |
| pause does not stop new quests | A10 |
| entry fee not enforced | A04 |

Building this found a real gap: the first version of A05 tried to claim a quest that was still `ACTIVE`, where the
status check would reject the call even if the ownership check were missing. `A05b` was added to attempt the theft on a
quest that is actually claimable.

## What is not covered

- Real LLM behaviour. Contract tests mock the model. The live suite records what real judges do (observations) but a
  model's answer is not something a test can demand.
- Concurrency across real validators. Direct mode runs one VM; the equivalence rule is tested as a pure function and in
  the live run.
- Browser rendering beyond the audits in [UI.md](UI.md). There are no component-level interaction tests; the screenshot
  capture script exercises the full play flow in the demo mode instead.
