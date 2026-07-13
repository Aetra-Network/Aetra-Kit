/**
 * @aetra-network/kit — the viem/wagmi analogue for the Aetra L1.
 *
 * Layer map (Ethereum → Aetra):
 *   - viem's primitives  → `@aetra-network/sdk` (Address, Amount, TxBuilder, codecs)
 *   - viem's clients     → this package: `createPublicClient` / `createWalletClient`
 *   - wagmi's connectors → accounts: `localAccount` (server/bot) + `connectAccount` (Aetra Connect)
 *   - wagmi's hooks      → `@aetra-network/kit/react`
 *
 * One transaction-intent vocabulary executes through either account kind, so
 * the same app code runs on a server with a key and in a browser with a
 * connected wallet.
 */

// Clients
export { PublicClient, createPublicClient } from "./publicClient.js";
export type { PublicClientConfig, AccountView, ChainStatus, ContractReadResult } from "./publicClient.js";
export { WalletClient, createWalletClient } from "./walletClient.js";
export type { WalletClientConfig, TxResult, DeployResult, AetAmount } from "./walletClient.js";

// Accounts
export { localAccount, connectAccount } from "./accounts.js";
export type { AetraAccount, LocalAccount, ConnectAccount, LocalAccountSource } from "./accounts.js";

// Intents (advanced: compile the protocol vocabulary to SDK messages yourself)
export { compileIntents, payloadFrom, fieldsToSpecs } from "./intents.js";
export type { CompiledIntents } from "./intents.js";

// Functional utils
export {
  parseAet,
  formatAet,
  formatAetWithSymbol,
  AET_DECIMALS,
  isAddress,
  toRawAddress,
  toUserFriendlyAddress,
  shortenAddress,
  toNativeIdentity,
} from "./utils.js";

// Re-exports app code commonly needs alongside the clients
export { Field, Amount, Address, Wallet, Mnemonic } from "@aetra-network/sdk";
export type { FieldValue, TxDetail, FeeEstimate } from "@aetra-network/sdk";
export type { ConnectTxMessage, SignMessageResult } from "@aetra-network/connect";
