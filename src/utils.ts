import { Address, Amount, AET_DECIMALS } from "@aetra/sdk";

/**
 * Functional utils — the viem-style counterparts to the SDK's `Address` and
 * `Amount` value objects. Same chain-validated logic underneath (these are thin
 * wrappers, not re-implementations), but as plain functions over plain strings,
 * so app code can convert and format without touching classes.
 */

// --- Amounts (AET ↔ naet) ----------------------------------------------------

/** `"1.5"` AET → `1500000000n` naet. Throws on malformed input. */
export function parseAet(display: string): bigint {
  return Amount.fromAet(display).toNaet();
}

/** naet (`bigint` or integer string) → `"1.5"` AET display string. */
export function formatAet(naet: bigint | string): string {
  return Amount.fromNaet(naet).toAet();
}

/** naet → `"1.5 AET"` (with the symbol). */
export function formatAetWithSymbol(naet: bigint | string): string {
  return Amount.fromNaet(naet).toString();
}

export { AET_DECIMALS };

// --- Addresses (user-friendly AE… ↔ raw ae1…) ---------------------------------

/** True if `value` parses as either address form. */
export function isAddress(value: string): boolean {
  return Address.isValid(value);
}

/** Any address form → the raw bech32 `ae1…` form. Throws on invalid input. */
export function toRawAddress(value: string): string {
  return Address.fromString(value).toRaw();
}

/** Any address form → the canonical user-friendly `AE…` form. Throws on invalid input. */
export function toUserFriendlyAddress(value: string): string {
  return Address.fromString(value).toUserFriendly();
}

/** `AEJkAr…q1rA`-style truncation of any address form (rendered user-friendly first). */
export function shortenAddress(value: string, head = 8, tail = 6): string {
  return Address.fromString(value).shorten(head, tail);
}

/** Derives the account's 32-byte native-identity address (activation/staking), user-friendly form. */
export function toNativeIdentity(value: string): string {
  return Address.fromString(value).nativeIdentity().toUserFriendly();
}
