import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import ScoreBars from "../components/ScoreBars";
import { Empty, PageHeading, Skeleton } from "../components/Shared";
import { timeAgo, weiToGen } from "../lib/format";
import { QuestStatus, type HistoryItem, type QuestData } from "../lib/types";
import { useSession, useSnapshot } from "../state/session";

type Filter = "all" | "wins" | "losses" | "open";

const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: "all", label: "All" },
  { id: "wins", label: "Victories" },
  { id: "losses", label: "Defeats" },
  { id: "open", label: "Unfinished" },
];

function matches(item: HistoryItem, filter: Filter): boolean {
  const s = item.status;
  if (filter === "wins") return s === QuestStatus.SUCCESS || s === QuestStatus.CLAIMED;
  if (filter === "losses") return s === QuestStatus.FAILED || s === QuestStatus.EXPIRED;
  if (filter === "open") return s === QuestStatus.ACTIVE || s === QuestStatus.SUBMITTED;
  return true;
}

function tone(status: number): string {
  if (status === QuestStatus.SUCCESS || status === QuestStatus.CLAIMED) return "chip-ok";
  if (status === QuestStatus.FAILED || status === QuestStatus.EXPIRED) return "chip-bad";
  return "chip-warn";
}

function Detail({ questId }: { questId: number }) {
  const { api } = useSession();
  const [quest, setQuest] = useState<QuestData | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    api
      .getQuest(questId)
      .then((q) => live && setQuest(q))
      .catch((e: unknown) => live && setError(e instanceof Error ? e.message : "Could not load this quest."));
    return () => {
      live = false;
    };
  }, [api, questId]);

  if (error) return <p className="py-4 text-sm text-oxblood-400">{error}</p>;
  if (!quest) return <Skeleton className="my-4 h-28" />;
  const judged = quest.relevance + quest.plausibility + quest.creativity > 0;
  return (
    <div className="grid gap-6 border-t border-basalt-600/70 py-5 md:grid-cols-[1fr_16rem]">
      <div className="space-y-4 text-sm">
        <div>
          <p className="label">The obstacle</p>
          <p className="italic text-vellum">{quest.scenario}</p>
        </div>
        {quest.action && (
          <div>
            <p className="label">Your action</p>
            <p className="text-vellum-dim">{quest.action}</p>
          </div>
        )}
        {quest.narrative && (
          <div>
            <p className="label">The scribes wrote</p>
            <p className="font-display text-lg text-vellum">{quest.narrative}</p>
          </div>
        )}
      </div>
      {judged && (
        <div>
          <ScoreBars dark relevance={quest.relevance} plausibility={quest.plausibility} creativity={quest.creativity} tier={quest.tier} />
        </div>
      )}
    </div>
  );
}

export default function Chronicle() {
  const { account } = useSession();
  const snap = useSnapshot();
  const [filter, setFilter] = useState<Filter>("all");
  const [openId, setOpenId] = useState<number | null>(null);

  const rows = useMemo(() => snap.history.filter((h) => matches(h, filter)), [snap.history, filter]);
  const wins = snap.history.filter((h) => matches(h, "wins")).length;
  const earned = snap.history.reduce((sum, h) => sum + (h.status === QuestStatus.CLAIMED ? h.reward : 0n), 0n);

  return (
    <div className="page pb-8">
      <PageHeading eyebrow="Your chronicle" title="Every quest, on the record">
        The contract keeps your last quests and the scores behind each verdict, so you can see exactly why a plan worked or fell short.
      </PageHeading>

      {!account ? (
        <Empty title="Connect to read your chronicle">
          Your history is tied to the account you play with. <Link to="/play">Open the play page</Link> to connect.
        </Empty>
      ) : snap.phase === "loading" && snap.history.length === 0 ? (
        <Skeleton className="h-64" />
      ) : snap.history.length === 0 ? (
        <Empty title="Nothing written yet">
          Your first quest will appear here. <Link to="/play">Descend</Link> when you are ready.
        </Empty>
      ) : (
        <>
          <dl className="mb-8 grid grid-cols-3 gap-4">
            <div className="panel !p-4">
              <dt className="text-xs text-vellum-shade">Shown</dt>
              <dd className="num font-display text-3xl text-vellum">{snap.history.length}</dd>
            </div>
            <div className="panel !p-4">
              <dt className="text-xs text-vellum-shade">Victories</dt>
              <dd className="num font-display text-3xl text-verdigris-300">{wins}</dd>
            </div>
            <div className="panel !p-4">
              <dt className="text-xs text-vellum-shade">Claimed</dt>
              <dd className="num font-display text-3xl text-ember-300">{weiToGen(earned, 3)}</dd>
            </div>
          </dl>

          <div className="mb-5 flex flex-wrap gap-2" role="group" aria-label="Filter quests">
            {FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                aria-pressed={filter === f.id}
                onClick={() => setFilter(f.id)}
                className={`chip transition ${filter === f.id ? "!border-ember-500 !text-ember-300" : "hover:!border-basalt-500"}`}
              >
                {f.label}
              </button>
            ))}
          </div>

          <ul className="space-y-3">
            {rows.map((item) => {
              const open = openId === item.questId;
              return (
                <li key={item.questId} className="panel !p-0">
                  <button
                    type="button"
                    className="flex w-full flex-wrap items-center gap-x-5 gap-y-2 px-5 py-4 text-left"
                    aria-expanded={open}
                    onClick={() => setOpenId(open ? null : item.questId)}
                  >
                    <span className="font-display text-2xl text-vellum">#{item.questId}</span>
                    <span className="text-sm text-vellum-dim">{item.tierName}</span>
                    <span className={tone(item.status)}>{item.statusLabel}</span>
                    {item.score > 0 && <span className="num text-sm text-vellum-dim">score {item.score}</span>}
                    {item.reward > 0n && <span className="num text-sm text-ember-300">{weiToGen(item.reward, 3)} GEN</span>}
                    <span className="ml-auto text-xs text-vellum-shade">{timeAgo(item.createdAt)}</span>
                  </button>
                  {open && (
                    <div className="px-5">
                      <Detail questId={item.questId} />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          {rows.length === 0 && <Empty title="Nothing matches this filter" />}
        </>
      )}
    </div>
  );
}
