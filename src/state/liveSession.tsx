import { useMemo, type ReactNode } from "react";
import type { AppConfig } from "../lib/env";
import { LiveGame } from "../lib/contract";
import { createReadOnlyClient } from "../lib/genlayerClient";
import { useWallet } from "../hooks/useWallet";
import { SessionBase, type WalletControls } from "./session";

/** Live-network session: reads through a public client, writes through the wallet. */
export default function LiveSession({ config, children }: { config: AppConfig; children: ReactNode }) {
  const wallet = useWallet(true);
  const reader = useMemo(() => createReadOnlyClient(), []);
  const account = wallet.address ?? "";

  const api = useMemo(
    () => new LiveGame(config.address as `0x${string}`, reader, wallet.client, account),
    [config.address, reader, wallet.client, account],
  );

  const controls = useMemo<WalletControls>(
    () => ({
      mode: wallet.mode,
      connecting: wallet.connecting,
      error: wallet.error,
      connectMetaMask: wallet.connectMetaMask,
      connectBurner: wallet.connectBurner,
      disconnect: wallet.disconnect,
    }),
    [wallet.mode, wallet.connecting, wallet.error, wallet.connectMetaMask, wallet.connectBurner, wallet.disconnect],
  );

  return (
    <SessionBase config={config} api={api} account={account} wallet={controls} demo={null}>
      {children}
    </SessionBase>
  );
}
