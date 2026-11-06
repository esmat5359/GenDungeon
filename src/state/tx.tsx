import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { GameError, type TxOutcome, type TxStatusListener } from "../lib/types";
import { useSession } from "./session";
import TransactionOverlay from "../components/TransactionOverlay";

export interface TxView {
  title: string;
  stage: string;
  phase: "running" | "done" | "failed";
  message: string;
}

interface TxContextValue {
  /** Runs a write with the consensus overlay; resolves to null on failure. */
  run: (title: string, work: (onStatus: TxStatusListener) => Promise<TxOutcome>) => Promise<TxOutcome | null>;
  busy: boolean;
}

const TxContext = createContext<TxContextValue | null>(null);

export function TxProvider({ children }: { children: ReactNode }) {
  const { store } = useSession();
  const [view, setView] = useState<TxView | null>(null);
  const closeTimer = useRef<number | undefined>(undefined);

  const close = useCallback(() => {
    window.clearTimeout(closeTimer.current);
    setView(null);
  }, []);

  const run = useCallback<TxContextValue["run"]>(
    async (title, work) => {
      window.clearTimeout(closeTimer.current);
      setView({ title, stage: "PENDING", phase: "running", message: "Waiting for the network" });
      try {
        const outcome = await work((stage) => setView((v) => (v ? { ...v, stage } : v)));
        await store.refresh();
        if (!outcome.ok) {
          setView({ title, stage: outcome.status, phase: "failed", message: outcome.error ?? "The transaction was rejected." });
          return null;
        }
        setView({ title, stage: "ACCEPTED", phase: "done", message: "Accepted by consensus" });
        closeTimer.current = window.setTimeout(close, 1400);
        return outcome;
      } catch (error) {
        const message = error instanceof GameError || error instanceof Error ? error.message : String(error);
        setView({ title, stage: "PENDING", phase: "failed", message });
        return null;
      }
    },
    [store, close],
  );

  const value = useMemo(() => ({ run, busy: view?.phase === "running" }), [run, view?.phase]);

  return (
    <TxContext.Provider value={value}>
      {children}
      {view && <TransactionOverlay view={view} onClose={close} />}
    </TxContext.Provider>
  );
}

export function useTx(): TxContextValue {
  const ctx = useContext(TxContext);
  if (!ctx) throw new Error("useTx must be used inside <TxProvider>");
  return ctx;
}
