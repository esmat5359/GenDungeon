# Contract API

`GenDungeon` version 2.0.0. Amounts are in wei (18 decimals). Revert messages are deterministic strings; validators
compare them, and the tests and the end-to-end suite match on them.

## Constructor

`__init__(entry_fee: u256, min_reward: u256, max_reward: u256)`

The fee and the reward range apply to the first tier (Shallows). Higher tiers scale them (see [ECONOMY.md](ECONOMY.md)).
Reverts if `entry_fee` is zero, `min_reward > max_reward`, or any value is above 10^30.

## Writes

| Method | Caller | Value | What it does | Reverts with |
|---|---|---|---|---|
| `start_quest(tier)` | anyone | at least the tier fee | Takes the fee into the pool, writes an obstacle through validator consensus, opens the player's slot | `The dungeon is closed for now` · `Unknown difficulty tier` · `Insufficient entry fee: sent X, required Y` · `You have a quest awaiting action, resolution, or reward claim - …` |
| `submit_action(quest_id, action)` | the quest's player | none | Stores the action (10 to 1000 characters after cleaning) and moves the quest to `SUBMITTED` | `You do not own this quest` · `Quest is not awaiting an action` · `Action text must not be empty` · `Action text is too short (min 10 chars)` · `Action text is too long (max 1000 chars)` · `Action rejected: it contains instructions aimed at the judge` |
| `resolve_quest(quest_id)` | anyone | none | Runs judge consensus, derives the verdict, reserves the reward, updates stats | `Quest is not awaiting resolution` · `Judge output was malformed` |
| `claim_reward(quest_id)` | the quest's player | none | Pays the reserved reward (no transfer when it is zero), closes the quest, frees the slot | `You do not own this quest` · `Quest is not a claimable success` |
| `surrender_quest()` | the caller | none | Closes the caller's unanswered quest as `FAILED` | `You do not have an active quest` · `Quest is currently being resolved or already finished` |
| `expire_quest(quest_id)` | anyone | none | Closes a quest that has waited for an action longer than the time limit | `Only a quest awaiting an action can expire` · `Quest has not expired yet` |
| `fund_pool()` | anyone | greater than zero | Adds to the reward pool | `Send some value to fund the pool` |

### Owner only (revert `Only the owner can do this` for anyone else)

| Method | Effect | Bounds |
|---|---|---|
| `set_fee_and_rewards(entry_fee, min_reward, max_reward)` | Changes the economy for new quests | fee above zero, min not above max, each at most 10^30 |
| `set_payout_cap(max_payout_bps)` | One reward may take at most this share of the pool | 1 to 10000 (`Payout cap must be between 1 and 10000 bps`) |
| `set_quest_ttl(seconds)` | Time before an unanswered quest can be expired | 300 s to 30 days (`Quest TTL must be between 300 seconds and 30 days`) |
| `set_paused(paused)` | Closes or opens `start_quest`. Answering, judging, claiming, surrendering and expiring keep working | none |
| `transfer_ownership(new_owner)` | Nominates a new owner | `Invalid address` · `Address is already the owner` |
| `cancel_ownership_transfer()` | Withdraws the nomination | |
| `accept_ownership()` | Called by the nominee to take over (**not** owner-only) | `No ownership transfer is pending` · `Only the pending owner can accept` |

## Views

| Method | Returns |
|---|---|
| `get_version()` | `"2.0.0"` |
| `get_owner()`, `get_pending_owner()` | address strings (`""` when nobody is nominated) |
| `get_config()` | entry fee, reward range, pool, reserved, deposited, paid out, payout cap, quest TTL, paused, quest counter, open quests, hall size, version |
| `get_treasury()` | contract balance, pool, reserved, deposited, paid out, `solvent`, `invariant_holds` |
| `get_tiers()` | for each tier: name, fee, reward factor in bps, pass mark, hint |
| `quote_reward(tier, score)` | the exact reward a win at that score would earn **right now** (pool and cap applied); `0` for an unknown tier or a score above 100 |
| `validate_action(action)` | `""` when the text would be accepted, otherwise `empty`, `too_short`, `too_long` or `instruction_like:<phrase>` |
| `get_quest(quest_id)` | the full quest record including the three rubric scores, score, reward, narrative |
| `get_player_active_quest(player)` | the id of the quest holding the player's slot, `0` for none |
| `get_player_stats(player)` | counters, earnings, renown, rank and label, next rank threshold, streaks, tamper flags |
| `get_player_history(player, limit)` | the player's quests, newest first, O(limit) |
| `list_active_quests(limit)` | open quests (awaiting action or judgment), newest first, O(limit) |
| `get_hall_of_fame()` | up to ten entries ordered by renown |

## Events

| Event | Emitted when |
|---|---|
| `QuestStarted(player, quest_id, …)` | a quest is created |
| `QuestResolved(player, quest_id, success, score, tier, tampering)` | a verdict lands |
| `RewardClaimed(player, quest_id, …)` | a reward is paid |
| `QuestClosed(player, quest_id, …)` | a quest ends by surrender or expiry |
| `ConfigChanged(…)` | an owner setting changes |
