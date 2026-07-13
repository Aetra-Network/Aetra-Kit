import {
  Address,
  Amount,
  Bytes,
  Wallet,
  ContractPayload,
  ContractCode,
  ContractAddress,
  Field,
  MsgSend,
  MsgActivateAccount,
  MsgDepositToStakingPool,
  MsgRequestPoolUnbond,
  MsgClaimPoolRewards,
  MsgStoreCode,
  MsgDeployContract,
  MsgExecuteExternal,
  type Message,
  type FieldValue,
} from "@aetra-network/sdk";
import type { ConnectTxMessage, ContractFieldSpec } from "@aetra-network/connect";

/**
 * The intent compiler — turns the protocol's `ConnectTxMessage` list (the SAME
 * shape a dApp sends over Aetra Connect) into signed-tx building blocks for the
 * local pipeline. One intent vocabulary, two executors: a connected wallet does
 * this mapping inside the wallet app; `@aetra-network/kit`'s local transport does it
 * here. Keep the two in sync when a kind is added.
 */

/** Per-kind outer-tx gas defaults (fee gas, not AVM gas). */
const GAS: Record<string, bigint> = {
  send: 200_000n,
  activate: 250_000n,
  "stake.deposit": 300_000n,
  "stake.unbond": 300_000n,
  "stake.claim": 250_000n,
  "contract.execute": 0n, // computed: avm gasLimit + 100k
  "contract.deploy": 0n, // computed: deployGasFor(bytecode length)
  raw: 200_000n,
};

/**
 * A `contract.deploy` carries a `MsgStoreCode` whose cost is dominated by
 * persisting the bytecode into the KV store — the SDK's default gas config
 * charges that at ~`WriteCostPerByte` (30) gas/byte on top of the deploy/tx
 * overhead. A flat default silently under-funds large contracts, so scale the
 * suggested gas with bytecode length. Callers can override per-intent via
 * `intent.gasLimit` (which, for `contract.deploy`, is the OUTER fee gas — not
 * AVM gas as it is for `contract.execute`). Validate the constant against the
 * live gas schedule once a testnet is up.
 */
const DEPLOY_BASE_GAS = 400_000n;
const DEPLOY_GAS_PER_BYTE = 30n;
function deployGasFor(bytecodeLen: number): bigint {
  return DEPLOY_BASE_GAS + DEPLOY_GAS_PER_BYTE * BigInt(bytecodeLen);
}

export interface CompiledIntents {
  messages: Message[];
  /** Suggested outer fee gas (sum of per-intent defaults). */
  gasLimit: bigint;
  /**
   * Reserved: an explicit fee payer distinct from the tx signer. `compileIntents`
   * never sets this today — `activate` deliberately relies on the sole AuthInfo
   * signer paying (an AE-form payer fails the ante's bech32 decode; see the
   * `activate` case). Kept on the type so `WalletClient` can honor it if a future
   * intent kind needs a separate payer, without a breaking change.
   */
  feePayer?: Address;
  /** Client-side-predicted contract addresses, in `contract.deploy` intent order. */
  predictedContracts: { address: Address; codeId: string }[];
}

/** Compiles `intents` for `signer` at chain `height`. Throws on an unknown kind. */
export function compileIntents(intents: ConnectTxMessage[], signer: Wallet, height: bigint): CompiledIntents {
  const messages: Message[] = [];
  const predictedContracts: { address: Address; codeId: string }[] = [];
  let gasLimit = 0n;

  for (const intent of intents) {
    switch (intent.kind) {
      case "send": {
        messages.push(
          new MsgSend({ from: signer.address, to: Address.fromString(intent.to).toUserFriendly(), amount: Amount.fromNaet(intent.amountNaet) }),
        );
        gasLimit += GAS.send!;
        break;
      }
      case "activate": {
        messages.push(new MsgActivateAccount({ identity: signer.nativeIdentity(), pubkeyHex: signer.pubkeyHex }));
        // No explicit fee payer: the tx is signed by the plain account (the sole
        // entry in AuthInfo), so it pays by default. Setting a payer here would
        // need the bech32 form — the AE user-facing form fails the ante's
        // bech32 decode ("Invalid fee payer address").
        gasLimit += GAS.activate!;
        break;
      }
      case "stake.deposit": {
        messages.push(
          new MsgDepositToStakingPool({ poolId: intent.poolId, wallet: signer.address, amount: Amount.fromNaet(intent.amountNaet) }),
        );
        gasLimit += GAS["stake.deposit"]!;
        break;
      }
      case "stake.unbond": {
        messages.push(
          new MsgRequestPoolUnbond({
            poolId: intent.poolId,
            owner: signer.address,
            requestId: intent.requestId,
            shares: BigInt(intent.shares),
          }),
        );
        gasLimit += GAS["stake.unbond"]!;
        break;
      }
      case "stake.claim": {
        messages.push(new MsgClaimPoolRewards({ poolId: intent.poolId, owner: signer.address }));
        gasLimit += GAS["stake.claim"]!;
        break;
      }
      case "contract.execute": {
        const avmGas = intent.gasLimit ?? 200_000;
        messages.push(
          new MsgExecuteExternal({
            sender: signer.address,
            contract: intent.contract,
            opcode: intent.opcode,
            payload: payloadFrom(intent.fields),
            funds: intent.fundsNaet !== undefined ? Amount.fromNaet(intent.fundsNaet) : undefined,
            gasLimit: avmGas,
            height,
          }),
        );
        gasLimit += BigInt(avmGas) + 100_000n;
        break;
      }
      case "contract.deploy": {
        const bytecode = Bytes.fromBase64(intent.bytecodeBase64);
        const codeId = ContractCode.hash(bytecode);
        const initPayload = payloadFrom(intent.initFields);
        const address = ContractAddress.derive({
          deployer: signer.address,
          codeHash: codeId,
          initData: initPayload.encode(),
          salt: intent.salt,
        });
        messages.push(
          new MsgStoreCode({ authority: signer.address, bytecode }),
          new MsgDeployContract({
            creator: signer.address,
            codeId,
            salt: intent.salt,
            initPayload,
            initialBalance: intent.initialBalanceNaet !== undefined ? Amount.fromNaet(intent.initialBalanceNaet) : undefined,
            admin: intent.admin !== undefined ? Address.fromString(intent.admin).toUserFriendly() : undefined,
            height,
          }),
        );
        predictedContracts.push({ address, codeId });
        gasLimit += intent.gasLimit !== undefined ? BigInt(intent.gasLimit) : deployGasFor(bytecode.length);
        break;
      }
      case "raw": {
        const value = Bytes.fromBase64(intent.valueBase64);
        messages.push({ typeUrl: intent.typeUrl, encode: () => value });
        gasLimit += GAS.raw!;
        break;
      }
      default: {
        const kind = (intent as { kind: string }).kind;
        throw new Error(`unsupported transaction intent: ${kind}`);
      }
    }
  }

  return { messages, gasLimit, predictedContracts };
}

/** `[{name,type,value}]` specs → a `ContractPayload` (empty when absent). */
export function payloadFrom(fields?: ContractFieldSpec[]): ContractPayload {
  if (!fields || fields.length === 0) return ContractPayload.empty();
  return ContractPayload.fromArray(fields.map((f) => Field.raw(f.name, f.type, f.value as string | number | boolean)));
}

/** `FieldValue[]` (SDK `Field` output) → the protocol's plain field specs. */
export function fieldsToSpecs(fields: FieldValue[]): ContractFieldSpec[] {
  return fields.map((f) => ({ name: f.name, type: f.type, value: f.value }));
}
