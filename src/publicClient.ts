import { GatewayClient, Address, Amount, Field, type FieldValue, type TxDetail, type FeeEstimate, type Status } from "@aetra-network/sdk";

/**
 * `PublicClient` — read-only chain access (the viem `publicClient` analogue).
 * No keys, no signing: balances, accounts, status, transactions, contract
 * `@get` reads, fee estimates. Construct one per network and share it.
 *
 * Errors: every method throws a plain `Error` with the gateway's message —
 * callers use try/catch (or the React hooks, which surface `error` state).
 */
export interface PublicClientConfig {
  /** Gateway base URL, e.g. `http://127.0.0.1:8080`. */
  url?: string;
  fetch?: typeof fetch;
}

export interface AccountView {
  exists: boolean;
  accountNumber: bigint;
  sequence: bigint;
  /** True once the account's public key is recorded on-chain (first outgoing tx). */
  pubKeySet: boolean;
}

export interface ChainStatus {
  chainId: string;
  height: number;
  catchingUp: boolean;
}

export interface ContractReadResult {
  success: boolean;
  /** Decimal for numerics, hex for bytes/hash, `AE…` for address, `"true"/"false"` for bool. */
  result?: string;
  resultType?: string;
  exitCode: number;
  gasUsed: bigint;
  error?: string;
}

export class PublicClient {
  readonly gateway: GatewayClient;

  constructor(config: PublicClientConfig = {}) {
    this.gateway = new GatewayClient({
      ...(config.url ? { baseUrl: config.url } : {}),
      ...(config.fetch ? { fetch: config.fetch } : {}),
    });
  }

  /** Native AET balance in naet (base units). Accepts any address form. */
  async getBalance(address: string): Promise<bigint> {
    const res = await this.gateway.getAddress(normalize(address));
    if (!res.ok) throw new Error(`balance lookup failed: ${res.error}`);
    return BigInt(res.data.balance ?? "0");
  }

  /** Native balance as a human `"1.5"` AET string. */
  async getBalanceAet(address: string): Promise<string> {
    return Amount.fromNaet(await this.getBalance(address)).toAet();
  }

  /** Signing material + existence for an account. */
  async getAccount(address: string): Promise<AccountView> {
    const res = await this.gateway.getAccount(normalize(address));
    if (!res.ok) throw new Error(`account lookup failed: ${res.error}`);
    return {
      exists: res.data.exists,
      accountNumber: BigInt(res.data.account_number),
      sequence: BigInt(res.data.sequence),
      pubKeySet: Boolean(res.data.pub_key_type),
    };
  }

  /** Chain tip status. */
  async getStatus(): Promise<ChainStatus> {
    const res = await this.gateway.getStatus();
    if (!res.ok) throw new Error(`status lookup failed: ${res.error}`);
    return { chainId: res.data.chain_id, height: res.data.latest_height, catchingUp: res.data.catching_up };
  }

  /** A delivered transaction by hash, or null while it hasn't landed yet. */
  async getTransaction(hash: string): Promise<TxDetail | null> {
    const res = await this.gateway.getTx(hash);
    if (!res.ok) {
      if (res.status === 404) return null;
      throw new Error(`tx lookup failed: ${res.error}`);
    }
    return res.data;
  }

  /**
   * Polls until `hash` is delivered in a block (or the timeout elapses). The
   * broadcast endpoint returns CheckTx acceptance only — call this to confirm
   * execution, then check `.success` on the result.
   */
  async waitForTransaction(hash: string, opts: { timeoutMs?: number; intervalMs?: number } = {}): Promise<TxDetail> {
    const timeoutMs = opts.timeoutMs ?? 30_000;
    const intervalMs = opts.intervalMs ?? 1_000;
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const tx = await this.getTransaction(hash);
      if (tx) return tx;
      if (Date.now() >= deadline) throw new Error(`tx ${hash} not delivered within ${timeoutMs}ms`);
      await sleep(intervalMs);
    }
  }

  /** Calls a deployed contract's read-only `@get` method by its exact source name. */
  async readContract(params: { address: string; method: string; args?: FieldValue[] }): Promise<ContractReadResult> {
    const res = await this.gateway.callContractGet(
      normalize(params.address),
      params.method,
      (params.args ?? []).map((f) => ({ type: f.type, value: Field.toArgString(f) })),
    );
    if (!res.ok) throw new Error(`contract read failed: ${res.error}`);
    return {
      success: res.data.success,
      result: res.data.result,
      resultType: res.data.result_type,
      exitCode: res.data.exit_code,
      gasUsed: BigInt(res.data.gas_used),
      error: res.data.error,
    };
  }

  /** The fee range the chain will accept for `gasLimit`. */
  async estimateFee(gasLimit: number): Promise<FeeEstimate> {
    const res = await this.gateway.estimateFee(gasLimit);
    if (!res.ok) throw new Error(`fee estimate failed: ${res.error}`);
    return res.data;
  }

  /** Raw gateway status payload (chain_id etc), for advanced callers. */
  async getStatusRaw(): Promise<Status> {
    const res = await this.gateway.getStatus();
    if (!res.ok) throw new Error(`status lookup failed: ${res.error}`);
    return res.data;
  }
}

/** Convenience factory mirroring viem's `createPublicClient`. */
export function createPublicClient(config: PublicClientConfig = {}): PublicClient {
  return new PublicClient(config);
}

/** Gateway accepts the user-friendly form everywhere; normalise any input to it. */
function normalize(address: string): string {
  return Address.fromString(address).toUserFriendly();
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
