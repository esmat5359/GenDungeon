import type { ReactNode } from "react";
import { shortAddress } from "../lib/format";

export function Stat({ label, value, hint, accent }: { label: string; value: ReactNode; hint?: string; accent?: "teal" | "ember" }) {
  return (
    <div className="min-w-0">
      <dt className="text-[0.7rem] font-semibold uppercase tracking-[0.16em] text-vellum-shade">{label}</dt>
      <dd
        className={`num mt-1 truncate font-display text-3xl ${accent === "ember" ? "text-ember-300" : accent === "teal" ? "text-verdigris-300" : "text-vellum"}`}
      >
        {value}
      </dd>
      {hint && <dd className="mt-0.5 text-xs text-vellum-shade">{hint}</dd>}
    </div>
  );
}

export function AddressChip({ address, you }: { address: string; you?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 font-mono text-xs text-vellum-dim" title={address}>
      {shortAddress(address)}
      {you && <span className="chip-ok !px-1.5 !py-0 text-[0.65rem]">you</span>}
    </span>
  );
}

export function PageHeading({ eyebrow, title, children }: { eyebrow: string; title: string; children?: ReactNode }) {
  return (
    <header className="pb-8 pt-10 sm:pt-14">
      <p className="eyebrow">{eyebrow}</p>
      <h1 className="display mt-3 !text-[clamp(2.2rem,5vw,3.6rem)]">{title}</h1>
      {children && <div className="lede mt-4">{children}</div>}
    </header>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-basalt-500 px-6 py-10 text-center">
      <p className="font-display text-xl text-vellum">{title}</p>
      {children && <div className="mx-auto mt-2 max-w-md text-sm text-vellum-shade">{children}</div>}
    </div>
  );
}

export function Skeleton({ className = "h-24" }: { className?: string }) {
  return <div className={`animate-pulse rounded-xl bg-basalt-700/60 ${className}`} aria-hidden="true" />;
}

export function Progress({ value, label }: { value: number; label: string }) {
  return (
    <div
      className="h-2 overflow-hidden rounded-full bg-basalt-600"
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(value * 100)}
    >
      <div className="h-full rounded-full bg-gradient-to-r from-verdigris-600 to-verdigris-300 transition-[width] duration-700" style={{ width: `${Math.round(value * 100)}%` }} />
    </div>
  );
}
