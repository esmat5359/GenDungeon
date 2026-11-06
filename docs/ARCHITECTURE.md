# Architecture

## The idea in one paragraph

A language model is good at judging whether a plan is sensible and bad at being trusted with money. GenDungeon splits
the work along that line. The LLM only answers three questions about a player's plan, as numbers from 0 to 100:
**relevance**, **plausibility**, **creativity**, plus one yes/no question: is the text trying to instruct the judge
(**tampering**). Everything after that is plain code: the verdict, the reward, the renown, the ranks and the books. A
validator that re-runs the contract gets the same verdict from the same three numbers, so the only thing consensus has
to agree on is how close the numbers are.

## Contract

`contracts/GenDungeon.py` (version 2.0.0, one `GenDungeon(gl.Contract)` class plus module-level pure helpers).

### Life of a quest

```
 start_quest(tier) ──► ACTIVE ──submit_action──► SUBMITTED ──resolve_quest──► SUCCESS ──claim_reward──► CLAIMED
   pays the fee           │                                        │
   scribes write          │                                        └────────► FAILED   (below pass mark, a weak
   the obstacle           ├──surrender_quest──► FAILED                                  component, or tampering)
                          └──expire_quest (anyone, after the TTL)──► EXPIRED
```

| Status | Meaning | Player slot |
|---|---|---|
| `ACTIVE` (0) | Obstacle written, waiting for the player's action | held |
| `SUBMITTED` (1) | Action stored, waiting for judgment | held |
| `SUCCESS` (2) | Judged a win, reward reserved, not yet claimed | held until claimed |
| `FAILED` (3) | Judged a failure, or surrendered | released |
| `CLAIMED` (4) | Reward paid | released |
| `EXPIRED` (5) | Abandoned before an action was submitted | released |

A player holds at most one quest at a time. Every terminal state releases the slot, including a win against an empty
pool (its reward is zero and `claim_reward` closes it without emitting a transfer). That closes the v1 lock-out bug.

### Where the non-determinism lives

There are exactly two non-deterministic blocks, both wrapped in `gl.vm.run_nondet_unsafe(leader_fn, validator_fn)`:

| Block | Leader | Validator accepts when |
|---|---|---|
| Scenario | Asks the LLM for one obstacle (JSON). Two attempts, strict cleaning. | The leader's text passes cleaning, and a **second, independent LLM call** (a safety auditor prompt) says the text is a self-contained fantasy obstacle. |
| Judgment | Asks the LLM for the rubric (JSON). Two attempts, strict parsing. | It re-runs the judge itself and the two results satisfy the equivalence rule below. |

**Equivalence rule** (`_judgements_agree`): same tamper flag, same derived verdict, and each of the three sub-scores
within 15 points. Two validators that disagree about the exact score still agree whenever they would reach the same
verdict, which keeps honest validators from rejecting each other over noise.

If the leader fails with a deterministic `UserError`, a validator accepts that only when it reproduces the very same
error (`_leader_error_matches`).

### Where it is deterministic

```
overall   = (35·relevance + 35·plausibility + 30·creativity) // 100
success   = not tampering
            and relevance >= 40 and plausibility >= 40          # component floor
            and overall   >= pass mark of the tier (40 / 55 / 70, inclusive)
reward    = min( (min_reward + (max_reward − min_reward)·score // 100) · tier_bps // 10000,
                 reward_pool,
                 reward_pool · max_payout_bps // 10000 )
renown    = tier win bonus (20 / 35 / 60) + score // 5 + min(streak_before, 5)·4      (win)
          = 2                                                                         (genuine loss)
          = 0, and the tamper counter goes up                                         (tampering)
```

Only `_is_success` decides a verdict. A jailbroken model that answers "success: true" changes nothing because the
contract never reads such a field.

### Storage

Flat `@allow_storage` dataclasses of primitive fields (`Quest`, `PlayerStats`) and `TreeMap`s keyed by id or address.
View return types are also dataclasses so GenVM can encode them. Per-player history and the open-quest feed are
**linked lists** threaded through the quest records, so `get_player_history` and `list_active_quests` cost O(limit)
rather than scanning every quest ever created. The hall of fame is a ten-slot board re-placed on every renown change.

### Events

`QuestStarted`, `QuestResolved`, `RewardClaimed`, `QuestClosed`, `ConfigChanged`.

## Frontend

```
 pages ─► state (store, session, tx) ─► GameApi ─┬─► LiveGame ──► genlayer-js ──► GenLayer
                                                  └─► DemoGame ──► DemoChain (in memory)
```

### `GameApi` is the seam

`src/lib/api.ts` defines one interface that covers every read and write of the contract. Two classes implement it:

- **`LiveGame`** (`src/lib/contract.ts`) calls the deployed contract through `genlayer-js`, waits for receipts, and turns a
  consensus failure into a readable message (`extractRevertReason`).
- **`DemoGame`** (`src/lib/demo.ts`) is an in-memory model of the contract with the same rules (it imports the same
  formulas from `src/lib/rules.ts`) and the same error messages, and a deterministic stand-in for the judges.

Everything above this seam, the seven pages, the transaction overlay, the end-to-end suites, is written once and runs
against either implementation. That is also how the end-to-end suite is checked without a network
([E2E.md](E2E.md)).

### Layers

| Layer | Files | Notes |
|---|---|---|
| Rules | `src/lib/rules.ts` | Pure copies of the contract formulas. A parity test pins them to the contract's tables. |
| Wire | `src/lib/normalize.ts`, `format.ts`, `types.ts` | Turns whatever `genlayer-js` returns (Maps, BigInts, strings) into typed records. |
| Clients | `contract.ts`, `genlayerClient.ts`, `demo.ts` | `LiveGame`, wallet and client factory, `DemoChain`. |
| State | `src/state/store.ts` | One de-duplicated snapshot of the chain shared by every page; a failed read keeps the last good value. |
| Session | `session.tsx`, `liveSession.tsx`, `tx.tsx` | Picks demo or live, owns the wallet, runs writes behind the consensus overlay. |
| Pages | `src/pages/*` | Seven routes, each a lazy chunk. |

### Modes

`resolveConfig()` picks the mode: `?demo=1` forces demo, `?contract=0x…` or `VITE_CONTRACT_ADDRESS` selects a live
deployment, and with neither the app runs in demo mode. A contract that does not answer `get_version()` with `2.x` is
shown in a read-only legacy banner instead of breaking the UI.

### Why `genlayer-js` is lazy

The live runtime (`liveSession`) is about 120 kB gzipped. Demo visitors never download it; live visitors download it
after the first paint. See [UI.md](UI.md) for measured numbers.
