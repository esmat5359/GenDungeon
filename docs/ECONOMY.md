# Economy

## Money in, money out

```
   entry fees ─┐
   fund_pool ──┴──►  reward_pool ──(verdict: success)──►  reserved_rewards ──(claim)──►  paid out
                          ▲                                                                │
                          └────────── fees and donations only ever add ───────────────────┘ (no way back)
```

Every wei that enters the contract is counted in `total_deposited`. It is always in exactly one of three places:

```
total_deposited == reward_pool + reserved_rewards + total_paid_out
```

`get_treasury()` returns `invariant_holds` for this equation and `solvent` for
`contract_balance >= reward_pool + reserved_rewards`. The Vault page shows both.

## Entry fee

`fee(tier) = entry_fee * tier_fee_bps / 10000` with the tier fee factors 100%, 150%, 200%. A caller may send more than
the fee. The whole payment goes into the pool and is recorded on the quest as `paid`; there is no change given.

## Reward

For a winning quest with overall score `s` (0 to 100):

```
base    = min_reward + (max_reward − min_reward) * s // 100
scaled  = base * tier_reward_bps // 10000          # 100%, 150%, 250%
reward  = min(scaled, reward_pool, reward_pool * max_payout_bps // 10000)
```

The reward is computed once, at verdict time, with the pool as it is at that moment. The amount then moves from
`reward_pool` to `reserved_rewards` and **cannot change**: later fee changes, cap changes or other winners do not touch
it. `claim_reward` pays the recorded number.

### Worked example

Settings: `entry_fee = 100`, `min_reward = 150`, `max_reward = 400`, `max_payout_bps = 5000`, pool `1000`.

| Tier | Fee | Pass mark | Win at score 70, uncapped | Paid (pool 1000, cap 50%) |
|---|---|---|---|---|
| Shallows | 100 | 40 | 150 + 250·70//100 = 325 | 325 |
| Depths | 150 | 55 | 325·15000//10000 = 487 | 487 |
| Abyss | 200 | 70 | 325·25000//10000 = 812 | 500 (capped at half the pool) |

### Why a payout cap

Without a cap one win could empty the pool. With the default 50% cap the pool decays geometrically under repeated
wins and never reaches zero by payouts alone (a test checks this). The owner can set the cap between 0.01% and 100%.

## Two winners, one pool

Two players can both be judged winners while the pool could not pay both in full. Rewards are reserved in the order
verdicts land. The second reward is computed from what is left after the first reservation, so it is smaller, but both
are fully payable in either claim order. (v1 already took the reward out of the free pool at verdict time; v2 keeps that
and records the reservation in its own counter so the books can be audited.)

## Empty pool

A win against an empty pool earns a reward of zero. It is still a win for renown and streaks, and it is **claimable**:
`claim_reward` closes the quest and frees the player's slot without moving any value.

## Renown

| Outcome | Renown |
|---|---|
| Win | tier bonus (20 / 35 / 60) + `score // 5` + 4 per previous win in the streak (at most 5 counted) |
| A judged loss (honest attempt that missed the bar) | 2 |
| Surrender or expiry | 0, the streak resets |
| Tampering | 0, and the player's `tamper_flags` grows |

Ranks by renown: Wanderer 0, Squire 100, Knight 300, Champion 700, Archmage 1500, Legend 3000. The ten highest
renowns form the hall of fame. Renown is not for sale: nothing in the contract converts money to renown except
winning a quest, and a fee only buys an attempt.

## Owner economics

The owner can change the fee and the reward range (for new quests only), the payout cap, the quest time limit and the
pause switch. The owner cannot move funds out of the pool. The only way value leaves the contract is `claim_reward`
paying a quest's player the amount reserved by a verdict.
