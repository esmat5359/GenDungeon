import { Link } from "react-router-dom";
import GenLayerMark from "./GenLayerMark";
import { shortAddress } from "../lib/format";
import { useSession, useSnapshot } from "../state/session";

export default function Footer() {
  const { config } = useSession();
  const snap = useSnapshot();
  const healthy = snap.phase === "ready" && !snap.error;
  return (
    <footer className="relative z-10 mt-24 border-t border-basalt-600/60">
      <div className="page grid gap-8 py-10 text-sm sm:grid-cols-3">
        <div>
          <div className="flex items-center gap-2 font-display text-xl text-vellum">
            <GenLayerMark size={20} className="text-verdigris-400" />
            GenDungeon
          </div>
          <p className="mt-3 max-w-xs text-vellum-shade">
            A dungeon master whose verdicts are agreed by independent validators, built as a GenLayer Intelligent Contract.
          </p>
        </div>
        <nav aria-label="Footer" className="grid grid-cols-2 gap-x-6 gap-y-2 text-vellum-dim">
          <Link to="/play">Play</Link>
          <Link to="/hall">Hall of fame</Link>
          <Link to="/chronicle">Chronicle</Link>
          <Link to="/vault">Vault</Link>
          <Link to="/codex">Codex</Link>
          <a href="https://github.com/reza9133/GenDungeon" target="_blank" rel="noreferrer">
            Source code
          </a>
        </nav>
        <dl className="space-y-1.5 text-xs text-vellum-shade">
          <div className="flex justify-between gap-4">
            <dt>Mode</dt>
            <dd className="text-vellum-dim">{config.mode === "live" ? "Live on Studio" : "Local simulation"}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt>Contract</dt>
            <dd className="font-mono text-vellum-dim">{config.address ? shortAddress(config.address) : "none"}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt>Version</dt>
            <dd className="text-vellum-dim">{snap.config?.version ?? "..."}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt>Connection</dt>
            <dd className={healthy ? "text-verdigris-300" : "text-oxblood-400"}>{healthy ? "healthy" : snap.phase}</dd>
          </div>
        </dl>
      </div>
    </footer>
  );
}
