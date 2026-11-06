/**
 * EIP-6963 ("Multi Injected Provider Discovery").
 *
 * When more than one wallet extension is installed (e.g. MetaMask AND
 * OKX Wallet), the single global `window.ethereum` object is ambiguous -
 * whichever extension last claimed it wins, and that can change between
 * page loads or after the user interacts with either extension directly.
 * EIP-6963 fixes this by having every wallet announce itself as a
 * distinct, addressable object instead of fighting over one global.
 *
 * We need this because GenLayer's `client.connect()` only knows how to
 * drive MetaMask (it calls MetaMask's Snaps API internally). If OKX has
 * claimed `window.ethereum`, `connect()` fails with confusing errors like
 * "Method not found: wallet_getSnaps". Discovering MetaMask explicitly
 * lets us target it correctly even when other wallets are also installed.
 */

export interface EIP6963ProviderInfo {
  uuid: string;
  name: string;
  icon: string;
  rdns: string;
}

export interface EIP6963ProviderDetail {
  info: EIP6963ProviderInfo;
  provider: any;
}

const METAMASK_RDNS = "io.metamask";

/**
 * Actively asks every installed wallet to announce itself and collects
 * the responses for a short window. Safe to call multiple times.
 */
export function discoverProviders(timeoutMs = 300): Promise<EIP6963ProviderDetail[]> {
  return new Promise((resolve) => {
    const found = new Map<string, EIP6963ProviderDetail>();

    function onAnnounce(event: Event) {
      const detail = (event as CustomEvent<EIP6963ProviderDetail>).detail;
      if (detail?.info?.uuid) {
        found.set(detail.info.uuid, detail);
      }
    }

    window.addEventListener("eip6963:announceProvider", onAnnounce as EventListener);
    window.dispatchEvent(new Event("eip6963:requestProvider"));

    setTimeout(() => {
      window.removeEventListener("eip6963:announceProvider", onAnnounce as EventListener);
      resolve(Array.from(found.values()));
    }, timeoutMs);
  });
}

/**
 * Finds the MetaMask provider specifically, even if other wallets are
 * also installed. Falls back to `window.ethereum` (or the first entry
 * of its legacy `.providers` array) for older MetaMask builds that
 * predate EIP-6963, but only if that fallback actually flags
 * `isMetaMask`.
 */
export async function findMetaMaskProvider(): Promise<any | null> {
  const detected = await discoverProviders();
  const viaAnnounce = detected.find((d) => d.info.rdns === METAMASK_RDNS);
  if (viaAnnounce) return viaAnnounce.provider;

  const eth = (window as any).ethereum;
  if (!eth) return null;

  if (Array.isArray(eth.providers)) {
    const legacyMatch = eth.providers.find((p: any) => p?.isMetaMask);
    if (legacyMatch) return legacyMatch;
  }

  if (eth.isMetaMask) return eth;

  return null;
}

export async function hasAnyInjectedProvider(): Promise<boolean> {
  const detected = await discoverProviders();
  return detected.length > 0 || !!(window as any).ethereum;
}
