"""
Shared fixtures and helpers for the GenDungeon contract tests.

The tests run the real contract code inside GenVM's in-process "direct" mode
(genlayer-test). LLM calls are mocked; validator functions are exercised
explicitly through `direct_vm.run_validator`.
"""

import json
import os
import sys
from pathlib import Path

import pytest

# GENDUNGEON_CONTRACT lets the mutation-testing script point the suite at a
# deliberately broken copy of the contract.
CONTRACT_PATH = os.environ.get("GENDUNGEON_CONTRACT") or str(
    Path(__file__).resolve().parent.parent / "contracts" / "GenDungeon.py"
)
MODULE_NAME = "_contract_" + Path(CONTRACT_PATH).stem

# genlayer-test downloads the newest GenVM release by default; newer
# releases renamed the archive it expects, so the last compatible one is
# pinned here. Bump it together with genlayer-test.
SDK_VERSION = "v0.2.16"

# Small round numbers keep reward arithmetic checkable by hand.
ENTRY_FEE = 100
MIN_REWARD = 20
MAX_REWARD = 100
TIER_FEE_BPS = (10000, 15000, 20000)
TIER_REWARD_BPS = (10000, 15000, 25000)
TIER_PASS = (40, 55, 70)

ACTIVE, SUBMITTED, SUCCESS, FAILED, CLAIMED, EXPIRED = range(6)

SCENARIO_MARK = "Invent ONE short"
AUDIT_MARK = "safety auditor"
JUDGE_MARK = "impartial Dungeon Master judge"

DEFAULT_SCENARIO = "A collapsing rope bridge blocks the only path across the chasm."
GOOD_ACTION = "I test every plank with my staff, then cross on the sturdiest beams one at a time."

# (relevance, plausibility, creativity) -> overall score
STRONG = (90, 85, 80)    # 85
SOLID = (70, 70, 70)     # 70
MIDDLING = (60, 60, 60)  # 60
WEAK = (30, 30, 30)      # 30


def overall(parts):
    rel, pla, cre = parts
    return (rel * 35 + pla * 35 + cre * 30) // 100


def lib():
    """The loaded contract module, for white-box tests of pure helpers."""
    return sys.modules[MODULE_NAME]


def set_clock(vm, iso_stamp):
    """Warp both the VM clock and the cached `gl.message_raw['datetime']`."""
    vm.warp(iso_stamp)
    gl = sys.modules.get("genlayer.gl")
    if gl is not None and getattr(gl, "message_raw", None) is not None:
        gl.message_raw["datetime"] = iso_stamp


class Game:
    """Thin driver around a deployed contract that hides the plumbing."""

    def __init__(self, vm, contract, owner):
        self.vm = vm
        self.c = contract
        self.owner = owner
        self.clock = "2026-11-01T00:00:00.000Z"
        self.sends = []      # (recipient, amount) for every native-token payout request
        self.events = []     # (topics, blob) for every emitted event
        vm._gl_call_hook = self._record_call
        set_clock(vm, self.clock)
        self.mock_scenario()
        self.mock_audit(True)
        self.mock_judge(*STRONG)

    # ---- recording of outgoing effects -----------------------------------
    def _record_call(self, _vm, request):
        if "EthSend" in request:
            send = request["EthSend"]
            self.sends.append((str(send["address"]), int(send["value"])))
            return {"ok": None}
        if "EmitEvent" in request:
            event = request["EmitEvent"]
            self.events.append((list(event["topics"]), dict(event["blob"])))
            return {"ok": None}
        return None

    def payouts_to(self, account):
        addr = self.addr(account)
        return [amount for recipient, amount in self.sends if recipient == addr]

    def events_named(self, field, value):
        return [blob for _topics, blob in self.events if blob.get(field) == value]

    # ---- mocks -----------------------------------------------------------
    def _mock(self, marker, payload):
        self.vm._llm_mocks = [
            (pattern, resp) for pattern, resp in self.vm._llm_mocks if pattern.pattern != marker
        ]
        text = payload if isinstance(payload, str) else json.dumps(payload)
        self.vm.mock_llm(marker, text)

    def mock_scenario(self, text=DEFAULT_SCENARIO):
        self._mock(SCENARIO_MARK, {"scenario": text})

    def mock_scenario_raw(self, raw):
        self._mock(SCENARIO_MARK, raw)

    def mock_audit(self, safe=True):
        self._mock(AUDIT_MARK, {"safe": safe})

    def mock_audit_raw(self, raw):
        self._mock(AUDIT_MARK, raw)

    def mock_judge(self, rel, pla, cre, tampering=False, narrative="The attempt is judged."):
        self._mock(
            JUDGE_MARK,
            {
                "relevance": rel,
                "plausibility": pla,
                "creativity": cre,
                "tampering": tampering,
                "narrative": narrative,
            },
        )

    def mock_judge_raw(self, raw):
        self._mock(JUDGE_MARK, raw)

    # ---- clock -----------------------------------------------------------
    def warp(self, iso_stamp):
        self.clock = iso_stamp
        set_clock(self.vm, iso_stamp)

    # ---- helpers ---------------------------------------------------------
    @staticmethod
    def addr(account):
        from genlayer.py.types import Address

        return str(account if isinstance(account, Address) else Address(account))

    def fee(self, tier=0):
        return int(self.c.get_config().entry_fee) * TIER_FEE_BPS[tier] // 10000

    def as_(self, account, value=0):
        self.vm.sender = account
        self.vm.value = value

    def fund(self, amount, account=None):
        self.as_(account or self.owner, amount)
        self.c.fund_pool()
        self.vm.value = 0

    def start(self, account, tier=0, value=None):
        self.as_(account, self.fee(tier) if value is None else value)
        try:
            return int(self.c.start_quest(tier))
        finally:
            self.vm.value = 0

    def act(self, account, quest_id, text=GOOD_ACTION):
        self.as_(account)
        self.c.submit_action(quest_id, text)

    def resolve(self, quest_id, by=None):
        self.as_(by or self.owner)
        return bool(self.c.resolve_quest(quest_id))

    def claim(self, account, quest_id):
        self.as_(account)
        return int(self.c.claim_reward(quest_id))

    def play(self, account, tier=0, parts=STRONG, action=GOOD_ACTION, tampering=False):
        """start -> submit -> resolve; returns (quest_id, success)."""
        self.mock_judge(*parts, tampering=tampering)
        quest_id = self.start(account, tier)
        self.act(account, quest_id, action)
        return quest_id, self.resolve(quest_id, by=account)

    # ---- reads -----------------------------------------------------------
    def quest(self, quest_id):
        return self.c.get_quest(quest_id)

    def stats(self, account):
        return self.c.get_player_stats(self.addr(account))

    def slot(self, account):
        return int(self.c.get_player_active_quest(self.addr(account)))

    def config(self):
        return self.c.get_config()

    def pool(self):
        return int(self.c.get_config().reward_pool)

    def reserved(self):
        return int(self.c.get_config().reserved_rewards)

    def treasury(self):
        return self.c.get_treasury()

    def assert_invariants(self):
        t = self.c.get_treasury()
        assert t.invariant_holds, (
            f"treasury invariant broken: deposited={int(t.total_deposited)} "
            f"pool={int(t.reward_pool)} reserved={int(t.reserved_rewards)} "
            f"paid_out={int(t.total_paid_out)}"
        )


@pytest.fixture
def game(direct_vm, direct_deploy, direct_owner):
    contract = direct_deploy(
        CONTRACT_PATH, ENTRY_FEE, MIN_REWARD, MAX_REWARD, sdk_version=SDK_VERSION
    )
    direct_vm.sender = direct_owner
    return Game(direct_vm, contract, direct_owner)


@pytest.fixture
def funded(game):
    """A game whose pool already holds plenty of free funds."""
    game.fund(10_000)
    return game


@pytest.fixture
def helpers(game):
    """The contract module's pure helper functions (needs a deployed game)."""
    return lib()
