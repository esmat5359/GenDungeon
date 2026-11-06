"""Renown, ranks, win streaks and the Hall of Fame."""

import pytest
from gltest.direct.loader import create_address

from conftest import MIDDLING, STRONG, WEAK, overall

WIN_BASE = (20, 35, 60)


def _win(g, who, tier=0, parts=STRONG):
    qid, won = g.play(who, tier, parts=parts)
    assert won
    g.claim(who, qid)
    return qid


def _renown(g, who):
    return int(g.stats(who).renown)


def test_first_win_renown_formula(funded, direct_alice):
    g = funded
    for tier in (0, 1, 2):
        before = _renown(g, direct_alice)
        streak_before = int(g.stats(direct_alice).win_streak)
        _win(g, direct_alice, tier)
        gain = _renown(g, direct_alice) - before
        assert gain == WIN_BASE[tier] + overall(STRONG) // 5 + min(streak_before, 5) * 4


def test_streak_bonus_grows_then_caps(funded, direct_alice):
    g = funded
    gains = []
    for _ in range(8):
        before = _renown(g, direct_alice)
        _win(g, direct_alice, 0)
        gains.append(_renown(g, direct_alice) - before)
    base = WIN_BASE[0] + overall(STRONG) // 5
    assert gains == [base + min(i, 5) * 4 for i in range(8)]
    s = g.stats(direct_alice)
    assert int(s.win_streak) == 8 and int(s.best_streak) == 8


def test_losing_resets_the_streak_but_keeps_the_best_and_pays_a_consolation(funded, direct_alice):
    g = funded
    for _ in range(3):
        _win(g, direct_alice)
    before = _renown(g, direct_alice)
    qid, won = g.play(direct_alice, parts=WEAK)
    assert not won
    s = g.stats(direct_alice)
    assert int(s.win_streak) == 0 and int(s.best_streak) == 3
    assert int(s.renown) == before + 2


def test_surrender_pays_no_renown_and_resets_the_streak(funded, direct_alice):
    g = funded
    _win(g, direct_alice)
    before = _renown(g, direct_alice)
    g.start(direct_alice)
    g.as_(direct_alice)
    g.c.surrender_quest()
    assert _renown(g, direct_alice) == before
    assert int(g.stats(direct_alice).win_streak) == 0


def test_rank_climbs_with_renown(funded, direct_alice):
    g = funded
    seen = []
    for _ in range(30):
        _win(g, direct_alice, 2)
        s = g.stats(direct_alice)
        label = s.rank_label
        if not seen or seen[-1] != label:
            seen.append(label)
        if label == "Champion":
            break
    assert seen == ["Wanderer", "Squire", "Knight", "Champion"]
    s = g.stats(direct_alice)
    assert int(s.renown) >= 700 and int(s.next_rank_at) == 1500


def test_new_players_start_as_wanderers(funded, direct_alice):
    s = funded.stats(direct_alice)
    assert (int(s.renown), s.rank_label, int(s.next_rank_at)) == (0, "Wanderer", 100)


# --------------------------------------------------------------------------
# Hall of Fame
# --------------------------------------------------------------------------
def _hall(g):
    return [(e.player, int(e.renown)) for e in g.c.get_hall_of_fame()]


def test_hall_orders_by_renown(funded, direct_alice, direct_bob, direct_charlie):
    g = funded
    _win(g, direct_alice, 0)                    # 37
    _win(g, direct_bob, 2)                      # 77
    g.play(direct_charlie, parts=WEAK)          # 2 (consolation only)
    board = g.c.get_hall_of_fame()
    assert [e.player for e in board] == [g.addr(direct_bob), g.addr(direct_alice), g.addr(direct_charlie)]
    assert [int(e.position) for e in board] == [1, 2, 3]
    assert board[0].rank_label == "Wanderer"
    assert int(board[1].quests_succeeded) == 1 and int(board[2].quests_succeeded) == 0


def test_hall_reorders_when_a_player_overtakes(funded, direct_alice, direct_bob):
    g = funded
    _win(g, direct_alice, 2)
    _win(g, direct_bob, 0)
    assert [p for p, _ in _hall(g)] == [g.addr(direct_alice), g.addr(direct_bob)]
    for _ in range(3):
        _win(g, direct_bob, 2)
    assert [p for p, _ in _hall(g)] == [g.addr(direct_bob), g.addr(direct_alice)]
    assert len(_hall(g)) == 2                   # no duplicate entry for bob


def test_hall_ties_keep_the_earlier_holder_first(funded, direct_alice, direct_bob):
    g = funded
    _win(g, direct_alice, 0)
    _win(g, direct_bob, 0)
    renowns = [r for _, r in _hall(g)]
    assert renowns[0] == renowns[1]
    assert [p for p, _ in _hall(g)] == [g.addr(direct_alice), g.addr(direct_bob)]


def test_hall_is_capped_at_ten_and_evicts_the_weakest(funded):
    g = funded
    players = [create_address(f"hero{i}") for i in range(13)]
    # hero i wins i+1 Shallows quests, so renown strictly increases with i.
    for index, who in enumerate(players):
        for _ in range(index + 1):
            _win(g, who, 0)
    board = g.c.get_hall_of_fame()
    assert len(board) == 10 == int(g.config().hall_size)
    renowns = [int(e.renown) for e in board]
    assert renowns == sorted(renowns, reverse=True)
    assert [e.player for e in board] == [g.addr(p) for p in reversed(players[3:])]
    # The three weakest are gone ...
    absent = {g.addr(p) for p in players[:3]}
    assert absent.isdisjoint({e.player for e in board})
    # ... until one of them overtakes the current last place.
    while _renown(g, players[0]) <= renowns[-1]:
        _win(g, players[0], 2)
    now = [e.player for e in g.c.get_hall_of_fame()]
    assert g.addr(players[0]) in now and len(now) == 10
    assert g.addr(players[3]) not in now or _renown(g, players[3]) > _renown(g, players[0])


def test_cheaters_never_reach_the_hall(funded, direct_alice):
    g = funded
    for _ in range(3):
        g.play(direct_alice, parts=STRONG, tampering=True)
    assert g.c.get_hall_of_fame() == []
    assert int(g.stats(direct_alice).tamper_flags) == 3
