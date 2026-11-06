import {
  Suspense,
  createContext,
  lazy,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import type { GameApi } from "../lib/api";
import { resolveConfig, type AppConfig } from "../lib/env";
import { DEMO_ADVENTURER, DEMO_KEEPER, createSeededChain, type DemoChain } from "../lib/demo";
import { GameStore, type Snapshot } from "./store";
import { Skeleton } from "../components/Shared";

export type DemoIdentity = "adventurer" | "keeper";
export type WalletMode = "none" | "metamask" | "burner";

export interface WalletControls {
  mode: WalletMode;
  connecting: boolean;
  error: string | null;
  connectMetaMask: () => Promise<void>;
  connectBurner: () => void;
  disconnect: () => Promise<void>;
}

export interface Session {
  config: AppConfig;
  api: GameApi;
  store: GameStore;
  /** The connected account ("" when nobody is connected in live mode). */
  account: string;
  wallet: WalletControls;
  demo: { identity: DemoIdentity; setIdentity: (identity: DemoIdentity) => void } | null;
}

const SessionContext = createContext<Session | null>(null);

const POLL_MS = 10_000;

const NO_WALLET: WalletControls = {
  mode: "none",
  connecting: false,
  error: null,
  connectMetaMask: async () => undefined,
  connectBurner: () => undefined,
  disconnect: async () => undefined,
};

/** Builds the store, keeps it fresh and publishes the session to the tree. */
export function SessionBase({
  config,
  api,
  account,
  wallet,
  demo,
  chain,
  children,
}: {
  config: AppConfig;
  api: GameApi;
  account: string;
  wallet: WalletControls;
  demo: Session["demo"];
  chain?: DemoChain;
  children: ReactNode;
}) {
  const store = useMemo(() => new GameStore(api, account), [api, account]);

  useEffect(() => {
    void store.refresh();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void store.refresh();
    }, POLL_MS);
    const unsubscribe = chain ? chain.onChange(() => void store.refresh()) : () => undefined;
    const onVisible = () => {
      if (document.visibilityState === "visible") void store.refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      unsubscribe();
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [store, chain]);

  const value = useMemo<Session>(
    () => ({ config, api, store, account, wallet, demo }),
    [config, api, store, account, wallet, demo],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

let demoChain: DemoChain | null = null;
function getDemoChain(): DemoChain {
  if (!demoChain) demoChain = createSeededChain();
  return demoChain;
}

function DemoSession({ config, children }: { config: AppConfig; children: ReactNode }) {
  const [identity, setIdentity] = useState<DemoIdentity>("adventurer");
  const chain = getDemoChain();
  const account = identity === "keeper" ? DEMO_KEEPER : DEMO_ADVENTURER;
  const api = useMemo(() => chain.api(account), [chain, account]);
  const demo = useMemo(() => ({ identity, setIdentity }), [identity]);
  return (
    <SessionBase config={config} api={api} account={account} wallet={NO_WALLET} demo={demo} chain={chain}>
      {children}
    </SessionBase>
  );
}

// The live runtime pulls in genlayer-js (~120 kB gzipped), so demo visitors
// never download it.
const LiveSession = lazy(() => import("./liveSession"));

export function SessionProvider({ children }: { children: ReactNode }) {
  const config = useMemo(resolveConfig, []);
  if (config.mode === "demo") return <DemoSession config={config}>{children}</DemoSession>;
  return (
    <Suspense
      fallback={
        <div className="page py-16">
          <Skeleton className="h-64" />
        </div>
      }
    >
      <LiveSession config={config}>{children}</LiveSession>
    </Suspense>
  );
}

export function useSession(): Session {
  const session = useContext(SessionContext);
  if (!session) throw new Error("useSession must be used inside <SessionProvider>");
  return session;
}

export function useSnapshot(): Snapshot {
  const { store } = useSession();
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}

/** Re-renders on an interval; used for countdowns. */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}
