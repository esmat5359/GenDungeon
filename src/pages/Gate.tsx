import { Link, useNavigate } from "react-router-dom";
import HeroVisual from "../components/hero/HeroVisual";
import TierDoor from "../components/TierDoor";
import { AddressChip, Empty, Skeleton, Stat } from "../components/Shared";
import { weiToGen, timeAgo } from "../lib/format";
import { TIERS, rewardFor, tierFee } from "../lib/rules";
import { useSession, useSnapshot } from "../state/session";

const STEPS = [
  { n: "I", title: "Descend", text: "Pick a door and pay its entry fee. The contract asks the validators to write you a fresh obstacle." },
  { n: "II", title: "Act", text: "Describe what your adventurer does in up to 1000 characters. Attempts to instruct the judge are refused on the spot." },
  { n: "III", title: "Be judged", text: "Independent validators score relevance, plausibility and creativity, and must agree before anything is recorded." },
  { n: "IV", title: "Claim", text: "A victory reserves your reward in the vault. Pull it whenever you like; nobody can spend it from under you." },
];

export default function Gate() {
  const navigate = useNavigate();
  const snap = useSnapshot();
  const { account } = useSession();
  const cfg = snap.config;

  const doors = TIERS.map((t) => {
    const fee = snap.tiers[t.tier]?.fee ?? (cfg ? tierFee(cfg.entryFee, t.tier) : 0n);
    const top = cfg ? rewardFor(t.tier, 100, cfg.minReward, cfg.maxReward, cfg.rewardPool, cfg.maxPayoutBps) : undefined;
    return { tier: t.tier, fee, top };
  });

  return (
    <>
      <section className="page grid items-center gap-8 pb-14 pt-10 lg:grid-cols-[1.05fr_1fr] lg:pt-16">
        <div className="stagger">
          <p className="eyebrow">An on-chain dungeon master</p>
          <h1 className="display mt-4">
            Talk your way <span className="italic text-ember-400">through</span> the dark.
          </h1>
          <p className="lede mt-6">
            Each quest is an obstacle written by an AI. You describe a plan, and a panel of independent GenLayer validators must
            agree on whether it works before the verdict is recorded and the reward is yours.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link to="/play" className="btn-primary !px-7 !py-3 text-base !no-underline">
              Enter the dungeon
            </Link>
            <Link to="/codex" className="btn-ghost !px-6 !py-3 text-base !no-underline">
              Read the codex
            </Link>
          </div>
          <ul className="mt-8 flex flex-wrap gap-2 text-xs" aria-label="Highlights">
            <li className="chip-ok">Verdicts need validator agreement</li>
            <li className="chip">Rewards reserved on victory</li>
            <li className="chip">Prompt-injection hardened</li>
          </ul>
        </div>
        <HeroVisual />
      </section>

      <section className="page" aria-label="Dungeon status">
        <dl className="panel grid grid-cols-2 gap-6 !p-6 sm:grid-cols-4">
          {cfg ? (
            <>
              <Stat label="Reward pool" value={`${weiToGen(cfg.rewardPool, 2)}`} hint="GEN, free to win" accent="teal" />
              <Stat label="Quests told" value={cfg.totalQuestsCreated} hint="since deployment" />
              <Stat label="In the dungeon" value={cfg.openQuests} hint="awaiting action or verdict" accent="ember" />
              <Stat label="Hall leader" value={snap.hall[0]?.rankLabel ?? "none yet"} hint={snap.hall[0] ? `${snap.hall[0].renown} renown` : "be the first"} />
            </>
          ) : (
            Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16" />)
          )}
        </dl>
      </section>

      <section className="page mt-20" aria-labelledby="doors-title">
        <div className="mb-8 max-w-xl">
          <p className="eyebrow">Choose your door</p>
          <h2 id="doors-title" className="h2 mt-2">
            Three depths, three prices
          </h2>
          <p className="mt-3 text-vellum-dim">
            Deeper doors cost more, demand a higher pass mark and pay more. Every number is enforced by the contract.
          </p>
        </div>
        <div className="grid gap-6 md:grid-cols-3">
          {doors.map((d) => (
            <TierDoor key={d.tier} tier={d.tier} fee={d.fee} topReward={d.top} compact onChoose={(t) => navigate(`/play?tier=${t}`)} />
          ))}
        </div>
      </section>

      <section className="page mt-24" aria-labelledby="steps-title">
        <div className="rule mb-10">
          <h2 id="steps-title" className="font-display text-2xl text-vellum">
            How a quest unfolds
          </h2>
        </div>
        <ol className="grid gap-5 md:grid-cols-4">
          {STEPS.map((s) => (
            <li key={s.n} className="panel">
              <span className="font-display text-4xl text-ember-500/80">{s.n}</span>
              <h3 className="mt-2 font-display text-xl text-vellum">{s.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-vellum-dim">{s.text}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="page mt-24 grid gap-6 lg:grid-cols-2">
        <div className="panel" aria-labelledby="live-title">
          <div className="flex items-center justify-between">
            <h2 id="live-title" className="panel-title">
              Adventurers below right now
            </h2>
            <Link to="/hall" className="text-xs">
              All
            </Link>
          </div>
          <ul className="mt-4 divide-y divide-basalt-600/70">
            {snap.openQuests.slice(0, 4).map((q) => (
              <li key={q.questId} className="py-3">
                <div className="flex items-center justify-between gap-3 text-xs text-vellum-shade">
                  <AddressChip address={q.player} you={q.player.toLowerCase() === account.toLowerCase()} />
                  <span>
                    {q.tierName} - {q.statusLabel.toLowerCase()} - {timeAgo(q.createdAt)}
                  </span>
                </div>
                <p className="mt-1.5 line-clamp-2 text-sm italic text-vellum-dim">{q.scenario}</p>
              </li>
            ))}
          </ul>
          {snap.phase === "ready" && snap.openQuests.length === 0 && <Empty title="The halls are quiet">Nobody is in the dungeon at the moment.</Empty>}
        </div>

        <div className="panel" aria-labelledby="hall-title">
          <div className="flex items-center justify-between">
            <h2 id="hall-title" className="panel-title">
              Top of the hall
            </h2>
            <Link to="/hall" className="text-xs">
              Full board
            </Link>
          </div>
          <ol className="mt-4 divide-y divide-basalt-600/70">
            {snap.hall.slice(0, 5).map((h) => (
              <li key={h.player} className="flex items-center gap-4 py-3">
                <span className="num w-6 text-xl text-ember-400">{h.position}</span>
                <div className="min-w-0 flex-1">
                  <AddressChip address={h.player} you={h.player.toLowerCase() === account.toLowerCase()} />
                  <p className="text-xs text-vellum-shade">
                    {h.rankLabel} - {h.questsSucceeded} {h.questsSucceeded === 1 ? "victory" : "victories"}
                  </p>
                </div>
                <span className="num font-display text-xl text-vellum">{h.renown}</span>
              </li>
            ))}
          </ol>
          {snap.phase === "ready" && snap.hall.length === 0 && <Empty title="No legends yet">Win a quest to claim the first place.</Empty>}
        </div>
      </section>

      <section className="page mt-24">
        <div className="panel glow-teal !p-8 sm:!p-10">
          <p className="eyebrow">New in version 2</p>
          <h2 className="h2 mt-2 max-w-2xl">A hardened contract, a living economy, a proper front door</h2>
          <ul className="mt-6 grid gap-x-10 gap-y-3 text-sm text-vellum-dim sm:grid-cols-2">
            <li>Rubric judging: three scores, a weighted total and a deterministic verdict computed by the contract itself.</li>
            <li>Prompt-injection defence at submit time, in the judge prompt and in a validator-side audit.</li>
            <li>Auditable reservations and a per-quest payout cap, so no single win can empty the pool.</li>
            <li>Three difficulty tiers, renown, ranks, win streaks and an on-chain hall of fame.</li>
            <li>Quest expiry, a pause switch and two-step ownership transfer for the keeper.</li>
            <li>Fixes for two v1 defects: the empty-pool lockout and the string &quot;false&quot; counted as success.</li>
          </ul>
          <Link to="/codex" className="btn-teal mt-8 !no-underline">
            See the full change list
          </Link>
        </div>
      </section>
    </>
  );
}
