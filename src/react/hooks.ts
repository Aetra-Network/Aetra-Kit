import { useCallback, useEffect, useRef, useState } from "react";
import {
  useAetraWallet,
  useAetraConnect,
  useAetraConnectModal,
  useIsConnectionRestored,
} from "@aetra/connect-react";
import type { ConnectedAccount, ConnectTxMessage, SignMessageResult } from "@aetra/connect";
import type { FieldValue } from "@aetra/sdk";
import type { PublicClient } from "../publicClient.js";
import type { WalletClient, TxResult, DeployResult } from "../walletClient.js";
import { useAetraKit } from "./provider.js";

/**
 * wagmi-style hooks over the kit clients. Read hooks expose
 * `{ data, isLoading, error, refetch }`; action hooks expose the action plus
 * `{ data, isPending, error, reset }`. All must live under `<AetraKitProvider>`.
 */

// --- Clients -----------------------------------------------------------------

/** The shared read-only chain client. */
export function usePublicClient(): PublicClient {
  return useAetraKit().publicClient;
}

/** The connect-backed wallet client, or null while disconnected. */
export function useWalletClient(): WalletClient | null {
  const { walletClient } = useAetraKit();
  const account = useAetraWallet();
  return account ? walletClient : null;
}

// --- Account / connection ------------------------------------------------------

export interface UseAccountResult {
  /** User-friendly `AE…` address, or undefined while disconnected. */
  address?: string;
  /** Raw bech32 `ae1…` address. */
  addressRaw?: string;
  /** The full connected account (pubkey, chainId, proof), or null. */
  account: ConnectedAccount | null;
  isConnected: boolean;
  /** True once restore-from-storage settled (guards hydration flicker). */
  isRestored: boolean;
}

/** The connected account — the wagmi `useAccount` analogue. */
export function useAccount(): UseAccountResult {
  const account = useAetraWallet();
  const isRestored = useIsConnectionRestored();
  return {
    ...(account ? { address: account.address, addressRaw: account.addressRaw } : {}),
    account,
    isConnected: account !== null,
    isRestored,
  };
}

/**
 * Connecting — opens the built-in pairing modal (QR + deep link). Wire it to
 * ANY custom button: `const { connect } = useConnect(); <MyButton onClick={connect} />`.
 */
export function useConnect(): { connect: () => Promise<void>; close: () => void; isPending: boolean } {
  const { state, open, close } = useAetraConnectModal();
  return { connect: open, close, isPending: state.open && state.status === "connecting" };
}

/** Disconnecting — ends the session and notifies the wallet. */
export function useDisconnect(): { disconnect: () => Promise<void> } {
  const { disconnect } = useAetraConnect();
  return { disconnect };
}

// --- Reads ---------------------------------------------------------------------

export interface UseBalanceResult {
  /** naet + formatted AET, or undefined until loaded. */
  data?: { naet: bigint; formatted: string; symbol: "AET" };
  isLoading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
}

/**
 * Native AET balance — the wagmi `useBalance` analogue. Defaults to the
 * connected account; pass `watch: true` (10s) or a number of ms to poll.
 */
export function useBalance(params: { address?: string; watch?: boolean | number } = {}): UseBalanceResult {
  const publicClient = usePublicClient();
  const { address: connectedAddress } = useAccount();
  const address = params.address ?? connectedAddress;
  const watchMs = params.watch === true ? 10_000 : params.watch || 0;

  const [data, setData] = useState<UseBalanceResult["data"]>();
  const [isLoading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const refetch = useCallback(async () => {
    if (!address) {
      setData(undefined);
      return;
    }
    setLoading(true);
    try {
      const naet = await publicClient.getBalance(address);
      const formatted = await publicClient.getBalanceAet(address);
      setData({ naet, formatted, symbol: "AET" });
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setLoading(false);
    }
  }, [publicClient, address]);

  useEffect(() => {
    void refetch();
    if (!watchMs) return;
    const timer = setInterval(() => void refetch(), watchMs);
    return () => clearInterval(timer);
  }, [refetch, watchMs]);

  return { data, isLoading, error, refetch };
}

export interface UseReadContractResult {
  /** The `@get` result string (decimal / hex / `AE…` / `"true"`), or undefined. */
  data?: string;
  resultType?: string;
  isLoading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
}

/** A contract `@get` read — the wagmi `useReadContract` analogue. */
export function useReadContract(params: {
  address?: string;
  method: string;
  args?: FieldValue[];
  /** Skip fetching until true (e.g. while `address` is unknown). */
  enabled?: boolean;
  watch?: boolean | number;
}): UseReadContractResult {
  const publicClient = usePublicClient();
  const enabled = (params.enabled ?? true) && Boolean(params.address);
  const watchMs = params.watch === true ? 10_000 : params.watch || 0;
  // Serialise args so effect deps don't churn on array identity.
  const argsKey = JSON.stringify(params.args ?? []);
  const argsRef = useRef(params.args);
  argsRef.current = params.args;

  const [data, setData] = useState<string>();
  const [resultType, setResultType] = useState<string>();
  const [isLoading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const refetch = useCallback(async () => {
    if (!enabled || !params.address) return;
    setLoading(true);
    try {
      const res = await publicClient.readContract({
        address: params.address,
        method: params.method,
        ...(argsRef.current ? { args: argsRef.current } : {}),
      });
      if (!res.success) throw new Error(res.error ?? `get failed with exit code ${res.exitCode}`);
      setData(res.result);
      setResultType(res.resultType);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [publicClient, enabled, params.address, params.method, argsKey]);

  useEffect(() => {
    void refetch();
    if (!watchMs) return;
    const timer = setInterval(() => void refetch(), watchMs);
    return () => clearInterval(timer);
  }, [refetch, watchMs]);

  const result: UseReadContractResult = { isLoading, error, refetch };
  if (data !== undefined) result.data = data;
  if (resultType !== undefined) result.resultType = resultType;
  return result;
}

// --- Actions ---------------------------------------------------------------------

interface ActionState<T> {
  data?: T;
  error: Error | null;
  isPending: boolean;
}

function useAction<TArgs extends unknown[], TData>(fn: (client: WalletClient, ...args: TArgs) => Promise<TData>) {
  const client = useWalletClient();
  const [state, setState] = useState<ActionState<TData>>({ error: null, isPending: false });

  const run = useCallback(
    async (...args: TArgs): Promise<TData> => {
      if (!client) throw new Error("no connected wallet — connect first");
      setState({ error: null, isPending: true });
      try {
        const data = await fn(client, ...args);
        setState({ data, error: null, isPending: false });
        return data;
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        setState({ error, isPending: false });
        throw error;
      }
    },
    [client, fn],
  );

  const reset = useCallback(() => setState({ error: null, isPending: false }), []);
  return { run, reset, ...state };
}

/** Sending transactions — the wagmi `useSendTransaction` analogue (intents or plain AET). */
export function useSendTransaction() {
  const { run, ...rest } = useAction(
    (client: WalletClient, intents: ConnectTxMessage[], opts?: { memo?: string }): Promise<TxResult> =>
      client.send(intents, opts ?? {}),
  );
  const { run: runAet, ...aetRest } = useAction(
    (client: WalletClient, params: { to: string; amount: string | bigint; comment?: string }): Promise<TxResult> =>
      client.sendAet(params),
  );
  return {
    sendTransaction: run,
    sendAet: runAet,
    data: rest.data ?? aetRest.data,
    error: rest.error ?? aetRest.error,
    isPending: rest.isPending || aetRest.isPending,
    reset: () => {
      rest.reset();
      aetRest.reset();
    },
  };
}

/** Off-chain message signing — the wagmi `useSignMessage` analogue. */
export function useSignMessage() {
  const { run, ...rest } = useAction(
    (client: WalletClient, message: string): Promise<SignMessageResult> => client.signMessage(message),
  );
  return { signMessage: run, ...rest };
}

/** Contract deployment — the wagmi `useDeployContract` analogue (predicted address in `data.contract`). */
export function useDeployContract() {
  const { run, ...rest } = useAction(
    (
      client: WalletClient,
      params: Parameters<WalletClient["deployContract"]>[0],
    ): Promise<DeployResult> => client.deployContract(params),
  );
  return { deployContract: run, ...rest };
}

/** Contract `@external` execution — the write counterpart of `useReadContract`. */
export function useExecuteContract() {
  const { run, ...rest } = useAction(
    (client: WalletClient, params: Parameters<WalletClient["executeContract"]>[0]): Promise<TxResult> =>
      client.executeContract(params),
  );
  return { executeContract: run, ...rest };
}
