import { useCallback, useEffect, useRef, useState } from "react";
import {
  addressFromPrivateKey,
  createBrowserWalletClient,
  createBurnerClient,
  generateBurnerPrivateKey,
  MetaMaskNotFoundError,
  type AppGenLayerClient,
} from "../lib/genlayerClient";
import { findMetaMaskProvider } from "../lib/eip6963";

const BURNER_KEY_STORAGE = "gendungeon.burnerPrivateKey";
// Set once the player explicitly disconnects, so we don't silently
// auto-reconnect them to MetaMask on the next page load - only an
// explicit "Connect" click should do that again.
const EXPLICIT_DISCONNECT_FLAG = "gendungeon.walletExplicitlyDisconnected";

export type WalletMode = "none" | "metamask" | "burner";

interface WalletState {
  mode: WalletMode;
  address: string | null;
  client: AppGenLayerClient | null;
  connecting: boolean;
  error: string | null;
}

const INITIAL_STATE: WalletState = {
  mode: "none",
  address: null,
  client: null,
  connecting: false,
  error: null,
};

export function useWallet(enabled = true) {
  const [state, setState] = useState<WalletState>(INITIAL_STATE);
  // Tracks the exact MetaMask provider object currently in use so the
  // accountsChanged/chainChanged listeners can be attached/removed from
  // the correct instance, even if OKX or another wallet is also present.
  const activeProviderRef = useRef<any>(null);

  const resetToDisconnected = useCallback(() => {
    setState({ ...INITIAL_STATE });
  }, []);

  const attachMetaMaskListeners = useCallback(
    (provider: any) => {
      if (!provider?.on) return;

      const onAccountsChanged = (accounts: string[]) => {
        if (accounts.length === 0) {
          // The user locked or disconnected the site from inside MetaMask
          // itself - mirror that in the app instead of holding onto a
          // stale address.
          resetToDisconnected();
        } else {
          setState((s) => (s.mode === "metamask" ? { ...s, address: accounts[0] } : s));
        }
      };

      const onChainChanged = () => {
        // Chain config is validated on the next contract call; a full
        // reload keeps viem's internal chain cache from getting stale.
        window.location.reload();
      };

      provider.on("accountsChanged", onAccountsChanged);
      provider.on("chainChanged", onChainChanged);
      activeProviderRef.current = provider;

      return () => {
        provider.removeListener?.("accountsChanged", onAccountsChanged);
        provider.removeListener?.("chainChanged", onChainChanged);
      };
    },
    [resetToDisconnected]
  );

  const connectMetaMask = useCallback(async () => {
    setState((s) => ({ ...s, connecting: true, error: null }));
    try {
      const provider = await findMetaMaskProvider();
      if (!provider) {
        throw new MetaMaskNotFoundError();
      }

      const accounts: string[] = await provider.request({
        method: "eth_requestAccounts",
      });
      const address = accounts[0];
      if (!address) throw new Error("No account was selected.");

      const client = await createBrowserWalletClient(address as `0x${string}`);
      attachMetaMaskListeners(provider);
      localStorage.removeItem(EXPLICIT_DISCONNECT_FLAG);

      setState({ mode: "metamask", address, client, connecting: false, error: null });
    } catch (err: any) {
      setState((s) => ({
        ...s,
        connecting: false,
        error: err?.message ?? "Wallet connection failed.",
      }));
    }
  }, [attachMetaMaskListeners]);

  const connectBurner = useCallback(() => {
    setState((s) => ({ ...s, connecting: true, error: null }));
    try {
      let key = localStorage.getItem(BURNER_KEY_STORAGE) as `0x${string}` | null;
      if (!key) {
        key = generateBurnerPrivateKey();
        localStorage.setItem(BURNER_KEY_STORAGE, key);
      }
      const client = createBurnerClient(key);
      const address = addressFromPrivateKey(key);
      localStorage.removeItem(EXPLICIT_DISCONNECT_FLAG);
      setState({ mode: "burner", address, client, connecting: false, error: null });
    } catch (err: any) {
      setState((s) => ({
        ...s,
        connecting: false,
        error: err?.message ?? "Failed to create burner account.",
      }));
    }
  }, []);

  const disconnect = useCallback(async () => {
    const provider = activeProviderRef.current;
    activeProviderRef.current = null;

    // Best-effort real revocation, so MetaMask actually forgets this site
    // and the next "Connect" shows the account picker again instead of
    // silently re-approving. Not every wallet/version supports this RPC
    // method yet, so failures here are expected and ignored.
    if (provider) {
      try {
        await provider.request({
          method: "wallet_revokePermissions",
          params: [{ eth_accounts: {} }],
        });
      } catch {
        // Unsupported by this wallet version - the app-level disconnect
        // below still takes effect either way.
      }
    }

    localStorage.setItem(EXPLICIT_DISCONNECT_FLAG, "1");
    resetToDisconnected();
  }, [resetToDisconnected]);

  // Silently restore a previous MetaMask session on load (no popup),
  // unless the player explicitly disconnected last time.
  useEffect(() => {
    let cancelled = false;

    async function tryRestore() {
      if (!enabled) return;
      if (localStorage.getItem(EXPLICIT_DISCONNECT_FLAG)) return;

      const burnerKey = localStorage.getItem(BURNER_KEY_STORAGE) as
        | `0x${string}`
        | null;
      if (burnerKey) {
        connectBurner();
        return;
      }

      const provider = await findMetaMaskProvider();
      if (!provider || cancelled) return;

      try {
        // eth_accounts (unlike eth_requestAccounts) never prompts - it
        // just reports whatever this site is already authorized to see.
        const accounts: string[] = await provider.request({ method: "eth_accounts" });
        if (accounts.length === 0 || cancelled) return;

        const client = await createBrowserWalletClient(accounts[0] as `0x${string}`);
        if (cancelled) return;
        attachMetaMaskListeners(provider);
        setState({
          mode: "metamask",
          address: accounts[0],
          client,
          connecting: false,
          error: null,
        });
      } catch {
        // Silent restore is best-effort; a failure here just leaves the
        // player disconnected, which they can fix with a manual click.
      }
    }

    tryRestore();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { ...state, connectMetaMask, connectBurner, disconnect };
}
