import { Link } from "react-router-dom";
import { PageHeading } from "../components/Shared";
import { useSession, useSnapshot } from "../state/session";
import { bpsToPercent, formatDuration, shortAddress } from "../lib/format";
import {
  COMPONENT_FLOOR,
  RANK_NAMES,
  RANK_THRESHOLDS,
  TIERS,
  WEIGHTS,
  MAX_ACTION_CHARS,
} from "../lib/rules";

const CHANGES: Array<[string, string, string]> = [
  ["Verdict", "One LLM call returns a score and a success flag; the string \"false\" was read as success.", "Three rubric scores; the contract itself computes the verdict from them."],
  ["Failure when the pool is empty", "A win against an empty pool left the player stuck with no way to play again.", "The win is recorded with a zero reward and can be closed to free the player."],
  ["Accounting", "A reward left the free pool when its verdict landed, but nothing recorded what had been deposited, reserved or paid, so the books could not be audited.", "Deposits, reservations and payouts are counted separately and the treasury view proves that they add up."],
  ["Size of one win", "A single win could take the entire pool.", "A per-quest payout cap limits any one win to a share of the pool (half by default)."],
  ["Manipulating the judge", "Player text went straight into the prompt.", "Submit-time filter, delimited untrusted-data framing, a validator-side audit and a tamper flag that always fails a quest."],
  ["Difficulty", "A single flat game.", "Three tiers with their own fee, pass mark, reward multiplier and renown."],
  ["Progression", "Win and loss counters.", "Renown, six ranks, win streaks and an on-chain top-ten hall of fame."],
  ["Operations", "Owner could change fees; nothing else.", "Payout cap, quest expiry, pause switch and two-step ownership transfer."],
  ["Observability", "Getters for config, quests, stats, history and the open feed.", "Treasury view with a solvency check and a books-balance invariant, quote and validate views, events for every transition."],
];

function Section({ id, eyebrow, title, children }: { id: string; eyebrow: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-28 border-t border-basalt-600/60 py-12" aria-labelledby={`${id}-t`}>
      <p className="eyebrow">{eyebrow}</p>
      <h2 id={`${id}-t`} className="h2 mt-2">
        {title}
      </h2>
      <div className="mt-5 max-w-3xl space-y-4 leading-relaxed text-vellum-dim">{children}</div>
    </section>
  );
}

export default function Codex() {
  const { config } = useSession();
  const snap = useSnapshot();
  const cfg = snap.config;

  const toc = [
    ["consensus", "Consensus"],
    ["rubric", "Rubric"],
    ["doors", "Doors"],
    ["economy", "Economy"],
    ["safety", "Safety"],
    ["ranks", "Ranks"],
    ["v2", "What changed"],
    ["facts", "Contract facts"],
  ];

  return (
    <div className="page pb-8">
      <PageHeading eyebrow="The codex" title="How the dungeon decides">
        The rules, the economy and the safeguards, written to match the contract line for line.
      </PageHeading>

      <nav aria-label="On this page" className="flex flex-wrap gap-2 pb-4">
        {toc.map(([id, label]) => (
          <a key={id} href={`#${id}`} className="chip !no-underline hover:!border-verdigris-500">
            {label}
          </a>
        ))}
      </nav>

      <Section id="consensus" eyebrow="Optimistic democracy" title="Why a verdict can be trusted">
        <p>
          Judging an action needs a language model, and language models are not deterministic. GenLayer solves this with validator
          consensus: one validator (the leader) runs the contract and proposes a result, then the other validators run the same code
          independently and vote on whether their own answer matches closely enough.
        </p>
        <ol className="grid gap-3 sm:grid-cols-2">
          {[
            ["Leader proposes", "Runs the judge prompt and returns three scores and a tamper flag."],
            ["Validators re-judge", "Each one asks its own model the same question and compares."],
            ["Equivalence rule", `Same tamper flag, same derived verdict, every score within 15 points.`],
            ["Majority accepts", "Only then is the verdict written. A disagreement rotates the leader and tries again."],
          ].map(([t, d], i) => (
            <li key={t} className="panel !p-4">
              <span className="num text-2xl text-ember-500/80">{i + 1}</span>
              <p className="font-display text-lg text-vellum">{t}</p>
              <p className="mt-1 text-sm">{d}</p>
            </li>
          ))}
        </ol>
        <p>
          After acceptance there is an appeal window in which a result can be challenged before it is finalized. That is why a
          transaction shows <em>Accepted</em> first and <em>Finalized</em> later.
        </p>
      </Section>

      <Section id="rubric" eyebrow="The scoring" title="Three scores, one deterministic verdict">
        <p>
          The model never decides who wins. It only scores your action from 0 to 100 on three axes, and the contract applies a fixed
          formula to those numbers.
        </p>
        <div className="panel !p-0 overflow-hidden">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Rubric weights</caption>
            <thead className="border-b border-basalt-600 text-xs uppercase tracking-[0.12em] text-vellum-shade">
              <tr>
                <th scope="col" className="px-5 py-3">Axis</th>
                <th scope="col" className="py-3">Weight</th>
                <th scope="col" className="py-3">Floor</th>
                <th scope="col" className="px-5 py-3">Asks</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-basalt-600/70">
              <tr><td className="px-5 py-3 text-vellum">Relevance</td><td className="num">{WEIGHTS.relevance}%</td><td className="num">{COMPONENT_FLOOR}</td><td className="px-5">Does the action address this obstacle?</td></tr>
              <tr><td className="px-5 py-3 text-vellum">Plausibility</td><td className="num">{WEIGHTS.plausibility}%</td><td className="num">{COMPONENT_FLOOR}</td><td className="px-5">Could it work in a grounded fantasy world?</td></tr>
              <tr><td className="px-5 py-3 text-vellum">Creativity</td><td className="num">{WEIGHTS.creativity}%</td><td className="text-vellum-shade">none</td><td className="px-5">Is it a fresh idea rather than a cliche?</td></tr>
            </tbody>
          </table>
        </div>
        <p>
          A quest succeeds when the action was not flagged as tampering, relevance and plausibility are both at least {COMPONENT_FLOOR}, and
          the weighted total reaches the door&apos;s pass mark. The pass mark is inclusive, so a score exactly on the line wins.
        </p>
      </Section>

      <Section id="doors" eyebrow="Difficulty" title="Three doors">
        <div className="grid gap-4 sm:grid-cols-3">
          {TIERS.map((t) => (
            <div key={t.tier} className="panel">
              <h3 className="font-display text-2xl text-vellum">{t.name}</h3>
              <dl className="mt-3 space-y-1.5 text-sm">
                <div className="flex justify-between"><dt>Entry fee</dt><dd className="num text-vellum">x{t.feeBps / 10000}</dd></div>
                <div className="flex justify-between"><dt>Pass mark</dt><dd className="num text-vellum">{t.passScore}</dd></div>
                <div className="flex justify-between"><dt>Reward</dt><dd className="num text-vellum">x{t.rewardBps / 10000}</dd></div>
                <div className="flex justify-between"><dt>Renown for a win</dt><dd className="num text-vellum">{t.renownWin}</dd></div>
              </dl>
            </div>
          ))}
        </div>
      </Section>

      <Section id="economy" eyebrow="Money" title="Where the coins go">
        <ul className="list-disc space-y-2 pl-5">
          <li>Every entry fee and deposit joins the reward pool.</li>
          <li>
            A win pays between the minimum and maximum reward in proportion to the score, multiplied by the door&apos;s reward factor, and is
            then capped by the free pool and by a per-quest share of it{cfg ? ` (currently ${bpsToPercent(cfg.maxPayoutBps)})` : ""}.
          </li>
          <li>The reward is moved from the free pool into a reservation at the moment of the verdict. Later wins cannot touch it.</li>
          <li>Claiming pays out exactly the reserved amount, once. A repeated claim is rejected and sends nothing.</li>
          <li>The vault view proves that deposits always equal the pool plus reservations plus everything paid out.</li>
        </ul>
      </Section>

      <Section id="safety" eyebrow="Defence" title="Talking to the judge is not allowed">
        <p>Players can type anything, and some will try to type instructions to the model. Four layers answer that:</p>
        <ol className="list-decimal space-y-2 pl-5">
          <li>
            <strong className="text-vellum">Submit-time filter.</strong> Text of up to {MAX_ACTION_CHARS} characters is cleaned of invisible and direction-changing
            characters and checked against a list of instruction-like phrases, after undoing look-alike letters, number swaps, separators
            and letter spacing. A hit is refused before it is stored.
          </li>
          <li>
            <strong className="text-vellum">Untrusted-data framing.</strong> The judge prompt states that the player text is data, wraps it in markers the
            player cannot reproduce, and tells the model never to follow instructions inside it.
          </li>
          <li>
            <strong className="text-vellum">Tamper flag.</strong> The judge can flag manipulation. A flagged quest always fails, earns no renown and is
            recorded against the player.
          </li>
          <li>
            <strong className="text-vellum">Generated-scenario audit.</strong> Validators check that the model-written obstacle is a plain
            scenario before it is accepted.
          </li>
        </ol>
      </Section>

      <Section id="ranks" eyebrow="Progression" title="Renown and ranks">
        <p>
          A victory awards renown for the door, a fifth of the score and a streak bonus for consecutive wins. A genuine failed attempt still
          earns a little. Tampering earns nothing.
        </p>
        <ol className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {RANK_NAMES.map((name, i) => (
            <li key={name} className="panel !p-4">
              <p className="font-display text-xl text-vellum">{name}</p>
              <p className="num text-xs text-vellum-shade">{RANK_THRESHOLDS[i]}+ renown</p>
            </li>
          ))}
        </ol>
      </Section>

      <Section id="v2" eyebrow="Milestone" title="What changed since the first release">
        <div className="panel !p-0 overflow-hidden">
          <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Comparison table, scrollable">
            <table className="w-full min-w-[40rem] text-left text-sm">
              <caption className="sr-only">Version 1 compared with version 2</caption>
              <thead className="border-b border-basalt-600 text-xs uppercase tracking-[0.12em] text-vellum-shade">
                <tr>
                  <th scope="col" className="px-5 py-3">Area</th>
                  <th scope="col" className="py-3">Version 1</th>
                  <th scope="col" className="px-5 py-3">Version 2</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-basalt-600/70 align-top">
                {CHANGES.map(([area, before, after]) => (
                  <tr key={area}>
                    <th scope="row" className="px-5 py-3 font-semibold text-vellum">{area}</th>
                    <td className="py-3 pr-4">{before}</td>
                    <td className="px-5 py-3 text-vellum">{after}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </Section>

      <Section id="facts" eyebrow="Reference" title="Contract facts">
        <dl className="panel grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2">
          <div className="flex justify-between gap-4"><dt>Mode</dt><dd className="text-vellum">{config.mode}</dd></div>
          <div className="flex justify-between gap-4"><dt>Address</dt><dd className="font-mono text-vellum">{config.address ? shortAddress(config.address) : "simulation"}</dd></div>
          <div className="flex justify-between gap-4"><dt>Version</dt><dd className="text-vellum">{cfg?.version ?? "..."}</dd></div>
          <div className="flex justify-between gap-4"><dt>Quest time limit</dt><dd className="text-vellum">{cfg ? formatDuration(cfg.questTtlSeconds) : "..."}</dd></div>
          <div className="flex justify-between gap-4"><dt>Payout cap</dt><dd className="text-vellum">{cfg ? bpsToPercent(cfg.maxPayoutBps) : "..."}</dd></div>
          <div className="flex justify-between gap-4"><dt>Network</dt><dd className="text-vellum">GenLayer Studio</dd></div>
        </dl>
        <p>
          The source, the test suites and the live end-to-end script are in the{" "}
          <a href="https://github.com/reza9133/GenDungeon" target="_blank" rel="noreferrer">repository</a>. Ready to try it?{" "}
          <Link to="/play">Open the play page</Link>.
        </p>
      </Section>
    </div>
  );
}
