import type { AetraConnectProviderProps } from "@aetra-network/connect-react";
import { PublicClient, createPublicClient } from "../publicClient.js";

/**
 * `createConfig` — the wagmi `createConfig` analogue. Bundles the connect
 * provider's props with a shared `PublicClient`, so one object configures the
 * whole React tree. Create it once at module scope and pass to
 * `<AetraKitProvider config={…}>`.
 */
export interface CreateConfigOptions extends Omit<AetraConnectProviderProps, "children"> {
  /** Chain gateway base URL (reads: balances, accounts, contract gets). */
  gatewayUrl?: string;
  /** `fetch` used by the public client (defaults to the global). */
  gatewayFetch?: typeof fetch;
}

export interface AetraKitConfig {
  /** Props forwarded to the underlying `AetraConnectProvider`. */
  connectProps: Omit<AetraConnectProviderProps, "children">;
  /** The shared read-only chain client. */
  publicClient: PublicClient;
}

export function createConfig(options: CreateConfigOptions): AetraKitConfig {
  const { gatewayUrl, gatewayFetch, ...connectProps } = options;
  return {
    connectProps,
    publicClient: createPublicClient({
      ...(gatewayUrl ? { url: gatewayUrl } : {}),
      ...(gatewayFetch ? { fetch: gatewayFetch } : {}),
    }),
  };
}
