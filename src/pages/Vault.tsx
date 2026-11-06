import { useEffect, useState } from "react";
import { Empty, PageHeading, Skeleton, Stat } from "../components/Shared";
import { bpsToPercent, genToWei, weiToGen } from "../lib/format";
import { TIERS, rewardFor } from "../lib/rules";
import { useSession, useSnapshot } from "../state/session";
import { useTx } from "../state/tx";

function Flag({ ok, yes, no }: { ok: boolean; yes: string; no: string }) {
  return <span className={ok ? "chip-ok" : "chip-bad"}>{ok ? yes : no}</span>;
}

function Calculator() {
  const { api } = useSession();
  const snap = useSnapshot();
  const [tier, setTier] = useState(0);
  const [score, setScore] = useState(80);
  const [onChain, setOnChain] = useState<bigint | null>(null);
  const cfg = snap.config;

  useEffect(() => {
    let live = true;
    api
      .quoteReward(tier, score)
      .then((v) => live && setOnChain(v))
      .catch(() => live && setOnChain(null));
    return () => {
      live = false;
    };
  }, [api, tier, score, snap.config?.rewardPool]);

  if (!cfg) return <Skeleton className="h-56" />;
  const local = rewardFor(tier, score, cfg.minReward, cfg.maxReward, cfg.rewardPool, cfg.maxPayoutBps);
  const shown = onChain ?? local;
  const passes = score >= TIERS[tier].passScore;

  return (
    <div className="panel" aria-labelledby="calc-title">
      <h2 id="calc-title" className="panel-title">
        Reward calculator
      </h2>
      <p className="mt-1 text-sm text-vellum-shade">Asks the contract what a win at this score would pay right now.</p>
      <div className="mt-5 grid gap-5 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="calc-tier">Door</label>
          <select id="calc-tier" className="field" value={tier} onChange={(e) => setTier(Number(e.target.value))}>
            {TIERS.map((t) => (
              <option key={t.tier} value={t.tier}>
                {t.name} (pass {t.passScore})
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="calc-score">Score: {score}</label>
          <input id="calc-score" className="mt-3 w-full accent-ember-500" type="range" min={0} max={100} value={score} onChange={(e) => setScore(Number(e.target.value))} />
        </div>
      </div>
      <p className="num mt-6 font-display text-4xl text-ember-300">{weiToGen(shown, 4)} GEN</p>
      <p className="mt-1 text-xs text-vellum-shade">
        {passes ? "This score clears the pass mark." : `This score is below the ${TIERS[tier].passScore} needed, so it would pay nothing.`} Capped at {bpsToPercent(cfg.maxPayoutBps)} of the pool.
      </p>
    </div>
  );
}

function FundForm() {
  const { api, account } = useSession();
  const tx = useTx();
  const [amount, setAmount] = useState("0.5");
  let wei = 0n;
  let invalid = "";
  try {
    wei = genToWei(amount);
    if (wei <= 0n) invalid = "Enter an amount above zero.";
  } catch (e) {
    invalid = e instanceof Error ? e.message : "Invalid amount";
  }

  return (
    <form
      className="panel"
      onSubmit={(e) => {
        e.preventDefault();
        if (!invalid) void tx.run("Feeding the vault", (on) => api.fundPool(wei, on));
      }}
    >
      <h2 className="panel-title">Fund the pool</h2>
      <p className="mt-1 text-sm text-vellum-shade">Anyone can top up the rewards. Deposits are tracked separately from entry fees.</p>
      <label className="label mt-5" htmlFor="fund-amount">Amount in GEN</label>
      <div className="flex gap-3">
        <input id="fund-amount" className="field" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} aria-invalid={!!invalid} />
        <button className="btn-teal shrink-0" type="submit" disabled={!account || !!invalid || tx.busy}>
          Deposit
        </button>
      </div>
      {invalid && <p className="mt-2 text-xs text-oxblood-400">{invalid}</p>}
      {!account && <p className="mt-2 text-xs text-vellum-shade">Connect an account first.</p>}
    </form>
  );
}

export default function Vault() {
  const snap = useSnapshot();
  const t = snap.treasury;
  const cfg = snap.config;
  const total = t ? t.rewardPool + t.reservedRewards + t.totalPaidOut : 0n;
  const pct = (part: bigint) => (total === 0n ? 0 : Number((part * 10_000n) / total) / 100);

  return (
    <div className="page pb-8">
      <PageHeading eyebrow="The vault" title="Where every coin is accounted for">
        Entry fees and deposits flow in, wins reserve rewards, claims flow out. The contract proves the books balance on every read.
      </PageHeading>

      {!t || !cfg ? (
        snap.phase === "error" ? <Empty title="The vault could not be read">{snap.error}</Empty> : <Skeleton className="h-72" />
      ) : (
        <>
          <section className="panel" aria-labelledby="flow-title">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 id="flow-title" className="panel-title">Everything ever deposited</h2>
              <div className="flex flex-wrap gap-2">
                <Flag ok={t.invariantHolds} yes="Books balance" no="Books do not balance" />
                <Flag ok={t.solvent} yes="Fully backed" no="Balance below obligations" />
              </div>
            </div>
            <p className="num mt-3 font-display text-5xl text-vellum">
              {weiToGen(t.totalDeposited, 3)} <span className="text-2xl text-vellum-shade">GEN</span>
            </p>

            <div className="mt-6 flex h-5 overflow-hidden rounded-full bg-basalt-600" role="img" aria-label={`Of all deposits, ${pct(t.rewardPool)}% is free, ${pct(t.reservedRewards)}% is reserved and ${pct(t.totalPaidOut)}% has been paid out`}>
              <div className="bg-verdigris-500 transition-[width] duration-700" style={{ width: `${pct(t.rewardPool)}%` }} />
              <div className="bg-ember-500 transition-[width] duration-700" style={{ width: `${pct(t.reservedRewards)}%` }} />
              <div className="bg-vellum-shade transition-[width] duration-700" style={{ width: `${pct(t.totalPaidOut)}%` }} />
            </div>
            <dl className="mt-6 grid gap-6 sm:grid-cols-3">
              <div>
                <dt className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-vellum-shade"><span className="h-2.5 w-2.5 rounded-full bg-verdigris-500" />Free pool</dt>
                <dd className="num mt-1 font-display text-3xl text-vellum">{weiToGen(t.rewardPool, 3)}</dd>
                <dd className="mt-1 text-xs text-vellum-shade">Available for future wins.</dd>
              </div>
              <div>
                <dt className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-vellum-shade"><span className="h-2.5 w-2.5 rounded-full bg-ember-500" />Reserved</dt>
                <dd className="num mt-1 font-display text-3xl text-ember-300">{weiToGen(t.reservedRewards, 3)}</dd>
                <dd className="mt-1 text-xs text-vellum-shade">Won, waiting to be claimed.</dd>
              </div>
              <div>
                <dt className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-vellum-shade"><span className="h-2.5 w-2.5 rounded-full bg-vellum-shade" />Paid out</dt>
                <dd className="num mt-1 font-display text-3xl text-vellum">{weiToGen(t.totalPaidOut, 3)}</dd>
                <dd className="mt-1 text-xs text-vellum-shade">Already in players&apos; hands.</dd>
              </div>
            </dl>
          </section>

          <dl className="panel mt-6 grid grid-cols-2 gap-6 sm:grid-cols-4">
            <Stat label="Contract balance" value={weiToGen(t.contractBalance, 3)} hint="GEN actually held" />
            <Stat label="Entry fee" value={weiToGen(cfg.entryFee, 3)} hint="Shallows base price" />
            <Stat label="Reward range" value={`${weiToGen(cfg.minReward, 2)} to ${weiToGen(cfg.maxReward, 2)}`} hint="before tier multiplier" />
            <Stat label="Payout cap" value={bpsToPercent(cfg.maxPayoutBps)} hint="of the pool, per quest" accent="ember" />
          </dl>

          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            <Calculator />
            <FundForm />
          </div>
        </>
      )}
    </div>
  );
}
