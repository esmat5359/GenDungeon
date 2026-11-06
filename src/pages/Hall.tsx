import { Link } from "react-router-dom";
import { AddressChip, Empty, PageHeading, Skeleton } from "../components/Shared";
import { sameAddress, timeAgo, weiToGen } from "../lib/format";
import { RANK_NAMES, RANK_THRESHOLDS } from "../lib/rules";
import { QuestStatus } from "../lib/types";
import { useNow, useSession, useSnapshot } from "../state/session";
import { useTx } from "../state/tx";

export default function Hall() {
  const { account, api } = useSession();
  const snap = useSnapshot();
  const tx = useTx();
  const now = useNow(30_000);
  const ttl = snap.config?.questTtlSeconds ?? 0;

  return (
    <div className="page pb-8">
      <PageHeading eyebrow="Hall of fame" title="Renown is earned, never bought">
        The ten most renowned adventurers, ordered by the renown the contract has awarded them. Wins, tiers and streaks all add to it.
      </PageHeading>

      <div className="grid gap-8 lg:grid-cols-[1.4fr_1fr]">
        <section className="panel !p-0 overflow-hidden" aria-labelledby="board-title">
          <h2 id="board-title" className="panel-title border-b border-basalt-600 px-5 py-4">
            The board
          </h2>
          {snap.phase === "loading" && snap.hall.length === 0 ? (
            <div className="p-5">
              <Skeleton className="h-48" />
            </div>
          ) : snap.hall.length === 0 ? (
            <div className="p-5">
              <Empty title="The board is empty">Win a quest and your name goes first.</Empty>
            </div>
          ) : (
            <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Hall of fame table, scrollable">
              <table className="w-full min-w-[34rem] text-left text-sm">
                <caption className="sr-only">Top adventurers by renown</caption>
                <thead className="text-xs uppercase tracking-[0.12em] text-vellum-shade">
                  <tr>
                    <th scope="col" className="px-5 py-3">#</th>
                    <th scope="col" className="py-3">Adventurer</th>
                    <th scope="col" className="py-3">Rank</th>
                    <th scope="col" className="py-3 text-right">Renown</th>
                    <th scope="col" className="py-3 text-right">Wins</th>
                    <th scope="col" className="py-3 text-right">Streak</th>
                    <th scope="col" className="px-5 py-3 text-right">Earned</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-basalt-600/70">
                  {snap.hall.map((h) => {
                    const me = sameAddress(h.player, account);
                    return (
                      <tr key={h.player} className={me ? "bg-verdigris-500/10" : ""}>
                        <td className="num px-5 py-3 font-display text-xl text-ember-400">{h.position}</td>
                        <td className="py-3">
                          <AddressChip address={h.player} you={me} />
                        </td>
                        <td className="py-3 text-vellum">{h.rankLabel}</td>
                        <td className="num py-3 text-right font-semibold text-vellum">{h.renown}</td>
                        <td className="num py-3 text-right">{h.questsSucceeded}</td>
                        <td className="num py-3 text-right">{h.bestStreak}</td>
                        <td className="num px-5 py-3 text-right text-ember-300">{weiToGen(h.totalRewardsEarned, 3)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="panel" aria-labelledby="ladder-title">
          <h2 id="ladder-title" className="panel-title">
            The ladder
          </h2>
          <ol className="mt-4 space-y-3">
            {RANK_NAMES.map((name, i) => {
              const mine = snap.stats?.rank === i;
              return (
                <li key={name} className={`flex items-center gap-4 rounded-lg border px-4 py-3 ${mine ? "border-ember-500 bg-ember-500/10" : "border-basalt-600"}`}>
                  <span className="num w-6 text-xl text-vellum-shade">{i + 1}</span>
                  <span className="flex-1 font-display text-lg text-vellum">{name}</span>
                  <span className="num text-xs text-vellum-shade">{RANK_THRESHOLDS[i]}+</span>
                </li>
              );
            })}
          </ol>
          {snap.stats && (
            <p className="mt-4 text-sm text-vellum-dim">
              You hold <strong className="num text-vellum">{snap.stats.renown}</strong> renown as a {snap.stats.rankLabel}.
            </p>
          )}
        </section>
      </div>

      <section className="mt-12" aria-labelledby="open-title">
        <div className="mb-4 flex items-end justify-between gap-4">
          <h2 id="open-title" className="h2">
            In the dungeon now
          </h2>
          <Link to="/play" className="btn-ghost !no-underline">
            Join them
          </Link>
        </div>
        {snap.openQuests.length === 0 ? (
          <Empty title="No open quests">Everyone who started has been judged.</Empty>
        ) : (
          <ul className="grid gap-4 md:grid-cols-2">
            {snap.openQuests.map((q) => {
              const stale = q.status === QuestStatus.ACTIVE && ttl > 0 && q.createdAt + ttl <= Math.floor(now / 1000);
              return (
                <li key={q.questId} className="panel">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-vellum-shade">
                    <AddressChip address={q.player} you={sameAddress(q.player, account)} />
                    <span>
                      #{q.questId} - {q.tierName} - {timeAgo(q.createdAt)}
                    </span>
                  </div>
                  <p className="mt-3 text-sm italic leading-relaxed text-vellum">{q.scenario}</p>
                  <div className="mt-4 flex items-center justify-between">
                    <span className={q.status === QuestStatus.SUBMITTED ? "chip-warn" : "chip"}>{q.statusLabel}</span>
                    {stale && (
                      <button type="button" className="btn-ghost !px-3 !py-1.5 text-xs" disabled={!account || tx.busy} onClick={() => void tx.run("Closing an expired quest", (on) => api.expireQuest(q.questId, on))}>
                        Close expired quest
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <p className="mt-4 text-xs text-vellum-shade">
          A quest nobody answers within the time limit can be closed by anyone, which keeps this list honest.
        </p>
      </section>
    </div>
  );
}
