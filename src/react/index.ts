/**
 * @aetra/kit/react — wagmi-style hooks for Aetra.
 *
 * ```tsx
 * const config = createConfig({
 *   manifestUrl: "https://myapp.com/aetra-connect-manifest.json",
 *   gatewayUrl: "https://gw.aetra.network",
 * });
 *
 * <AetraKitProvider config={config}>
 *   <App />   // useAccount(), useBalance(), useSendTransaction(), …
 * </AetraKitProvider>
 * ```
 *
 * The connect button/modal come from `@aetra/connect-react` (re-exported here) —
 * or wire `useConnect().connect` to any custom button.
 */
export { createConfig } from "./config.js";
export type { CreateConfigOptions, AetraKitConfig } from "./config.js";
export { AetraKitProvider, useAetraKit, AetraKitContext } from "./provider.js";
export type { AetraKitContextValue } from "./provider.js";
export {
  usePublicClient,
  useWalletClient,
  useAccount,
  useConnect,
  useDisconnect,
  useBalance,
  useReadContract,
  useSendTransaction,
  useSignMessage,
  useDeployContract,
  useExecuteContract,
} from "./hooks.js";
export type { UseAccountResult, UseBalanceResult, UseReadContractResult } from "./hooks.js";

// UI building blocks, re-exported so a kit app needs one import root.
export { AetraConnectButton, ConnectModal, Qr } from "@aetra/connect-react";
