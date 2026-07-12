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
} from "@aetra/sdk";
import type { ConnectTxMessage, ContractFieldSpec } from "@aetra/connect";

/**
 * The intent compiler — turns the protocol's `ConnectTxMessage` list (the SAME
 * shape a dApp sends over Aetra Connect) into signed-tx building blocks for the
 * local pipeline. One intent vocabulary, two executors: a connected wallet does
 * this mapping inside the wallet app; `@aetra/kit`'s local transport does it
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
  "contract.deploy": 400_000n,
  raw: 200_000n,
};

export interface CompiledIntents {
  messages: Message[];
  /** Suggested outer fee gas (sum of per-intent defaults). */
  gasLimit: bigint;
  /** Set when a message's own signer can't pay (activation) — the plain account pays. */
  feePayer?: Address;
  /** Client-side-predicted contract addresses, in `contract.deploy` intent order. */
  predictedContracts: { address: Address; codeId: string }[];
}

/** Compiles `intents` for `signer` at chain `height`. Throws on an unknown kind. */
export function compileIntents(intents: ConnectTxMessage[], signer: Wallet, height: bigint): CompiledIntents {
  const messages: Message[] = [];
  const predictedContracts: { address: Address; codeId: string }[] = [];
  let gasLimit = 0n;
  let feePayer: Address | undefined;

  for (const intent of intents) {
    switch (intent.kind) {
      case "send": {
        messages.push(new MsgSend({ from: signer.address, to: intent.to, amount: Amount.fromNaet(intent.amountNaet) }));
        gasLimit += GAS.send!;
        break;
      }
      case "activate": {
        messages.push(new MsgActivateAccount({ identity: signer.nativeIdentity(), pubkeyHex: signer.pubkeyHex }));
        // The synthetic identity address has no balance — the plain account pays.
        feePayer = signer.address;
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
            admin: intent.admin,
            height,
          }),
        );
        predictedContracts.push({ address, codeId });
        gasLimit += BigInt(intent.gasLimit ?? Number(GAS["contract.deploy"]!));
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

  const result: CompiledIntents = { messages, gasLimit, predictedContracts };
  if (feePayer) result.feePayer = feePayer;
  return result;
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
