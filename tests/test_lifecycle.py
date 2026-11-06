"""Expiry, the open-quest feed and per-player history (linked-list views)."""

import pytest

from conftest import ACTIVE, EXPIRED, FAILED, GOOD_ACTION, STRONG, SUBMITTED, SUCCESS, WEAK


def _ids(items):
    return [int(i.quest_id) for i in items]


# --------------------------------------------------------------------------
# Expiry
# --------------------------------------------------------------------------
def test_quest_cannot_expire_early_but_can_after_the_ttl(funded, direct_alice, direct_bob):
    g = funded
    g.warp("2026-11-01T00:00:00.000Z")
    qid = g.start(direct_alice)

    g.warp("2026-11-01T23:59:59.000Z")             # one second short of 24 h
    with g.vm.expect_revert("has not expired yet"):
        g.as_(direct_bob); g.c.expire_quest(qid)

    g.warp("2026-11-02T00:00:00.000Z")             # exactly the TTL
    g.as_(direct_bob)
    g.c.expire_quest(qid)                          # a bystander may close it
    q = g.quest(qid)
    assert int(q.status) == EXPIRED and "went cold" in q.narrative_outcome
    assert int(q.resolved_at) > int(q.created_at)
    assert g.slot(direct_alice) == 0
    assert int(g.config().open_quests) == 0
    assert int(g.stats(direct_alice).quests_failed) == 1
    assert g.c.list_active_quests(10) == []
    # The slot is free again.
    assert g.start(direct_alice) == qid + 1


def test_expiry_respects_the_configured_ttl(funded, direct_alice):
    g = funded
    g.as_(g.owner)
    g.c.set_quest_ttl(600)
    g.warp("2026-11-01T00:00:00Z")
    qid = g.start(direct_alice)
    g.warp("2026-11-01T00:09:59Z")
    with g.vm.expect_revert("has not expired yet"):
        g.as_(direct_alice); g.c.expire_quest(qid)
    g.warp("2026-11-01T00:10:00Z")
    g.as_(direct_alice)
    g.c.expire_quest(qid)


def test_only_unanswered_quests_can_expire(funded, direct_alice, direct_bob):
    g = funded
    a = g.start(direct_alice)
    g.act(direct_alice, a)
    b = g.start(direct_bob)
    g.warp("2027-01-01T00:00:00Z")
    for qid in (a,):
        with g.vm.expect_revert("Only a quest awaiting an action can expire"):
            g.as_(direct_bob); g.c.expire_quest(qid)         # SUBMITTED
    g.resolve(a)
    with g.vm.expect_revert("Only a quest awaiting an action can expire"):
        g.as_(direct_bob); g.c.expire_quest(a)               # SUCCESS
    g.as_(direct_bob)
    g.c.expire_quest(b)
    with g.vm.expect_revert("Only a quest awaiting an action can expire"):
        g.c.expire_quest(b)                                  # already EXPIRED


def test_expiry_needs_a_working_clock(funded, direct_alice):
    g = funded
    qid = g.start(direct_alice)
    g.warp("not-a-timestamp")
    with g.vm.expect_revert("The clock is unavailable"):
        g.as_(direct_alice); g.c.expire_quest(qid)


def test_expiry_resets_the_win_streak(funded, direct_alice):
    g = funded
    qid, _ = g.play(direct_alice)
    g.claim(direct_alice, qid)
    assert int(g.stats(direct_alice).win_streak) == 1
    nxt = g.start(direct_alice)
    g.warp("2027-01-01T00:00:00Z")
    g.as_(direct_alice)
    g.c.expire_quest(nxt)
    assert int(g.stats(direct_alice).win_streak) == 0
    assert int(g.stats(direct_alice).best_streak) == 1


# --------------------------------------------------------------------------
# Open-quest feed
# --------------------------------------------------------------------------
def test_open_feed_is_newest_first_and_tracks_every_exit(funded, direct_alice, direct_bob, direct_charlie):
    g = funded
    a = g.start(direct_alice)
    b = g.start(direct_bob)
    c = g.start(direct_charlie)
    assert _ids(g.c.list_active_quests(10)) == [c, b, a]
    assert int(g.config().open_quests) == 3

    # Middle element leaves by surrender.
    g.as_(direct_bob); g.c.surrender_quest()
    assert _ids(g.c.list_active_quests(10)) == [c, a]

    # Head leaves by resolution.
    g.act(direct_charlie, c)
    g.resolve(c)
    assert _ids(g.c.list_active_quests(10)) == [a]

    # Tail leaves by expiry.
    g.warp("2027-01-01T00:00:00Z")
    g.as_(direct_alice); g.c.expire_quest(a)
    assert g.c.list_active_quests(10) == []
    assert int(g.config().open_quests) == 0

    # And the list starts cleanly again.
    d = g.start(direct_bob)
    assert _ids(g.c.list_active_quests(10)) == [d]


def test_open_feed_limit_and_defaults(funded, direct_alice, direct_bob, direct_charlie):
    g = funded
    ids = [g.start(who) for who in (direct_alice, direct_bob, direct_charlie)]
    assert _ids(g.c.list_active_quests(2)) == [ids[2], ids[1]]
    assert _ids(g.c.list_active_quests(0)) == ids[::-1]       # 0 means the default cap
    assert _ids(g.c.list_active_quests(10_000)) == ids[::-1]  # clamped, not an error


def test_open_feed_shows_status_and_tier(funded, direct_alice):
    g = funded
    qid = g.start(direct_alice, 2)
    item = g.c.list_active_quests(5)[0]
    assert (item.status_label, item.tier_name, int(item.tier)) == ("ACTIVE", "Abyss", 2)
    g.act(direct_alice, qid)
    assert g.c.list_active_quests(5)[0].status_label == "SUBMITTED"


# --------------------------------------------------------------------------
# Player history
# --------------------------------------------------------------------------
def test_history_is_newest_first_per_player_and_isolated(funded, direct_alice, direct_bob):
    g = funded
    a1, _ = g.play(direct_alice, parts=WEAK)
    b1, _ = g.play(direct_bob, parts=WEAK)
    a2, _ = g.play(direct_alice, parts=WEAK)
    a3, won = g.play(direct_alice, parts=STRONG)
    assert won
    hist = g.c.get_player_history(g.addr(direct_alice), 50)
    assert _ids(hist) == [a3, a2, a1]
    assert [h.status_label for h in hist] == ["SUCCESS", "FAILED", "FAILED"]
    assert _ids(g.c.get_player_history(g.addr(direct_bob), 50)) == [b1]
    assert int(hist[0].score) == 85 and int(hist[0].reward) > 0


def test_history_limit_semantics(funded, direct_alice):
    g = funded
    ids = [g.play(direct_alice, parts=WEAK)[0] for _ in range(5)]
    addr = g.addr(direct_alice)
    assert _ids(g.c.get_player_history(addr, 2)) == ids[::-1][:2]
    assert _ids(g.c.get_player_history(addr, 0)) == ids[::-1]
    assert _ids(g.c.get_player_history(addr, 10_000)) == ids[::-1]


def test_history_includes_open_and_expired_chapters(funded, direct_alice):
    g = funded
    a = g.start(direct_alice)
    g.warp("2027-01-01T00:00:00Z")
    g.as_(direct_alice); g.c.expire_quest(a)
    b = g.start(direct_alice)
    hist = g.c.get_player_history(g.addr(direct_alice), 10)
    assert _ids(hist) == [b, a]
    assert [h.status_label for h in hist] == ["ACTIVE", "EXPIRED"]
