import { createClient, createAccount, generatePrivateKey } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import type { GenLayerClient } from "genlayer-js/types";
import { findMetaMaskProvider } from "./eip6963";

declare global {
  interface Window {
    ethereum?: any;
  }
}

export type AppGenLayerClient = GenLayerClient<any>;

/**
 * A read-only client with no signer attached. Safe for every `readContract`
 * call, whether or not a wallet is connected.
 */
export function createReadOnlyClient(): AppGenLayerClient {
  return createClient({ chain: studionet }) as AppGenLayerClient;
}

export class MetaMaskNotFoundError extends Error {
  constructor() {
    super(
      "MetaMask was not found. Install the MetaMask extension, or use the " +
        "in-browser burner account to try the game without a wallet.",
    );
    this.name = "MetaMaskNotFoundError";
  }
}

/**
 * A client backed by MetaMask specifically.
 *
 * `client.connect()` is deliberately never called. It reaches into the global
 * `window.ethereum` (ignoring the provider handed to `createClient`) and only
 * asks the wallet to add the chain and install the GenLayer Snap. Neither is
 * needed here: Studio chains skip the SDK's chain-match check, and every RPC
 * used for signing is routed through the explicit provider below. Skipping it
 * keeps connecting reliable when several wallet extensions are installed.
 */
export async function createBrowserWalletClient(address: `0x${string}`): Promise<AppGenLayerClient> {
  const metamask = await findMetaMaskProvider();
  if (!metamask) throw new MetaMaskNotFoundError();
  return createClient({ chain: studionet, account: address, provider: metamask }) as AppGenLayerClient;
}

/**
 * A client backed by a locally generated key pair. The private key never
 * leaves this device; fund the address from the Studio faucet before playing.
 */
export function createBurnerClient(privateKey: `0x${string}`): AppGenLayerClient {
  const account = createAccount(privateKey);
  return createClient({ chain: studionet, account }) as AppGenLayerClient;
}

export function generateBurnerPrivateKey(): `0x${string}` {
  return generatePrivateKey();
}

export function addressFromPrivateKey(privateKey: `0x${string}`): `0x${string}` {
  return createAccount(privateKey).address;
}
