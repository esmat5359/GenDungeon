#!/usr/bin/env python3
"""
Mutation check: break the contract on purpose in a handful of ways and make
sure the test suite notices every single one.

    python scripts/mutation_check.py [--keep-going]

A mutant that survives means a behaviour the tests do not actually pin down.
"""

import os
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "contracts" / "GenDungeon.py"

MUTANTS = [
    ("claim forgets to release the reserved reward",
     "        self.reserved_rewards = u256(int(self.reserved_rewards) - reward)\n        self.total_paid_out",
     "        self.total_paid_out"),
    ("resolve forgets to unlink the quest from the open feed",
     "        narrative = judged[\"narrative\"]\n        self._open_remove(quest)\n",
     "        narrative = judged[\"narrative\"]\n"),
    ("pass mark is exclusive instead of inclusive",
     "    return _overall_score(relevance, plausibility, creativity) >= TIER_PASS_SCORE[tier]",
     "    return _overall_score(relevance, plausibility, creativity) > TIER_PASS_SCORE[tier]"),
    ("reward ignores the pool",
     "    return max(0, min(scaled, pool, by_cap))",
     "    return max(0, scaled)"),
    ("injection filter disabled",
     "    for marker in _INJECTION_MARKERS:\n        if (\" \" + marker + \" \") in spaced:\n            return marker\n",
     "    for marker in ():\n        pass\n"),
    ("claim lacks the owner check",
     "        if quest.player != caller:\n            raise gl.vm.UserError(\"You do not own this quest\")\n        if quest.status != STATUS_SUCCESS:",
     "        if quest.status != STATUS_SUCCESS:"),
    ("expiry off by one",
     "        if now < created + int(self.quest_ttl):",
     "        if now <= created + int(self.quest_ttl):"),
    ("hall keeps stale duplicate entries",
     "        entries = [entry for entry in entries if entry != player]\n",
     ""),
    ("fee check removed",
     "        if paid < required:",
     "        if False:"),
    ("strict flag parsing replaced by bool()",
     "def _parse_flag(value):\n    \"\"\"Strictly parse a boolean. Only real booleans and the exact strings\n    'true' / 'false' are accepted; anything else yields None.\"\"\"\n    if isinstance(value, bool):\n        return value\n",
     "def _parse_flag(value):\n    return bool(value)\n    if isinstance(value, bool):\n        return value\n"),
    ("tampering no longer fails a quest",
     "    if tampering:\n        return False\n    if relevance < COMPONENT_FLOOR",
     "    if relevance < COMPONENT_FLOOR"),
    ("zero-reward claims emit a transfer",
     "        if reward > 0:\n            _Recipient(caller)",
     "        if True:\n            _Recipient(caller)"),
    ("surrender does not reset the streak",
     "        stats.quests_failed = u32(int(stats.quests_failed) + 1)\n        stats.win_streak = u32(0)\n        self.player_active_quest[caller] = u32(0)",
     "        stats.quests_failed = u32(int(stats.quests_failed) + 1)\n        self.player_active_quest[caller] = u32(0)"),
    ("pause is ignored",
     "        if bool(self.paused):\n            raise gl.vm.UserError(\"The dungeon is closed for now\")\n",
     ""),
]


def main() -> int:
    keep_going = "--keep-going" in sys.argv
    original = SOURCE.read_text(encoding="utf-8")
    survivors = []
    for name, old, new in MUTANTS:
        if original.count(old) != 1:
            print(f"[skip] {name}: pattern matched {original.count(old)} times")
            survivors.append(name + " (pattern)")
            continue
        with tempfile.TemporaryDirectory() as tmp:
            mutant = Path(tmp) / "GenDungeon.py"
            mutant.write_text(original.replace(old, new), encoding="utf-8")
            env = dict(os.environ, GENDUNGEON_CONTRACT=str(mutant))
            result = subprocess.run(
                [sys.executable, "-m", "pytest", "-x", "-q", "-p", "no:cacheprovider", str(ROOT / "tests")],
                cwd=ROOT, env=env, capture_output=True, text=True,
            )
        killed = result.returncode != 0
        print(f"[{'killed' if killed else 'SURVIVED'}] {name}")
        if not killed:
            survivors.append(name)
            if not keep_going:
                break
    print()
    if survivors:
        print(f"{len(survivors)} surviving mutant(s):")
        for name in survivors:
            print(f"  - {name}")
        return 1
    print(f"all {len(MUTANTS)} mutants were detected")
    return 0


if __name__ == "__main__":
    sys.exit(main())
