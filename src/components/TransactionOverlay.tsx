import { useEffect, useRef } from "react";
import { TX_STAGES } from "../lib/types";
import type { TxView } from "../state/tx";
import GenLayerMark from "./GenLayerMark";

const STAGE_COPY: Record<string, { name: string; text: string }> = {
  PENDING: { name: "Submitted", text: "Your transaction is queued for the network." },
  PROPOSING: { name: "Leader proposes", text: "One validator runs the contract and proposes a result." },
  COMMITTING: { name: "Validators vote", text: "The other validators re-run it independently and commit a vote." },
  REVEALING: { name: "Votes revealed", text: "Sealed votes are opened and counted." },
  ACCEPTED: { name: "Accepted", text: "A majority agreed. The result is recorded." },
  FINALIZED: { name: "Finalized", text: "The appeal window has closed." },
};

function stageIndex(stage: string): number {
  const at = TX_STAGES.indexOf(stage as (typeof TX_STAGES)[number]);
  return at < 0 ? 0 : at;
}

interface Props {
  view: TxView;
  onClose: () => void;
}

export default function TransactionOverlay({ view, onClose }: Props) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const active = view.phase === "done" ? 4 : stageIndex(view.stage);
  const failed = view.phase === "failed";

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && view.phase !== "running") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      previous?.focus?.();
    };
  }, [onClose, view.phase]);

  const current = STAGE_COPY[TX_STAGES[Math.min(active, 5)]];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-basalt-950/85 p-4 backdrop-blur-md"
      role="dialog"
      aria-modal="true"
      aria-labelledby="tx-title"
    >
      <div className="panel w-full max-w-lg !p-7 glow-teal animate-rise">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="eyebrow">Validator consensus</p>
            <h2 id="tx-title" className="mt-1 font-display text-2xl text-vellum">
              {view.title}
            </h2>
          </div>
          <button
            ref={closeRef}
            type="button"
            className="btn-ghost !px-3 !py-1.5 text-xs"
            onClick={onClose}
            disabled={view.phase === "running"}
          >
            {view.phase === "running" ? "Working" : "Close"}
          </button>
        </div>

        {/* Validators gather around the contract */}
        <div className="relative mx-auto my-6 h-44 w-44" aria-hidden="true">
          <div
            className={`absolute inset-0 rounded-full border border-dashed ${failed ? "border-oxblood-500/50" : "border-verdigris-500/40"} ${view.phase === "running" ? "motion-safe:animate-[spin_16s_linear_infinite]" : ""}`}
          />
          {Array.from({ length: 5 }).map((_, i) => {
            const angle = (i / 5) * Math.PI * 2 - Math.PI / 2;
            const lit = active >= 2 + (i > 2 ? 1 : 0) || view.phase === "done";
            return (
              <span
                key={i}
                className={`absolute h-4 w-4 rounded-full border transition-all duration-500 ${
                  failed
                    ? "border-oxblood-500 bg-basalt-800"
                    : lit
                      ? "border-verdigris-300 bg-verdigris-400 shadow-[0_0_14px_rgba(95,199,176,0.9)]"
                      : "border-basalt-500 bg-basalt-800"
                }`}
                style={{
                  left: `calc(50% + ${Math.cos(angle) * 78}px - 8px)`,
                  top: `calc(50% + ${Math.sin(angle) * 78}px - 8px)`,
                }}
              />
            );
          })}
          <div className="absolute inset-0 flex items-center justify-center">
            <GenLayerMark
              size={64}
              className={`${failed ? "text-oxblood-500" : view.phase === "done" ? "text-verdigris-400" : "text-ember-500"} ${view.phase === "running" ? "animate-flicker" : ""}`}
            />
          </div>
        </div>

        <ol className="grid grid-cols-6 gap-1" aria-label="Consensus progress">
          {TX_STAGES.map((stage, i) => (
            <li key={stage} className="text-center">
              <div
                className={`mx-auto h-1.5 rounded-full transition-colors duration-500 ${
                  failed && i === active
                    ? "bg-oxblood-500"
                    : i <= active
                      ? "bg-verdigris-500"
                      : "bg-basalt-600"
                }`}
              />
              <span className={`mt-1.5 block text-[0.62rem] leading-tight ${i <= active ? "text-vellum" : "text-basalt-500"}`}>
                {STAGE_COPY[stage].name}
              </span>
            </li>
          ))}
        </ol>

        <p className="mt-5 min-h-[3rem] text-sm leading-relaxed text-vellum-dim" role="status" aria-live="polite">
          {failed ? (
            <>
              <span className="font-semibold text-oxblood-400">Not accepted. </span>
              {view.message}
            </>
          ) : view.phase === "done" ? (
            <span className="font-semibold text-verdigris-300">{view.message}.</span>
          ) : (
            current.text
          )}
        </p>
        {view.phase === "running" && (
          <p className="mt-1 text-xs text-vellum-shade">
            Validators reach agreement through several LLM calls, so this can take a minute.
          </p>
        )}
      </div>
    </div>
  );
}
