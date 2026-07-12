import { Address, Amount, Bytes, Wallet, TxBuilder, ContractCode, ContractAddress, type FieldValue, type TxDetail } from "@aetra/sdk";
import { signMessage as signOffchain, type ConnectTxMessage, type SignMessageResult } from "@aetra/connect";
import { AetraConnect } from "@aetra/connect/dapp";
import { PublicClient, createPublicClient, type PublicClientConfig } from "./publicClient.js";
import { localAccount, connectAccount, type AetraAccount, type LocalAccountSource } from "./accounts.js";
import { compileIntents, payloadFrom, fieldsToSpecs } from "./intents.js";

/**
 * `WalletClient` — write access (the viem `walletClient` / wagmi actions
 * analogue). One action vocabulary — the protocol's transaction intents —
 * executed through either account kind:
 *
 *   - **local**: builds, signs (SIGN_MODE_DIRECT), and broadcasts here, via the
 *     SDK `TxBuilder` against the gateway. For servers, bots, scripts.
 *   - **connect**: forwards the intent list over Aetra Connect; the user's
 *     wallet confirms, signs, and broadcasts. For dApps.
 *
 * Same intents, same results — app code doesn't branch on where the key lives.
 */

export interface TxResult {
  hash: string;
  accepted: boolean;
}

export interface DeployResult extends TxResult {
  /** The deterministic contract address, predicted client-side (`AE…`). */
  contract: string;
  /** The domain-separated code hash used as the deploy's codeId. */
  codeId: string;
}

export interface WalletClientConfig {
  /** The signer: a kit account, a raw SDK `Wallet`, or a connected `AetraConnect`. */
  account: AetraAccount | Wallet | AetraConnect | LocalAccountSource;
  /** Read access — a `PublicClient`, or gateway config to build one. */
  client?: PublicClient;
  url?: string;
  fetch?: typeof fetch;
}

/** AET amounts accepted by convenience actions: display string ("1.5" AET), naet bigint, or an `Amount`. */
export type AetAmount = string | bigint | Amount;

export class WalletClient {
  readonly account: AetraAccount;
  readonly public: PublicClient;

  /** Serializes local sends so two concurrent calls never read and sign the same account sequence. */
  private sendQueue: Promise<void> = Promise.resolve();

  constructor(config: WalletClientConfig) {
    this.account = resolveAccount(config.account);
    this.public = config.client ?? createPublicClient({ ...(config.url ? { url: config.url } : {}), ...(config.fetch ? { fetch: config.fetch } : {}) });
  }

  /** The signer's user-friendly `AE…` address. */
  get address(): string {
    return this.account.address;
  }

  /** The signer's raw bech32 `ae1…` address. */
  get addressRaw(): string {
    return this.account.addressRaw;
  }

  /** This account's AET balance in naet. */
  getBalance(): Promise<bigint> {
    return this.public.getBalance(this.address);
  }

  /** This account's balance as a human `"1.5"` AET string. */
  getBalanceAet(): Promise<string> {
    return this.public.getBalanceAet(this.address);
  }

  // --- Actions ---------------------------------------------------------

  /** Executes a list of transaction intents (the protocol vocabulary) as one signed tx. */
  async send(intents: ConnectTxMessage[], opts: { memo?: string; gasLimit?: bigint } = {}): Promise<TxResult> {
    if (intents.length === 0) throw new Error("at least one transaction intent is required");
    if (this.account.type === "connect") {
      const res = await this.account.connect.sendTransaction({
        messages: intents,
        ...(opts.memo !== undefined ? { memo: opts.memo } : {}),
      });
      return { hash: res.hash, accepted: res.accepted };
    }
    return this.sendLocal(intents, opts);
  }

  /** Sends AET. `amount` as `"1.5"` (AET string), naet `bigint`, or an `Amount`. */
  sendAet(params: { to: string; amount: AetAmount; comment?: string }): Promise<TxResult> {
    const to = Address.fromString(params.to).toUserFriendly();
    return this.send(
      [{ kind: "send", to, amountNaet: toNaetString(params.amount), ...(params.comment ? { comment: params.comment } : {}) }],
      params.comment ? { memo: params.comment } : {},
    );
  }

  /** Activates the account's native identity (records its public key) — unlocks staking/deploys. */
  activate(): Promise<TxResult> {
    return this.send([{ kind: "activate" }]);
  }

  /** Calls a deployed contract's `@external` entrypoint. `fields` are SDK `Field` values. */
  executeContract(params: {
    contract: string;
    opcode?: number;
    fields?: FieldValue[];
    funds?: AetAmount;
    gasLimit?: number;
  }): Promise<TxResult> {
    return this.send([
      {
        kind: "contract.execute",
        contract: Address.fromString(params.contract).toUserFriendly(),
        ...(params.opcode !== undefined ? { opcode: params.opcode } : {}),
        ...(params.fields ? { fields: fieldsToSpecs(params.fields) } : {}),
        ...(params.funds !== undefined ? { fundsNaet: toNaetString(params.funds) } : {}),
        ...(params.gasLimit !== undefined ? { gasLimit: params.gasLimit } : {}),
      },
    ]);
  }

  /**
   * Stores bytecode and deploys a contract instance in one tx. The address is
   * deterministic and predicted client-side — returned even before delivery
   * (confirm with `waitForTransaction`, then `.success`).
   */
  async deployContract(params: {
    /** Compiled AVM module (`module.bin`) — bytes or base64. */
    bytecode: Uint8Array | string;
    salt: string;
    initFields?: FieldValue[];
    initialBalance?: AetAmount;
    admin?: string;
    gasLimit?: number;
  }): Promise<DeployResult> {
    const bytecode = typeof params.bytecode === "string" ? Bytes.fromBase64(params.bytecode) : params.bytecode;
    const codeId = ContractCode.hash(bytecode);
    const initPayload = payloadFrom(params.initFields ? fieldsToSpecs(params.initFields) : undefined);
    const predicted = ContractAddress.derive({
      deployer: Address.fromString(this.address),
      codeHash: codeId,
      initData: initPayload.encode(),
      salt: params.salt,
    });

    const result = await this.send([
      {
        kind: "contract.deploy",
        bytecodeBase64: Bytes.toBase64(bytecode),
        salt: params.salt,
        ...(params.initFields ? { initFields: fieldsToSpecs(params.initFields) } : {}),
        ...(params.initialBalance !== undefined ? { initialBalanceNaet: toNaetString(params.initialBalance) } : {}),
        ...(params.admin ? { admin: Address.fromString(params.admin).toUserFriendly() } : {}),
        ...(params.gasLimit !== undefined ? { gasLimit: params.gasLimit } : {}),
      },
    ]);
    return { ...result, contract: predicted.toUserFriendly(), codeId };
  }

  /** Signs an off-chain message (domain-separated from transactions). */
  async signMessage(message: string): Promise<SignMessageResult> {
    if (this.account.type === "connect") {
      return this.account.connect.signMessage(message);
    }
    return signOffchain(this.account.wallet, message);
  }

  /** Ends a connect session (no-op for a local account). */
  async disconnect(): Promise<void> {
    if (this.account.type === "connect") await this.account.connect.disconnect();
  }

  /** Polls until `hash` is delivered; returns the full tx detail. */
  waitForTransaction(hash: string, opts?: { timeoutMs?: number; intervalMs?: number }): Promise<TxDetail> {
    return this.public.waitForTransaction(hash, opts);
  }

  // --- Local pipeline ----------------------------------------------------

  /** Queues onto `sendQueue` so a second concurrent call always waits for the first to finish signing and broadcasting. */
  private sendLocal(intents: ConnectTxMessage[], opts: { memo?: string; gasLimit?: bigint }): Promise<TxResult> {
    const result = this.sendQueue.then(() => this.sendLocalNow(intents, opts));
    this.sendQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private async sendLocalNow(intents: ConnectTxMessage[], opts: { memo?: string; gasLimit?: bigint }): Promise<TxResult> {
    const wallet = (this.account as { wallet: Wallet }).wallet;
    const address = wallet.address.toUserFriendly();

    const [account, status] = await Promise.all([this.public.getAccount(address), this.public.getStatus()]);
    const compiled = compileIntents(intents, wallet, BigInt(status.height));
    const gasLimit = opts.gasLimit ?? compiled.gasLimit;
    const fee = await this.public.estimateFee(Number(gasLimit));

    const builder = new TxBuilder()
      .addMessages(...compiled.messages)
      .setMemo(opts.memo ?? "")
      // The gateway's `required_fee` is a lower-bound estimate the ante may
      // exceed under the full fee formula, and it's denom-suffixed. Add a
      // margin (capped at max_fee) and pass the bare base-unit amount.
      .setFee(feeWithMargin(fee), BigInt(fee.gas_limit));
    if (compiled.feePayer) builder.setFeePayer(compiled.feePayer);

    const signed = builder.signWith(wallet, {
      accountNumber: account.accountNumber,
      sequence: account.sequence,
      chainId: status.chainId,
    });

    const res = await this.public.gateway.broadcastTx(signed.base64);
    if (!res.ok) throw new Error(`broadcast failed: ${res.error}`);
    return { hash: res.data.hash, accepted: res.data.accepted };
  }
}

/** Convenience factory mirroring viem's `createWalletClient`. */
export function createWalletClient(config: WalletClientConfig): WalletClient {
  return new WalletClient(config);
}

function resolveAccount(source: WalletClientConfig["account"]): AetraAccount {
  if (source instanceof Wallet) return localAccount(source);
  if (source instanceof AetraConnect) return connectAccount(source);
  if ("type" in source && (source.type === "local" || source.type === "connect")) return source;
  if ("mnemonic" in source || "privateKeyHex" in source) return localAccount(source);
  throw new Error("WalletClient: unrecognized account source");
}

/** Bare base-unit amount from a possibly denom-suffixed coin ("400000000naet" → 400000000n). */
function coinToNaet(coin: string): bigint {
  const m = coin.match(/^\d+/);
  return m ? BigInt(m[0]) : 0n;
}

/**
 * A fee that satisfies the ante: the gateway's `required_fee` plus a margin
 * (default 50%), capped at `max_fee` — mirrors the Dalen wallet's `feeWithMargin`.
 * The gateway estimate can sit just under the ante's full-formula minimum, so a
 * bare `required_fee` is often rejected.
 */
function feeWithMargin(fee: { required_fee: string; max_fee: string }, marginPercent = 50): string {
  const required = coinToNaet(fee.required_fee);
  const withMargin = required + (required * BigInt(marginPercent)) / 100n;
  const max = coinToNaet(fee.max_fee);
  const chosen = max > 0n && withMargin > max ? max : withMargin;
  return chosen.toString();
}

function toNaetString(amount: AetAmount): string {
  if (amount instanceof Amount) return amount.toNaetString();
  if (typeof amount === "bigint") return amount.toString();
  return Amount.fromAet(amount).toNaetString();
}
