import { Suspense, lazy, useCallback, useEffect, useState } from "react";
import Emblem from "../Emblem";

const HeroScene = lazy(() => import("./HeroScene"));

function webglAvailable(): boolean {
  try {
    const canvas = document.createElement("canvas");
    return !!(canvas.getContext("webgl2") || canvas.getContext("webgl"));
  } catch {
    return false;
  }
}

function wantsStatic(): boolean {
  try {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return true;
    const params = new URLSearchParams(window.location.search + "&" + window.location.hash.split("?")[1]);
    return params.get("lowfx") === "1";
  } catch {
    return false;
  }
}

/**
 * The 3D doorway. The three.js chunk is fetched only after first paint, and
 * everything falls back to the static emblem when WebGL is unavailable, the
 * visitor prefers reduced motion, `?lowfx=1` is set, or the context is lost.
 */
export default function HeroVisual() {
  const [mode, setMode] = useState<"pending" | "webgl" | "static">("pending");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (wantsStatic() || !webglAvailable()) {
      setMode("static");
      return;
    }
    const timer = window.setTimeout(() => setMode("webgl"), 60);
    return () => window.clearTimeout(timer);
  }, []);

  const fail = useCallback(() => setMode("static"), []);
  const done = useCallback(() => setReady(true), []);

  return (
    <div
      className="relative mx-auto aspect-[4/5] w-full max-w-md sm:max-w-lg lg:max-w-none"
      data-testid="hero-visual"
      data-mode={mode}
      data-ready={ready}
    >
      <div
        aria-hidden="true"
        className={`absolute inset-0 flex items-center justify-center transition-opacity duration-700 ${mode === "webgl" && ready ? "opacity-0" : "opacity-100"}`}
      >
        <div className="absolute h-3/5 w-3/5 rounded-full bg-ember-500/20 blur-3xl" />
        <Emblem size={260} glow className="relative drop-shadow-[0_0_40px_rgba(240,138,60,0.35)]" />
      </div>
      {mode === "webgl" && (
        <Suspense fallback={null}>
          <HeroScene onFail={fail} onReady={done} />
        </Suspense>
      )}
    </div>
  );
}
