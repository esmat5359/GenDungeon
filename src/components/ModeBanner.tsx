import { useSession, useSnapshot } from "../state/session";
import { LEGACY_V1_ADDRESS } from "../lib/env";

export default function ModeBanner() {
  const { config } = useSession();
  const snap = useSnapshot();

  let tone = "";
  let body: React.ReactNode = null;

  if (snap.legacy) {
    tone = "border-oxblood-500/50 bg-oxblood-500/10 text-oxblood-400";
    body = (
      <>
        <strong>Legacy contract.</strong> The contract at {config.address} does not expose the v2 interface
        {config.address?.toLowerCase() === LEGACY_V1_ADDRESS.toLowerCase() ? " (this is the original v1 deployment)" : ""}. Deploy
        contracts/GenDungeon.py and point VITE_CONTRACT_ADDRESS at it, or add ?demo=1 to explore the simulation.
      </>
    );
  } else if (config.mode === "demo") {
    tone = "border-ember-600/50 bg-ember-500/10 text-ember-300";
    body = (
      <>
        <strong>Demo mode.</strong> {config.reason}. Judging here is a small heuristic, not validator consensus, and nothing is paid
        on-chain.
      </>
    );
  } else if (snap.phase === "error") {
    tone = "border-oxblood-500/50 bg-oxblood-500/10 text-oxblood-400";
    body = <>The network could not be reached: {snap.error}. Retrying every few seconds.</>;
  } else if (snap.config?.paused) {
    tone = "border-ember-600/50 bg-ember-500/10 text-ember-300";
    body = <>The keeper has closed the dungeon. You can still claim rewards and read the chronicle, but no new quests can start.</>;
  }

  if (!body) return null;
  return (
    <div className="relative z-10 border-b border-basalt-600/60" role="status">
      <div className={`page my-3 rounded-lg border px-4 py-2.5 text-xs leading-relaxed sm:text-sm ${tone}`}>{body}</div>
    </div>
  );
}
