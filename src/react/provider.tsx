import { createContext, useContext, useMemo, type ReactNode } from "react";
import { AetraConnectProvider, useAetraConnect } from "@aetra/connect-react";
import { WalletClient } from "../walletClient.js";
import { connectAccount } from "../accounts.js";
import type { PublicClient } from "../publicClient.js";
import type { AetraKitConfig } from "./config.js";

export interface AetraKitContextValue {
  config: AetraKitConfig;
  publicClient: PublicClient;
  /** A connect-backed wallet client — always constructed; actions throw until connected. */
  walletClient: WalletClient;
}

export const AetraKitContext = createContext<AetraKitContextValue | null>(null);

export function useAetraKit(): AetraKitContextValue {
  const ctx = useContext(AetraKitContext);
  if (!ctx) throw new Error("Aetra Kit hooks must be used inside <AetraKitProvider>");
  return ctx;
}

/**
 * `AetraKitProvider` — the wagmi `WagmiProvider` analogue. Composes the connect
 * provider (modal, session restore) with the kit's clients, so every hook below
 * it can read the chain and drive the connected wallet.
 *
 * ```tsx
 * const config = createConfig({ manifestUrl: "https://myapp.com/aetra-connect-manifest.json", gatewayUrl: "https://gw.aetra.network" });
 * <AetraKitProvider config={config}>{children}</AetraKitProvider>
 * ```
 */
export function AetraKitProvider({ config, children }: { config: AetraKitConfig; children: ReactNode }) {
  return (
    <AetraConnectProvider {...config.connectProps}>
      <KitInner config={config}>{children}</KitInner>
    </AetraConnectProvider>
  );
}

function KitInner({ config, children }: { config: AetraKitConfig; children: ReactNode }) {
  const { connect } = useAetraConnect();

  const value = useMemo<AetraKitContextValue>(
    () => ({
      config,
      publicClient: config.publicClient,
      walletClient: new WalletClient({ account: connectAccount(connect), client: config.publicClient }),
    }),
    [config, connect],
  );

  return <AetraKitContext.Provider value={value}>{children}</AetraKitContext.Provider>;
}
