"""Treasury accounting, payout caps and the empty-pool regression."""

import pytest

from conftest import (
    CLAIMED, ENTRY_FEE, MAX_REWARD, MIN_REWARD, STRONG, SUCCESS, WEAK, overall,
)


def _economy(g, entry_fee, min_reward, max_reward, cap_bps=10000):
    g.as_(g.owner)
    g.c.set_fee_and_rewards(entry_fee, min_reward, max_reward)
    g.c.set_payout_cap(cap_bps)


# --------------------------------------------------------------------------
# Reservation (kept from the original regression suite, updated for v2)
# --------------------------------------------------------------------------
def test_simultaneous_successes_are_both_fully_payable(game, direct_alice, direct_bob):
    """Pool 200 cannot cover two 150 rewards. The second is capped by the
    already-reserved pool, and both stay claimable in either order."""
    g = game
    _economy(g, 100, 150, 150)
    g.mock_judge(*STRONG)

    a = g.start(direct_alice)
    b = g.start(direct_bob)
    assert g.pool() == 200
    g.act(direct_alice, a)
    g.act(direct_bob, b)

    assert g.resolve(a) is True
    assert g.pool() == 50 and g.reserved() == 150
    assert g.resolve(b) is True
    assert g.pool() == 0 and g.reserved() == 200
    assert int(g.quest(a).reward) == 150 and int(g.quest(b).reward) == 50
    g.assert_invariants()

    assert g.claim(direct_bob, b) == 50
    assert g.claim(direct_alice, a) == 150
    assert g.pool() == 0 and g.reserved() == 0
    assert int(g.treasury().total_paid_out) == 200
    g.assert_invariants()


def test_claim_never_touches_the_free_pool(funded, direct_alice):
    g = funded
    qid, _ = g.play(direct_alice)
    pool_after_resolve = g.pool()
    g.claim(direct_alice, qid)
    assert g.pool() == pool_after_resolve


# --------------------------------------------------------------------------
# Regression: a victory against an empty pool used to lock the player out
# --------------------------------------------------------------------------
def test_victory_with_empty_pool_is_claimable_and_frees_the_player(game, direct_alice, direct_bob, direct_charlie):
    g = game
    _economy(g, 100, 200, 200)       # every win asks for 200
    g.mock_judge(*STRONG)
    quests = {}
    for who in (direct_alice, direct_bob, direct_charlie):
        quests[who] = g.start(who)
        g.act(who, quests[who])
    assert g.pool() == 300

    assert g.resolve(quests[direct_alice]) and g.resolve(quests[direct_bob]) and g.resolve(quests[direct_charlie])
    rewards = [int(g.quest(q).reward) for q in quests.values()]
    assert rewards == [200, 100, 0]
    assert g.pool() == 0
    last = quests[direct_charlie]
    assert int(g.quest(last).status) == SUCCESS   # a real victory, just unfunded

    assert g.claim(direct_charlie, last) == 0     # closes without a transfer
    assert int(g.quest(last).status) == CLAIMED
    assert g.slot(direct_charlie) == 0
    # ... and the player is free to play again (the old contract blocked them forever).
    assert g.start(direct_charlie) > last
    g.assert_invariants()


def test_zero_reward_claim_cannot_be_repeated(game, direct_alice, direct_bob):
    g = game
    _economy(g, 100, 200, 200)
    g.mock_judge(*STRONG)
    a = g.start(direct_alice)
    b = g.start(direct_bob)
    g.act(direct_alice, a); g.act(direct_bob, b)
    g.resolve(a); g.resolve(b)
    assert int(g.quest(b).reward) == 0     # alice took all 200
    g.claim(direct_bob, b)
    with g.vm.expect_revert("not a claimable success"):
        g.claim(direct_bob, b)


# --------------------------------------------------------------------------
# Payout cap
# --------------------------------------------------------------------------
def test_single_quest_cannot_take_more_than_the_cap_share(game, direct_alice):
    g = game
    g.fund(1000)
    _economy(g, 100, 900, 900, cap_bps=2500)       # 25% of the pool
    g.mock_judge(*STRONG)
    qid = g.start(direct_alice)                    # pool 1100
    g.act(direct_alice, qid)
    g.resolve(qid)
    assert int(g.quest(qid).reward) == 1100 * 2500 // 10000 == 275
    assert g.pool() == 1100 - 275


def test_repeated_wins_decay_the_pool_geometrically_never_to_zero(game, direct_alice):
    g = game
    g.fund(1000)
    _economy(g, 100, 10**6, 10**6, cap_bps=5000)
    g.mock_judge(*STRONG)
    pools = []
    for _ in range(6):
        qid = g.start(direct_alice)
        g.act(direct_alice, qid)
        g.resolve(qid)
        g.claim(direct_alice, qid)
        pools.append(g.pool())
    assert all(p > 0 for p in pools)
    g.assert_invariants()


def test_cap_setter_bounds_and_permissions(game, direct_alice):
    g = game
    g.as_(g.owner)
    for bad in (0, 10001, 2**31):
        with g.vm.expect_revert("Payout cap must be between"):
            g.c.set_payout_cap(bad)
    g.c.set_payout_cap(1)
    g.c.set_payout_cap(10000)
    g.as_(direct_alice)
    with g.vm.expect_revert("Only the owner"):
        g.c.set_payout_cap(5000)


# --------------------------------------------------------------------------
# Funding and parameters
# --------------------------------------------------------------------------
def test_fund_pool_accounts_deposits(game, direct_alice):
    g = game
    g.fund(500, direct_alice)
    assert g.pool() == 500
    assert int(g.treasury().total_deposited) == 500
    g.as_(direct_alice, 0)
    with g.vm.expect_revert("Send some value"):
        g.c.fund_pool()
    g.assert_invariants()


@pytest.mark.parametrize(
    "args, message",
    [
        ((0, 10, 20), "entry_fee must be greater than zero"),
        ((100, 30, 20), "min_reward cannot exceed max_reward"),
        ((10**31, 1, 2), "above the allowed maximum"),
        ((100, 1, 10**31), "above the allowed maximum"),
        ((2**255, 1, 2), "above the allowed maximum"),
    ],
)
def test_owner_setter_validates_parameters(game, args, message):
    game.as_(game.owner)
    with game.vm.expect_revert(message):
        game.c.set_fee_and_rewards(*args)


@pytest.mark.parametrize(
    "args, message",
    [
        ((0, 10, 20), "entry_fee must be greater than zero"),
        ((100, 30, 20), "min_reward cannot exceed max_reward"),
        ((10**31, 1, 2), "above the allowed maximum"),
    ],
)
def test_constructor_validates_parameters(direct_vm, direct_deploy, args, message):
    from conftest import CONTRACT_PATH, SDK_VERSION

    with direct_vm.expect_revert(message):
        direct_deploy(CONTRACT_PATH, *args, sdk_version=SDK_VERSION)


def test_non_owner_cannot_change_parameters(game, direct_alice):
    g = game
    g.as_(direct_alice)
    with g.vm.expect_revert("Only the owner"):
        g.c.set_fee_and_rewards(1, 1, 1)
    assert int(g.config().entry_fee) == ENTRY_FEE


def test_fee_change_applies_to_new_quests_only(funded, direct_alice):
    g = funded
    qid = g.start(direct_alice)
    paid_before = int(g.quest(qid).paid)
    g.as_(g.owner)
    g.c.set_fee_and_rewards(500, MIN_REWARD, MAX_REWARD)
    assert int(g.quest(qid).paid) == paid_before == ENTRY_FEE
    g.act(direct_alice, qid)
    g.resolve(qid)
    g.claim(direct_alice, qid)
    with g.vm.expect_revert("Insufficient entry fee"):
        g.start(direct_alice, 0, value=ENTRY_FEE)
    assert g.start(direct_alice, 0, value=500) > qid


def test_reserved_reward_is_immune_to_later_parameter_changes(funded, direct_alice):
    g = funded
    qid, won = g.play(direct_alice)
    assert won
    reward = int(g.quest(qid).reward)
    g.as_(g.owner)
    g.c.set_fee_and_rewards(1, 1, 1)
    g.c.set_payout_cap(1)
    assert g.claim(direct_alice, qid) == reward


# --------------------------------------------------------------------------
# Solvency view
# --------------------------------------------------------------------------
def test_treasury_solvency_tracks_the_contract_balance(funded, direct_alice):
    g = funded
    qid, _ = g.play(direct_alice)
    t = g.treasury()
    assert int(t.contract_balance) == 0 and t.solvent is False   # nothing really held in the mock
    g.vm.deal(g.vm._contract_address, int(t.reward_pool) + int(t.reserved_rewards))
    assert g.treasury().solvent is True
    g.vm.deal(g.vm._contract_address, int(t.reward_pool) + int(t.reserved_rewards) - 1)
    assert g.treasury().solvent is False
    assert g.treasury().invariant_holds is True


# --------------------------------------------------------------------------
# Overflow and extremes
# --------------------------------------------------------------------------
def test_absurd_payment_cannot_corrupt_accounting(funded, direct_alice):
    g = funded
    before = (g.pool(), int(g.treasury().total_deposited), int(g.config().total_quests_created))
    with pytest.raises(Exception):
        g.start(direct_alice, 0, value=2**256 - 1)
    after = (g.pool(), int(g.treasury().total_deposited), int(g.config().total_quests_created))
    assert before == after
    g.assert_invariants()


def test_large_but_valid_amounts_work(game, direct_alice):
    g = game
    big = 10**24
    _economy(g, big, big, big * 2)
    g.fund(big * 10)
    g.mock_judge(*STRONG)
    qid = g.start(direct_alice)
    g.act(direct_alice, qid)
    assert g.resolve(qid)
    assert int(g.quest(qid).reward) == big + big * overall(STRONG) // 100
    assert g.claim(direct_alice, qid) > 0
    g.assert_invariants()


# --------------------------------------------------------------------------
# What actually leaves the contract
# --------------------------------------------------------------------------
def test_claim_emits_exactly_one_payout_of_the_recorded_reward(funded, direct_alice, direct_bob):
    g = funded
    qid, _ = g.play(direct_alice)
    reward = int(g.quest(qid).reward)
    assert g.sends == []                       # nothing moves before the claim
    g.claim(direct_alice, qid)
    assert g.payouts_to(direct_alice) == [reward]
    assert g.payouts_to(direct_bob) == []
    with g.vm.expect_revert("not a claimable success"):
        g.claim(direct_alice, qid)
    assert g.payouts_to(direct_alice) == [reward]     # replay produced no second transfer


def test_zero_reward_claim_emits_no_transfer(game, direct_alice, direct_bob):
    g = game
    _economy(g, 100, 200, 200)
    g.mock_judge(*STRONG)
    a = g.start(direct_alice)
    b = g.start(direct_bob)
    g.act(direct_alice, a); g.act(direct_bob, b)
    g.resolve(a); g.resolve(b)
    assert int(g.quest(b).reward) == 0
    g.claim(direct_bob, b)
    assert g.sends == []


def test_events_describe_the_whole_story(funded, direct_alice):
    g = funded
    qid, _ = g.play(direct_alice, 1)
    g.claim(direct_alice, qid)
    started = g.events_named("tier", 1)
    assert started and started[0]["paid"] == g.fee(1)
    resolved = g.events_named("success", True)
    assert resolved and resolved[0]["score"] == overall(STRONG) and resolved[0]["tampering"] is False
    claimed = g.events_named("amount", int(g.quest(qid).reward))
    assert claimed
