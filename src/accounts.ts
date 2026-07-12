import { Wallet, Mnemonic } from "@aetra/sdk";
import type { AetraConnect } from "@aetra/connect/dapp";

/**
 * Accounts — the wagmi "connector/account" seam. A `WalletClient` executes the
 * same actions through either kind:
 *
 *   - `LocalAccount` — a secp256k1 key in this process (server, bot, script).
 *     Signs locally via the SDK `Wallet`.
 *   - `ConnectAccount` — a wallet connected over Aetra Connect. Holds no key;
 *     every action becomes an intent the user approves in their wallet.
 */

export interface LocalAccount {
  readonly type: "local";
  readonly wallet: Wallet;
  readonly address: string;
  readonly addressRaw: string;
  readonly pubkeyHex: string;
}

export interface ConnectAccount {
  readonly type: "connect";
  readonly connect: AetraConnect;
  /** Throws NO_SESSION-style errors when read while disconnected. */
  readonly address: string;
  readonly addressRaw: string;
  readonly pubkeyHex: string;
}

export type AetraAccount = LocalAccount | ConnectAccount;

/** Sources a local account accepts. */
export type LocalAccountSource = Wallet | { mnemonic: string } | { privateKeyHex: string };

/** Builds a `LocalAccount` from a `Wallet`, a mnemonic phrase, or a raw private key. */
export function localAccount(source: LocalAccountSource): LocalAccount {
  const wallet =
    source instanceof Wallet
      ? source
      : "mnemonic" in source
        ? Wallet.fromMnemonic(Mnemonic.fromPhrase(source.mnemonic))
        : Wallet.fromPrivateKey(source.privateKeyHex);
  return {
    type: "local",
    wallet,
    address: wallet.address.toUserFriendly(),
    addressRaw: wallet.address.toRaw(),
    pubkeyHex: wallet.pubkeyHex,
  };
}

/** Wraps a (possibly not-yet-connected) `AetraConnect` as an account; address getters are live. */
export function connectAccount(connect: AetraConnect): ConnectAccount {
  const current = () => {
    const account = connect.account;
    if (!account) throw new Error("no connected wallet — open the connect modal first");
    return account;
  };
  return {
    type: "connect",
    connect,
    get address() {
      return current().address;
    },
    get addressRaw() {
      return current().addressRaw;
    },
    get pubkeyHex() {
      return current().pubkeyHex;
    },
  };
}
