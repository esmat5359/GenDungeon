import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import ScoreBars from "../components/ScoreBars";
import TierDoor from "../components/TierDoor";
import { Empty, PageHeading, Progress, Skeleton } from "../components/Shared";
import { formatDuration, weiToGen } from "../lib/format";
import {
  MAX_ACTION_CHARS,
  TIERS,
  describeProblem,
  localActionProblem,
  rankProgress,
  rewardFor,
  tierFee,
} from "../lib/rules";
import { QuestStatus, type PlayerStatsData, type QuestData } from "../lib/types";
import { useNow, useSession, useSnapshot } from "../state/session";
import { useTx } from "../state/tx";

// ------------------------------------------------------------------ side card
function AdventurerCard({ stats }: { stats: PlayerStatsData | null }) {
  if (!stats) return <Skeleton className="h-64" />;
  const progress = rankProgress(stats.renown);
  return (
    <aside className="panel" aria-label="Your adventurer">
      <p className="eyebrow">Your adventurer</p>
      <p className="mt-2 font-display text-3xl text-vellum">{stats.rankLabel}</p>
      <div className="mt-4">
        <div className="mb-1.5 flex justify-between text-xs text-vellum-shade">
          <span className="num">{stats.renown} renown</span>
          <span className="num">{stats.nextRankAt === 0 ? "top rank" : `next at ${stats.nextRankAt}`}</span>
        </div>
        <Progress value={progress} label="Progress to next rank" />
      </div>
      <dl className="mt-5 grid grid-cols-2 gap-4 text-sm">
        {[
          ["Victories", stats.questsSucceeded],
          ["Defeats", stats.questsFailed],
          ["Win streak", stats.winStreak],
          ["Best streak", stats.bestStreak],
        ].map(([label, value]) => (
          <div key={label as string}>
            <dt className="text-xs text-vellum-shade">{label}</dt>
            <dd className="num font-display text-2xl text-vellum">{value}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-5 border-t border-basalt-600 pt-4 text-sm">
        <p className="text-xs text-vellum-shade">Rewards earned</p>
        <p className="num font-display text-2xl text-ember-300">{weiToGen(stats.totalRewardsEarned, 3)} GEN</p>
      </div>
      {stats.tamperFlags > 0 && (
        <p className="mt-4 rounded-lg border border-oxblood-500/50 bg-oxblood-500/10 p-3 text-xs text-oxblood-400">
          {stats.tamperFlags} attempt{stats.tamperFlags === 1 ? " was" : "s were"} struck from the chronicle for trying to manipulate the judge.
        </p>
      )}
    </aside>
  );
}

// -------------------------------------------------------------------- connect
function ConnectPanel() {
  const { wallet } = useSession();
  return (
    <div className="panel mx-auto max-w-xl text-center">
      <p className="eyebrow">Before you descend</p>
      <h2 className="h2 mt-2">Bring a wallet</h2>
      <p className="mx-auto mt-3 max-w-md text-sm text-vellum-dim">
        Quests are paid for and rewarded on GenLayer Studio. Use MetaMask, or let the page create a throwaway account that lives only
        in this browser.
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <button className="btn-primary" type="button" onClick={() => void wallet.connectMetaMask()} disabled={wallet.connecting}>
          Connect MetaMask
        </button>
        <button className="btn-ghost" type="button" onClick={() => wallet.connectBurner()} disabled={wallet.connecting}>
          Use a burner account
        </button>
      </div>
      {wallet.error && <p className="mt-4 text-sm text-oxblood-400">{wallet.error}</p>}
    </div>
  );
}

// ------------------------------------------------------------- tier selection
function TierPicker() {
  const { api } = useSession();
  const snap = useSnapshot();
  const tx = useTx();
  const [params] = useSearchParams();
  const initial = Number(params.get("tier"));
  const [tier, setTier] = useState(Number.isInteger(initial) && initial >= 0 && initial < TIERS.length ? initial : 0);
  const cfg = snap.config;

  if (!cfg) return <Skeleton className="h-72" />;
  const fee = snap.tiers[tier]?.fee ?? tierFee(cfg.entryFee, tier);
  const top = (t: number) => rewardFor(t, 100, cfg.minReward, cfg.maxReward, cfg.rewardPool, cfg.maxPayoutBps);

  return (
    <section aria-labelledby="pick-title">
      <h2 id="pick-title" className="sr-only">
        Choose a difficulty
      </h2>
      <div className="grid gap-6 md:grid-cols-3">
        {TIERS.map((t) => (
          <TierDoor
            key={t.tier}
            tier={t.tier}
            fee={snap.tiers[t.tier]?.fee ?? tierFee(cfg.entryFee, t.tier)}
            topReward={top(t.tier)}
            selected={tier === t.tier}
            onChoose={setTier}
          />
        ))}
      </div>
      <div className="panel mt-6 flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <p className="text-sm text-vellum-dim">
            Descend into the <strong className="text-vellum">{TIERS[tier].name}</strong> for{" "}
            <strong className="num text-ember-300">{weiToGen(fee, 4)} GEN</strong>.
          </p>
          <p className="mt-1 text-xs text-vellum-shade">
            The fee joins the reward pool. A pass mark of {TIERS[tier].passScore} wins up to {weiToGen(top(tier), 4)} GEN, capped at{" "}
            {cfg.maxPayoutBps / 100}% of the pool per quest.
          </p>
        </div>
        <button
          type="button"
          className="btn-primary shrink-0 whitespace-nowrap !px-8 !py-3"
          disabled={cfg.paused || tx.busy}
          onClick={() => void tx.run(`Entering the ${TIERS[tier].name}`, (on) => api.startQuest(tier, fee, on))}
        >
          {cfg.paused ? "Dungeon closed" : "Pay and descend"}
        </button>
      </div>
    </section>
  );
}

// ------------------------------------------------------------------- scrolls
function ScenarioHead({ quest }: { quest: QuestData }) {
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="eyebrow">
          Quest #{quest.questId} - {quest.tierName}
        </p>
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-ink/60">{quest.statusLabel}</p>
      </div>
      <h2 className="mt-3 font-display text-2xl italic leading-snug sm:text-3xl">{quest.scenario}</h2>
    </>
  );
}

function ActionScroll({ quest }: { quest: QuestData }) {
  const { api } = useSession();
  const snap = useSnapshot();
  const tx = useTx();
  const now = useNow(30_000);
  const [text, setText] = useState("");
  const [problem, setProblem] = useState("");
  const [confirmFlee, setConfirmFlee] = useState(false);
  const draftKey = `gendungeon.draft.${quest.questId}`;
  const loaded = useRef(false);

  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(draftKey);
      if (saved) setText(saved);
    } catch {
      /* storage unavailable */
    }
    loaded.current = true;
  }, [draftKey]);

  useEffect(() => {
    if (!loaded.current) return;
    try {
      sessionStorage.setItem(draftKey, text);
    } catch {
      /* storage unavailable */
    }
  }, [text, draftKey]);

  useEffect(() => {
    const local = localActionProblem(text);
    if (local) {
      setProblem(text.trim() === "" ? "" : local);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      api
        .validateAction(text)
        .then((code) => !cancelled && setProblem(code))
        .catch(() => !cancelled && setProblem(""));
    }, 450);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [text, api]);

  const ttl = snap.config?.questTtlSeconds ?? 0;
  const remaining = quest.createdAt && ttl ? quest.createdAt + ttl - Math.floor(now / 1000) : 0;
  const blocked = problem !== "" || text.trim() === "";

  return (
    <div className="scroll">
      <ScenarioHead quest={quest} />
      <form
        className="mt-6"
        onSubmit={(event) => {
          event.preventDefault();
          if (blocked) return;
          void tx.run("Sealing your action", (on) => api.submitAction(quest.questId, text.trim(), on)).then((ok) => {
            if (ok) {
              try {
                sessionStorage.removeItem(draftKey);
              } catch {
                /* ignore */
              }
            }
          });
        }}
      >
        <label htmlFor="action" className="label !text-ink/70">
          What does your adventurer do?
        </label>
        <textarea
          id="action"
          className="field min-h-[9rem] resize-y leading-relaxed"
          maxLength={MAX_ACTION_CHARS}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Describe a concrete plan: what you notice, what you try first, and how you handle the risk."
          aria-describedby="action-help"
          aria-invalid={problem !== ""}
        />
        <div id="action-help" className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs">
          <span className={problem ? "font-semibold text-oxblood-500" : "text-ink/60"} role="status">
            {problem ? describeProblem(problem) : "Relevance and plausibility both need at least 40 to count."}
          </span>
          <span className="num text-ink/60">
            {text.length}/{MAX_ACTION_CHARS}
          </span>
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <button type="submit" className="btn-primary" disabled={blocked || tx.busy}>
            Seal this action
          </button>
          {confirmFlee ? (
            <>
              <button
                type="button"
                className="btn-danger !bg-oxblood-500/10"
                onClick={() => void tx.run("Fleeing the dungeon", (on) => api.surrenderQuest(on))}
              >
                Yes, flee (the fee is lost)
              </button>
              <button type="button" className="btn-ghost" onClick={() => setConfirmFlee(false)}>
                Stay
              </button>
            </>
          ) : (
            <button type="button" className="btn-ghost" onClick={() => setConfirmFlee(true)}>
              Flee
            </button>
          )}
          <span className="ml-auto text-xs text-ink/60">
            {ttl === 0
              ? ""
              : remaining > 0
                ? `Answer within ${formatDuration(remaining)}`
                : "Time is up: anyone may close this quest"}
          </span>
        </div>
        {ttl > 0 && remaining <= 0 && (
          <button type="button" className="btn-ghost mt-3" onClick={() => void tx.run("Closing an expired quest", (on) => api.expireQuest(quest.questId, on))}>
            Close the expired quest
          </button>
        )}
      </form>
    </div>
  );
}

function ReviewScroll({ quest }: { quest: QuestData }) {
  const { api } = useSession();
  const tx = useTx();
  return (
    <div className="scroll">
      <ScenarioHead quest={quest} />
      <blockquote className="mt-6 rounded-md border-l-4 border-oxblood-500/70 bg-ink/5 px-4 py-3 text-base italic leading-relaxed">
        {quest.action}
      </blockquote>
      <p className="mt-5 text-sm leading-relaxed text-ink/75">
        Your action is sealed. Calling for judgement asks every validator to score it independently; the verdict is recorded only if
        enough of them agree. Anyone can make this call, and the outcome depends only on what is stored on-chain.
      </p>
      <button
        type="button"
        className="btn-primary mt-6 !px-8 !py-3"
        disabled={tx.busy}
        onClick={() => void tx.run("The validators are judging", (on) => api.resolveQuest(quest.questId, on))}
      >
        Call the scribes
      </button>
    </div>
  );
}

function VerdictScroll({ quest, onDismiss }: { quest: QuestData; onDismiss?: () => void }) {
  const { api } = useSession();
  const tx = useTx();
  const won = quest.status === QuestStatus.SUCCESS || quest.status === QuestStatus.CLAIMED;
  const judged = quest.relevance + quest.plausibility + quest.creativity > 0;
  const heading =
    quest.status === QuestStatus.SUCCESS
      ? "Victory"
      : quest.status === QuestStatus.CLAIMED
        ? "Victory, reward claimed"
        : quest.status === QuestStatus.EXPIRED
          ? "The trail went cold"
          : judged
            ? "Defeat"
            : "You fled";

  return (
    <div className="scroll">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="eyebrow">
          Quest #{quest.questId} - {quest.tierName}
        </p>
        <p className={`font-display text-3xl ${won ? "text-verdigris-700" : "text-oxblood-500"}`}>{heading}</p>
      </div>
      <p className="mt-3 text-sm italic text-ink/70">{quest.scenario}</p>
      {quest.action && <blockquote className="mt-4 rounded-md border-l-4 border-ink/30 bg-ink/5 px-4 py-3 text-sm italic">{quest.action}</blockquote>}
      {quest.narrative && <p className="mt-5 font-display text-xl leading-snug">{quest.narrative}</p>}
      {judged && (
        <div className="mt-6 max-w-md">
          <ScoreBars relevance={quest.relevance} plausibility={quest.plausibility} creativity={quest.creativity} tier={quest.tier} />
        </div>
      )}
      <div className="mt-7 flex flex-wrap items-center gap-3">
        {quest.status === QuestStatus.SUCCESS ? (
          <>
            <button type="button" className="btn-primary !px-8 !py-3" disabled={tx.busy} onClick={() => void tx.run("Claiming your reward", (on) => api.claimReward(quest.questId, on))}>
              {quest.reward > 0n ? `Claim ${weiToGen(quest.reward, 4)} GEN` : "Close this quest"}
            </button>
            {quest.reward === 0n && (
              <p className="max-w-sm text-xs text-ink/70">
                The pool was empty when the verdict landed, so this victory carries no payout. Closing it frees you to play again.
              </p>
            )}
          </>
        ) : (
          <>
            {quest.status === QuestStatus.CLAIMED && <p className="text-sm font-semibold text-verdigris-700">{weiToGen(quest.reward, 4)} GEN paid out.</p>}
            {onDismiss && (
              <button type="button" className="btn-primary" onClick={onDismiss}>
                Begin a new quest
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------- page
export default function Play() {
  const { account, config } = useSession();
  const snap = useSnapshot();
  const [dismissed, setDismissed] = useState<number | null>(null);

  const quest = snap.activeQuest;
  const last = snap.lastQuest && snap.lastQuest.questId !== dismissed ? snap.lastQuest : null;

  const main = useMemo(() => {
    if (!account) return <ConnectPanel />;
    if (snap.phase === "loading" && !snap.config) return <Skeleton className="h-96" />;
    if (snap.legacy) return <Empty title="This deployment is not the v2 contract">Point the app at a v2 deployment, or add ?demo=1 to the address.</Empty>;
    if (quest?.status === QuestStatus.ACTIVE) return <ActionScroll quest={quest} />;
    if (quest?.status === QuestStatus.SUBMITTED) return <ReviewScroll quest={quest} />;
    if (quest?.status === QuestStatus.SUCCESS) return <VerdictScroll quest={quest} />;
    if (last) return <VerdictScroll quest={last} onDismiss={() => setDismissed(last.questId)} />;
    return <TierPicker />;
  }, [account, snap.phase, snap.config, snap.legacy, quest, last]);

  return (
    <div className="page pb-8">
      <PageHeading eyebrow="The descent" title={quest ? "Your quest" : last ? "The verdict" : "Choose a door"}>
        {config.mode === "demo" ? "Everything below runs against the local simulation, so you can play freely." : "Every step is a transaction that validators must agree on."}
      </PageHeading>
      <div className="grid gap-8 lg:grid-cols-[1fr_20rem]">
        <div className="min-w-0 space-y-6 [&>section]:mt-0">{main}</div>
        {account && <AdventurerCard stats={snap.stats} />}
      </div>
      {account && !quest && last && (
        <p className="mt-8 text-sm text-vellum-shade">
          Past adventures are kept in the <Link to="/chronicle">chronicle</Link>.
        </p>
      )}
    </div>
  );
}
