import { COMPONENT_FLOOR, TIERS, WEIGHTS, overallScore } from "../lib/rules";

interface Props {
  relevance: number;
  plausibility: number;
  creativity: number;
  tier: number;
  /** Render on the dark panel instead of the vellum scroll. */
  dark?: boolean;
}

const ROWS = [
  { key: "relevance", label: "Relevance", weight: WEIGHTS.relevance, floor: true },
  { key: "plausibility", label: "Plausibility", weight: WEIGHTS.plausibility, floor: true },
  { key: "creativity", label: "Creativity", weight: WEIGHTS.creativity, floor: false },
] as const;

/** The three rubric scores, the weighted total and where the tier's pass mark sits. */
export default function ScoreBars({ relevance, plausibility, creativity, tier, dark = false }: Props) {
  const values = { relevance, plausibility, creativity };
  const total = overallScore(relevance, plausibility, creativity);
  const pass = TIERS[tier]?.passScore ?? 0;
  const track = dark ? "bg-basalt-600" : "bg-ink/15";
  const text = dark ? "text-vellum-dim" : "text-ink/80";

  return (
    <div className="space-y-3" role="group" aria-label="Rubric scores">
      {ROWS.map((row) => {
        const value = values[row.key];
        const low = row.floor && value < COMPONENT_FLOOR;
        return (
          <div key={row.key}>
            <div className={`mb-1 flex items-baseline justify-between text-xs ${text}`}>
              <span className="font-semibold uppercase tracking-[0.12em]">
                {row.label} <span className="font-normal opacity-60">x{row.weight}%</span>
              </span>
              <span className={`num font-semibold ${low ? "text-oxblood-500" : ""}`}>{value}</span>
            </div>
            <div className={`relative h-2 overflow-hidden rounded-full ${track}`}>
              <div
                className={`h-full rounded-full transition-[width] duration-700 ${low ? "bg-oxblood-500" : "bg-verdigris-500"}`}
                style={{ width: `${Math.min(100, value)}%` }}
              />
              {row.floor && (
                <span
                  className="absolute top-0 h-full w-px bg-ember-500/80"
                  style={{ left: `${COMPONENT_FLOOR}%` }}
                  title={`Minimum ${COMPONENT_FLOOR}`}
                />
              )}
            </div>
          </div>
        );
      })}
      <div className={`flex items-end justify-between border-t pt-3 ${dark ? "border-basalt-600" : "border-ink/20"}`}>
        <div>
          <div className={`text-xs font-semibold uppercase tracking-[0.12em] ${text}`}>Weighted score</div>
          <div className={`font-display text-4xl num ${dark ? "text-vellum" : "text-ink"}`}>{total}</div>
        </div>
        <div className={`text-right text-xs ${text}`}>
          <div className="font-semibold uppercase tracking-[0.12em]">Pass mark</div>
          <div className={`num text-lg font-semibold ${total >= pass ? "text-verdigris-600" : "text-oxblood-500"}`}>
            {pass}
          </div>
        </div>
      </div>
    </div>
  );
}
