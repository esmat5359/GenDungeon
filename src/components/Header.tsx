import { useEffect, useRef, useState } from "react";
import { Link, NavLink } from "react-router-dom";
import Emblem from "./Emblem";
import GenLayerMark from "./GenLayerMark";
import { sameAddress, shortAddress } from "../lib/format";
import { useSession, useSnapshot } from "../state/session";

const NAV = [
  { to: "/", label: "Gate", end: true },
  { to: "/play", label: "Play" },
  { to: "/chronicle", label: "Chronicle" },
  { to: "/hall", label: "Hall" },
  { to: "/vault", label: "Vault" },
  { to: "/codex", label: "Codex" },
  { to: "/keeper", label: "Keeper" },
];

function WalletControl() {
  const { config, account, wallet, demo } = useSession();
  const snap = useSnapshot();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  if (config.mode === "demo" && demo) {
    return (
      <div className="flex items-center gap-2" role="group" aria-label="Demo identity">
        <span className="chip-warn hidden sm:inline-flex">Demo</span>
        <div className="inline-flex rounded-lg border border-basalt-500 p-0.5 text-xs">
          {(["adventurer", "keeper"] as const).map((who) => (
            <button
              key={who}
              type="button"
              aria-pressed={demo.identity === who}
              onClick={() => demo.setIdentity(who)}
              className={`rounded-md px-2.5 py-1.5 font-semibold capitalize transition sm:px-3 ${demo.identity === who ? "bg-ember-500 text-basalt-950" : "text-vellum-dim hover:text-vellum"}`}
            >
              <span className="sm:hidden">{who === "adventurer" ? "Player" : "Keeper"}</span>
              <span className="hidden sm:inline">{who === "adventurer" ? "Adventurer" : "Keeper"}</span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  if (!account) {
    return (
      <div className="relative" ref={box}>
        <button type="button" className="btn-primary !py-2" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-haspopup="menu" disabled={wallet.connecting}>
          {wallet.connecting ? "Connecting" : "Connect"}
        </button>
        {open && (
          <div role="menu" className="panel absolute right-0 top-full z-40 mt-2 w-72 !p-3">
            <button role="menuitem" type="button" className="btn-ghost w-full justify-start" onClick={() => { setOpen(false); void wallet.connectMetaMask(); }}>
              MetaMask
            </button>
            <button role="menuitem" type="button" className="btn-ghost mt-2 w-full justify-start" onClick={() => { setOpen(false); wallet.connectBurner(); }}>
              In-browser burner account
            </button>
            <p className="mt-3 text-xs leading-relaxed text-vellum-shade">
              The burner key stays in this browser. Fund its address from the GenLayer Studio faucet before playing.
            </p>
            {wallet.error && <p className="mt-2 text-xs text-oxblood-400">{wallet.error}</p>}
          </div>
        )}
      </div>
    );
  }

  const isOwner = sameAddress(account, snap.owner);
  return (
    <div className="relative" ref={box}>
      <button type="button" className="btn-ghost !py-2" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-haspopup="menu">
        <span className="h-2 w-2 rounded-full bg-verdigris-400" aria-hidden="true" />
        <span className="font-mono text-xs">{shortAddress(account)}</span>
        {isOwner && <span className="chip-warn !px-2 !py-0 text-[0.65rem]">keeper</span>}
      </button>
      {open && (
        <div role="menu" className="panel absolute right-0 top-full z-40 mt-2 w-64 !p-3">
          <p className="text-xs text-vellum-shade">
            {wallet.mode === "burner" ? "Burner account" : "MetaMask"}
            {snap.stats ? ` - ${snap.stats.rankLabel}, ${snap.stats.renown} renown` : ""}
          </p>
          <button role="menuitem" type="button" className="btn-ghost mt-3 w-full" onClick={() => { setOpen(false); void wallet.disconnect(); }}>
            Disconnect
          </button>
        </div>
      )}
    </div>
  );
}

export default function Header() {
  const [menu, setMenu] = useState(false);
  return (
    <header className="sticky top-0 z-30 border-b border-basalt-600/60 bg-basalt-950/95">
      <a href="#main" className="sr-only-focusable absolute left-3 top-3 z-50 rounded bg-ember-500 px-3 py-2 text-sm font-semibold text-basalt-950">
        Skip to content
      </a>
      <div className="page flex items-center justify-between gap-2 py-3 sm:gap-4">
        <Link to="/" className="group flex items-center gap-3 !no-underline" aria-label="GenDungeon home">
          <Emblem size={36} className="transition-transform duration-300 group-hover:scale-105" />
          <span className="leading-none">
            <span className="block font-display text-xl text-vellum sm:text-2xl">GenDungeon</span>
            <span className="mt-1 hidden items-center gap-1 text-[0.62rem] font-semibold uppercase tracking-[0.2em] text-vellum-shade sm:flex">
              on <GenLayerMark size={10} className="text-verdigris-400" /> GenLayer
            </span>
          </span>
        </Link>

        <nav aria-label="Primary" className="hidden items-center gap-1 lg:flex">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `rounded-md px-3 py-1.5 text-sm font-medium !no-underline transition ${isActive ? "bg-basalt-700 text-ember-300" : "text-vellum-dim hover:text-vellum"}`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <WalletControl />
          <button
            type="button"
            className="btn-ghost !px-2.5 !py-2 lg:hidden"
            aria-expanded={menu}
            aria-controls="mobile-nav"
            onClick={() => setMenu((v) => !v)}
          >
            Menu
          </button>
        </div>
      </div>
      {menu && (
        <nav id="mobile-nav" aria-label="Primary" className="page grid grid-cols-3 gap-2 pb-3 lg:hidden">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              onClick={() => setMenu(false)}
              className={({ isActive }) =>
                `rounded-md border px-3 py-2 text-center text-sm !no-underline ${isActive ? "border-ember-600 text-ember-300" : "border-basalt-600 text-vellum-dim"}`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
      )}
    </header>
  );
}
