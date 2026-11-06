import { useState, type FormEvent } from "react";
import { Empty, PageHeading, Skeleton } from "../components/Shared";
import { AddressChip } from "../components/Shared";
import { bpsToPercent, formatDuration, genToWei, sameAddress, weiToGen } from "../lib/format";
import { MAX_QUEST_TTL, MIN_QUEST_TTL } from "../lib/rules";
import type { TxOutcome, TxStatusListener } from "../lib/types";
import { useSession, useSnapshot } from "../state/session";
import { useTx } from "../state/tx";

function Card({ title, note, children }: { title: string; note: string; children: React.ReactNode }) {
  return (
    <section className="panel">
      <h2 className="panel-title">{title}</h2>
      <p className="mt-1 text-sm text-vellum-shade">{note}</p>
      <div className="mt-5">{children}</div>
    </section>
  );
}

function Field({ id, label, value, onChange, disabled, hint }: { id: string; label: string; value: string; onChange: (v: string) => void; disabled: boolean; hint?: string }) {
  return (
    <div>
      <label className="label" htmlFor={id}>{label}</label>
      <input id={id} className="field disabled:opacity-60" value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} inputMode="decimal" />
      {hint && <p className="mt-1 text-xs text-vellum-shade">{hint}</p>}
    </div>
  );
}

export default function Keeper() {
  const { api, account } = useSession();
  const snap = useSnapshot();
  const tx = useTx();
  const cfg = snap.config;
  const isOwner = sameAddress(account, snap.owner);
  const isPending = !!snap.pendingOwner && sameAddress(account, snap.pendingOwner);

  const [fee, setFee] = useState("");
  const [min, setMin] = useState("");
  const [max, setMax] = useState("");
  const [cap, setCap] = useState("");
  const [ttl, setTtl] = useState("");
  const [heir, setHeir] = useState("");
  const [formError, setFormError] = useState("");

  const value = (state: string, fallback: string) => (state === "" ? fallback : state);

  const guard = (work: () => Promise<unknown> | void) => (event: FormEvent) => {
    event.preventDefault();
    setFormError("");
    try {
      void work();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Invalid input");
    }
  };

  const run = (title: string, send: (on: TxStatusListener) => Promise<TxOutcome>) => tx.run(title, send);

  return (
    <div className="page pb-8">
      <PageHeading eyebrow="The keeper" title="Tend the dungeon">
        The owner can tune the economy, pause new quests and hand the keys on. Everyone else can read the current settings.
      </PageHeading>

      {!cfg ? (
        <Skeleton className="h-64" />
      ) : (
        <>
          <div className="panel mb-6 flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.14em] text-vellum-shade">Current keeper</p>
              <AddressChip address={snap.owner} you={isOwner} />
              {snap.pendingOwner && (
                <p className="mt-2 text-xs text-ember-300">
                  Handover pending to <span className="font-mono">{snap.pendingOwner.slice(0, 10)}...</span>
                </p>
              )}
            </div>
            <span className={isOwner ? "chip-ok" : "chip"}>{isOwner ? "You hold the keys" : account ? "Read-only for your account" : "Connect to see your access"}</span>
          </div>
          {!isOwner && !isPending && (
            <Empty title="Only the keeper can change these">The values below are live, but the forms stay locked for your account.</Empty>
          )}

          {formError && <p role="alert" className="mt-4 rounded-lg border border-oxblood-500/50 bg-oxblood-500/10 p-3 text-sm text-oxblood-400">{formError}</p>}

          <div className="mt-8 grid gap-6 lg:grid-cols-2">
            <Card title="Entry fee and rewards" note="Fees apply to new quests only. Rewards already reserved are never changed.">
              <form className="space-y-4" onSubmit={guard(() => run("Updating the economy", (on) => api.setFeeAndRewards(genToWei(value(fee, weiToGen(cfg.entryFee, 18))), genToWei(value(min, weiToGen(cfg.minReward, 18))), genToWei(value(max, weiToGen(cfg.maxReward, 18))), on)))}>
                <Field id="k-fee" label="Entry fee (GEN)" value={value(fee, weiToGen(cfg.entryFee, 18))} onChange={setFee} disabled={!isOwner} />
                <div className="grid grid-cols-2 gap-4">
                  <Field id="k-min" label="Min reward" value={value(min, weiToGen(cfg.minReward, 18))} onChange={setMin} disabled={!isOwner} />
                  <Field id="k-max" label="Max reward" value={value(max, weiToGen(cfg.maxReward, 18))} onChange={setMax} disabled={!isOwner} />
                </div>
                <button className="btn-primary" type="submit" disabled={!isOwner || tx.busy}>Save economy</button>
              </form>
            </Card>

            <Card title="Payout cap" note={`The most one quest may take from the pool. Now ${bpsToPercent(cfg.maxPayoutBps)}.`}>
              <form className="space-y-4" onSubmit={guard(() => run("Updating the payout cap", (on) => api.setPayoutCap(Number(value(cap, String(cfg.maxPayoutBps))), on)))}>
                <Field id="k-cap" label="Basis points (1 to 10000)" value={value(cap, String(cfg.maxPayoutBps))} onChange={setCap} disabled={!isOwner} hint="5000 means one win can take at most half of the pool." />
                <button className="btn-primary" type="submit" disabled={!isOwner || tx.busy}>Save cap</button>
              </form>
            </Card>

            <Card title="Quest time limit" note={`Quests nobody answers can be closed after this long. Now ${formatDuration(cfg.questTtlSeconds)}.`}>
              <form className="space-y-4" onSubmit={guard(() => run("Updating the time limit", (on) => api.setQuestTtl(Number(value(ttl, String(cfg.questTtlSeconds))), on)))}>
                <Field id="k-ttl" label="Seconds" value={value(ttl, String(cfg.questTtlSeconds))} onChange={setTtl} disabled={!isOwner} hint={`Between ${MIN_QUEST_TTL} and ${MAX_QUEST_TTL}.`} />
                <button className="btn-primary" type="submit" disabled={!isOwner || tx.busy}>Save limit</button>
              </form>
            </Card>

            <Card title="Open or close the dungeon" note="Pausing blocks new quests. Judging, claiming and expiring keep working so nobody is trapped.">
              <div className="flex flex-wrap items-center gap-4">
                <span className={cfg.paused ? "chip-bad" : "chip-ok"}>{cfg.paused ? "Closed" : "Open"}</span>
                <button className={cfg.paused ? "btn-teal" : "btn-danger"} type="button" disabled={!isOwner || tx.busy} onClick={() => void run(cfg.paused ? "Opening the dungeon" : "Closing the dungeon", (on) => api.setPaused(!cfg.paused, on))}>
                  {cfg.paused ? "Reopen" : "Close for now"}
                </button>
              </div>
            </Card>

            <Card title="Hand over the keys" note="Two steps: the owner nominates, the nominee accepts. A mistyped address can never lock the contract.">
              <form className="space-y-4" onSubmit={guard(() => run("Nominating a new keeper", (on) => api.transferOwnership(heir.trim(), on)))}>
                <div>
                  <label className="label" htmlFor="k-heir">New keeper address</label>
                  <input id="k-heir" className="field font-mono text-xs disabled:opacity-60" placeholder="0x..." value={heir} onChange={(e) => setHeir(e.target.value)} disabled={!isOwner} />
                </div>
                <div className="flex flex-wrap gap-3">
                  <button className="btn-primary" type="submit" disabled={!isOwner || heir.trim() === "" || tx.busy}>Nominate</button>
                  {snap.pendingOwner && (
                    <button className="btn-ghost" type="button" disabled={!isOwner || tx.busy} onClick={() => void run("Cancelling the handover", (on) => api.cancelOwnershipTransfer(on))}>
                      Cancel pending
                    </button>
                  )}
                </div>
              </form>
              {isPending && (
                <button className="btn-teal mt-4" type="button" disabled={tx.busy} onClick={() => void run("Accepting the keys", (on) => api.acceptOwnership(on))}>
                  Accept the keys
                </button>
              )}
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
