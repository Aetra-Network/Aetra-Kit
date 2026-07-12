import { describe, it, expect } from "vitest";
import { Wallet } from "@aetra/sdk";
import {
  parseAet,
  formatAet,
  formatAetWithSymbol,
  isAddress,
  toRawAddress,
  toUserFriendlyAddress,
  shortenAddress,
  toNativeIdentity,
} from "../src/utils.js";

describe("amount utils", () => {
  it("parses and formats AET exactly (no float rounding)", () => {
    expect(parseAet("1.5")).toBe(1_500_000_000n);
    expect(parseAet("0.000000001")).toBe(1n);
    expect(formatAet(1_500_000_000n)).toBe("1.5");
    expect(formatAet("2000000000")).toBe("2");
    expect(formatAetWithSymbol(500_000_000n)).toBe("0.5 AET");
  });

  it("round-trips a value above MAX_SAFE_INTEGER", () => {
    const naet = 123_456_789_123_456_789n;
    expect(parseAet(formatAet(naet))).toBe(naet);
  });

  it("rejects malformed amounts", () => {
    expect(() => parseAet("1,5")).toThrow();
    expect(() => parseAet("1.0000000001")).toThrow(); // > 9 decimals
  });
});

describe("address utils", () => {
  const wallet = Wallet.random();
  const user = wallet.address.toUserFriendly();
  const raw = wallet.address.toRaw();

  it("converts user-friendly ↔ raw both ways", () => {
    expect(toRawAddress(user)).toBe(raw);
    expect(toUserFriendlyAddress(raw)).toBe(user);
    // Idempotent on the already-converted form.
    expect(toRawAddress(raw)).toBe(raw);
    expect(toUserFriendlyAddress(user)).toBe(user);
  });

  it("validates and shortens", () => {
    expect(isAddress(user)).toBe(true);
    expect(isAddress(raw)).toBe(true);
    expect(isAddress("nonsense")).toBe(false);
    expect(shortenAddress(user)).toMatch(/^.{8}\.\.\..{6}$/);
  });

  it("derives the native identity (32-byte, distinct from the plain account)", () => {
    const identity = toNativeIdentity(user);
    expect(identity).not.toBe(user);
    expect(identity).toBe(wallet.nativeIdentity().toUserFriendly());
  });
});
