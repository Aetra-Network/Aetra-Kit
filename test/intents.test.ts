import { describe, it, expect } from "vitest";
import { Wallet, Bytes } from "@aetra-network/sdk";
import type { ConnectTxMessage } from "@aetra-network/connect";
import { compileIntents } from "../src/index.js";

const signer = Wallet.random();

function deployIntent(byteLen: number): ConnectTxMessage {
  return {
    kind: "contract.deploy",
    bytecodeBase64: Bytes.toBase64(new Uint8Array(byteLen)),
    salt: "s1",
  };
}

describe("compileIntents deploy gas", () => {
  it("scales suggested deploy gas with bytecode length (no longer a flat default)", () => {
    const small = compileIntents([deployIntent(100)], signer, 1n).gasLimit;
    const large = compileIntents([deployIntent(50_000)], signer, 1n).gasLimit;
    // A 50 KB contract must be funded for far more gas than a 100-byte one —
    // the old flat 400k default under-funded large deploys.
    expect(large).toBeGreaterThan(small);
    // base 400k + 30/byte.
    expect(small).toBe(400_000n + 30n * 100n);
    expect(large).toBe(400_000n + 30n * 50_000n);
  });

  it("honors an explicit per-intent gasLimit override", () => {
    const intent: ConnectTxMessage = {
      kind: "contract.deploy",
      bytecodeBase64: Bytes.toBase64(new Uint8Array(50_000)),
      salt: "s1",
      gasLimit: 900_000,
    };
    expect(compileIntents([intent], signer, 1n).gasLimit).toBe(900_000n);
  });

  it("still predicts the deployed contract address", () => {
    const { predictedContracts } = compileIntents([deployIntent(100)], signer, 1n);
    expect(predictedContracts).toHaveLength(1);
    expect(predictedContracts[0]!.address.isNativeIdentity).toBe(true);
  });
});
