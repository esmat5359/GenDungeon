import { useRef, type CSSProperties } from "react";
import { weiToGen } from "../lib/format";
import { TIERS } from "../lib/rules";

const NUMERALS = ["I", "II", "III"];
const TONES = [
  { glow: "rgba(95,199,176,0.55)", edge: "border-verdigris-500/70", text: "text-verdigris-300" },
  { glow: "rgba(240,138,60,0.55)", edge: "border-ember-500/70", text: "text-ember-300" },
  { glow: "rgba(212,105,91,0.55)", edge: "border-oxblood-500/80", text: "text-oxblood-400" },
];

interface Props {
  tier: number;
  fee: bigint;
  /** The most this tier could pay right now (a perfect score). */
  topReward?: bigint;
  selected?: boolean;
  disabled?: boolean;
  onChoose?: (tier: number) => void;
  /** Compact variant for the landing page. */
  compact?: boolean;
}

/** An arched doorway: one per difficulty tier. */
export default function TierDoor({ tier, fee, topReward, selected, disabled, onChoose, compact }: Props) {
  const ref = useRef<HTMLButtonElement>(null);
  const info = TIERS[tier];
  const tone = TONES[tier];

  const tilt = (event: React.PointerEvent<HTMLButtonElement>) => {
    const el = ref.current;
    if (!el || event.pointerType === "touch") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const box = el.getBoundingClientRect();
    const x = (event.clientX - box.left) / box.width - 0.5;
    const y = (event.clientY - box.top) / box.height - 0.5;
    el.style.setProperty("--rx", `${(-y * 7).toFixed(2)}deg`);
    el.style.setProperty("--ry", `${(x * 9).toFixed(2)}deg`);
  };
  const reset = () => {
    ref.current?.style.setProperty("--rx", "0deg");
    ref.current?.style.setProperty("--ry", "0deg");
  };

  const style = { "--glow": tone.glow } as CSSProperties;

  return (
    <button
      ref={ref}
      type="button"
      onClick={() => onChoose?.(tier)}
      onPointerMove={tilt}
      onPointerLeave={reset}
      disabled={disabled || !onChoose}
      aria-pressed={selected}
      style={style}
      className={`group relative flex w-full flex-col items-center rounded-2xl border bg-basalt-800/90 px-5 pb-6 pt-8 text-center transition duration-300
        ${selected ? `${tone.edge} glow-teal` : "border-basalt-600 hover:border-basalt-500"}
        ${disabled ? "opacity-50" : onChoose ? "cursor-pointer" : "cursor-default"}
        [transform:perspective(900px)_rotateX(var(--rx,0deg))_rotateY(var(--ry,0deg))]`}
    >
      {/* the doorway: a stone arch with torches either side and light spilling from within */}
      <span className={`relative block ${compact ? "h-32 w-24" : "h-36 w-28"}`} aria-hidden="true">
        <span
          className="absolute inset-0 overflow-hidden bg-basalt-950 shadow-[0_0_0_5px_#1b262b,0_0_0_6px_#3a4b52]"
          style={{ borderRadius: "999px 999px 0 0" }}
        >
          <span
            className="absolute inset-0 transition-opacity duration-300 group-hover:opacity-100"
            style={{ opacity: 0.85, background: `radial-gradient(70% 85% at 50% 100%, ${tone.glow}, transparent 75%)` }}
          />
          <span className={`absolute inset-x-0 bottom-3 font-display text-4xl leading-none ${tone.text}`}>{NUMERALS[tier]}</span>
        </span>
        <span className="absolute -left-6 top-1/2 h-3.5 w-2 -translate-y-1/2 rounded-full bg-ember-400 blur-[1px] animate-flicker" />
        <span className="absolute -right-6 top-1/2 h-3.5 w-2 -translate-y-1/2 rounded-full bg-ember-400 blur-[1px] animate-flicker [animation-delay:0.9s]" />
      </span>

      <h3 className="relative mt-6 font-display text-2xl text-vellum">{info.name}</h3>
      <p className="relative mt-2 min-h-[2.6rem] max-w-[16rem] text-xs leading-relaxed text-vellum-shade">
        {info.hint.charAt(0).toUpperCase() + info.hint.slice(1)}.
      </p>

      <dl className="relative mt-4 grid w-full grid-cols-3 gap-2 border-t border-basalt-600 pt-4 text-xs">
        <div>
          <dt className="text-vellum-shade">Entry</dt>
          <dd className="num mt-0.5 text-sm font-semibold text-vellum">{weiToGen(fee, 3)}</dd>
        </div>
        <div>
          <dt className="text-vellum-shade">Pass</dt>
          <dd className="num mt-0.5 text-sm font-semibold text-vellum">{info.passScore}</dd>
        </div>
        <div>
          <dt className="text-vellum-shade">Top prize</dt>
          <dd className="num mt-0.5 text-sm font-semibold text-vellum">
            {topReward === undefined ? `x${info.rewardBps / 10000}` : weiToGen(topReward, 3)}
          </dd>
        </div>
      </dl>
    </button>
  );
}
