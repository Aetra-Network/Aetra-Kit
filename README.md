# @aetra-network/kit

The **viem / wagmi analogue for the Aetra L1** — typed clients, functional
utils, one transaction-intent vocabulary that executes through a local key
(server, bot, script) **or** a wallet connected over
[Aetra Connect](../aetra-connect) (dApp), and wagmi-style React hooks.

| Ethereum stack | Aetra stack |
| --- | --- |
| viem primitives (address, units, ABI) | [`@aetra-network/sdk`](../sdk) |
| viem `createPublicClient` / `createWalletClient` | **`@aetra-network/kit`** |
| wagmi connectors | kit accounts: `localAccount` + `connectAccount` |
| wagmi hooks (`useAccount`, `useBalance`, …) | **`@aetra-network/kit/react`** |
| WalletConnect / RainbowKit modal | [`@aetra-network/connect`](../aetra-connect) + [`@aetra-network/connect-react`](../aetra-connect-react) |

## Install

The `@aetra-network` scope is published to **private GitHub Packages**
(`https://npm.pkg.github.com`), not the public npm registry — a bare
`npm install @aetra-network/kit` against npmjs.com will 404. To install it,
point the scope at GitHub Packages and authenticate with a GitHub token that
has the `read:packages` scope (and access to the Aetra-Network org, since the
packages are restricted).

Add an `.npmrc` in your project (see [`.npmrc.example`](./.npmrc.example)):

```ini
@aetra-network:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}
```

Then export your token and install:

```bash
export NODE_AUTH_TOKEN=ghp_your_token_with_read_packages
npm install @aetra-network/kit @aetra-network/sdk @aetra-network/connect
# for the React hooks additionally:
npm install @aetra-network/connect-react react
```

## Environments

`@aetra-network/kit` ships **ESM-only** (`"type": "module"`, no CJS build) — so does
every package underneath it (`@aetra-network/sdk`, `@aetra-network/connect`,
`@aetra-network/connect-react`). `require("@aetra-network/kit")` will not work; `import`
(static, or dynamic `import()` from a CommonJS file) will. This is a
deliberate choice, not an oversight: the whole dependency chain is ESM-only,
so a CJS build of kit would still crash the moment it required one of those
packages — shipping one would look "more universal" while actually breaking
at runtime.

Requires Node.js **>=18**, or any bundler/runtime with a modern ESM resolver
for the browser. There are no Node-only APIs in the client/account/intent
layer: networking goes through the global `fetch` (override it via `{ fetch }`
on any client config, for a runtime that needs it), and the signing/crypto
underneath (`@noble/curves`, `@noble/hashes`, `@scure/bip32`/`bip39`) prefers
WebCrypto (`crypto.getRandomValues`) wherever it's available, falling back to
Node's `crypto` module only on old Node. The same build runs unmodified in
Node, browsers, and edge runtimes (Cloudflare Workers, Vercel Edge, and
similar). `@aetra-network/kit/react` additionally needs a DOM (browser or React
Native) — it's never pulled in by a Node-only consumer of the root export.

## Functional utils

```ts
import { parseAet, formatAet, toRawAddress, toUserFriendlyAddress, isAddress, shortenAddress } from "@aetra-network/kit";

parseAet("1.5");                    // 1500000000n  (naet)
formatAet(1_500_000_000n);          // "1.5"
toRawAddress("AEJkAr…");            // "ae1…"       (user-friendly → raw)
toUserFriendlyAddress("ae1…");      // "AEJkAr…"    (raw → user-friendly)
isAddress("AEJkAr…");               // true
shortenAddress("AEJkAr…");          // "AEJkAr…"→"AEJkAr…" head/tail
```

## Public client (reads)

```ts
import { createPublicClient, Field } from "@aetra-network/kit";

const publicClient = createPublicClient({ url: "http://127.0.0.1:8080" });

await publicClient.getBalance("AE…");        // 2500000000n (naet)
await publicClient.getBalanceAet("ae1…");    // "2.5" — any address form works
await publicClient.getStatus();              // { chainId, height, catchingUp }
await publicClient.waitForTransaction(hash); // polls until delivered → TxDetail

await publicClient.readContract({
  address: "AE…contract",
  method: "currentCounter",
  args: [Field.uint("n", 5, 32)],
});
```

## Wallet client (writes) — one API, two key locations

### Server / bot / script: local key

```ts
import { createWalletClient } from "@aetra-network/kit";

const wallet = createWalletClient({
  account: { mnemonic: process.env.SEED! },   // or a Wallet, or { privateKeyHex }
  url: "http://127.0.0.1:8080",
});

await wallet.getBalanceAet();                                  // "12.3"
const { hash } = await wallet.sendAet({ to: "AE…", amount: "1.5", comment: "gm" });
await wallet.waitForTransaction(hash);
```

### dApp: the connected wallet signs

```ts
import { createWalletClient } from "@aetra-network/kit";
import { AetraConnect } from "@aetra-network/connect/dapp";

const connect = new AetraConnect({ manifestUrl: "https://myapp.com/aetra-connect-manifest.json" });
// … pair via QR (see @aetra-network/connect) …

const wallet = createWalletClient({ account: connect, url: "https://gw.aetra.network" });
await wallet.sendAet({ to: "AE…", amount: "1" });   // the USER approves in their wallet
```

**Identical actions on both**: `send(intents)`, `sendAet`, `activate`,
`executeContract`, `deployContract`, `signMessage`, `disconnect`,
`waitForTransaction`, `getBalance(Aet)`.

### Batching + intents

The action vocabulary is the Aetra Connect intent list — several intents become
**one signed tx** locally, or one approval in the connected wallet:

```ts
await wallet.send([
  { kind: "send", to: "AE…", amountNaet: "1000000000" },
  { kind: "stake.deposit", poolId: "pool-1", amountNaet: "5000000000" },
]);
```

Advanced: the same compiler `WalletClient` uses internally is exported
directly — `compileIntents(intents, wallet, height)` turns an intent list into
signed-tx-ready SDK messages (`payloadFrom`/`fieldsToSpecs` convert contract
field specs along the way) without a `WalletClient` in the loop, for callers
building their own local-signing pipeline.

### Contracts

```ts
import { Field } from "@aetra-network/kit";
import { readFileSync } from "node:fs";

// Deploy — the address is deterministic and predicted client-side:
const { hash, contract, codeId } = await wallet.deployContract({
  bytecode: readFileSync(".atlx-out/Counter/module.bin"),
  salt: "counter-1",
  initFields: [Field.uint("start", 0, 32)],
});
await wallet.waitForTransaction(hash);

// Write — @external entrypoint:
await wallet.executeContract({ contract, opcode: 0x2001, fields: [Field.uint("nonce", 5, 32)] });

// Read — @get method:
await publicClient.readContract({ address: contract, method: "currentCounter" });
```

## React hooks (`@aetra-network/kit/react`)

```tsx
"use client";
import { createConfig, AetraKitProvider, AetraConnectButton } from "@aetra-network/kit/react";

const config = createConfig({
  manifestUrl: "https://myapp.com/aetra-connect-manifest.json",
  gatewayUrl: "https://gw.aetra.network",
  requiredChainId: "aetra-mainnet-1",
});

export function Providers({ children }) {
  return <AetraKitProvider config={config}>{children}</AetraKitProvider>;
}
```

```tsx
import {
  useAccount, useConnect, useDisconnect, useBalance,
  useSendTransaction, useReadContract, useDeployContract, useSignMessage,
} from "@aetra-network/kit/react";

function Profile() {
  const { address, isConnected } = useAccount();
  const { connect } = useConnect();          // opens the built-in QR modal
  const { disconnect } = useDisconnect();
  const { data: balance } = useBalance({ watch: true });

  if (!isConnected) return <button onClick={connect}>Подключить кошелёк</button>; // ← any custom button
  return (
    <div>
      {address} — {balance?.formatted} {balance?.symbol}
      <button onClick={disconnect}>Disconnect</button>
    </div>
  );
}

function Send() {
  const { sendAet, isPending, data } = useSendTransaction();
  return (
    <button disabled={isPending} onClick={() => sendAet({ to: "AE…", amount: "1" })}>
      {data ? `Sent ${data.hash}` : "Send 1 AET"}
    </button>
  );
}

function Counter({ contract }: { contract: string }) {
  const { data } = useReadContract({ address: contract, method: "currentCounter", watch: 5_000 });
  return <span>count: {data}</span>;
}
```

| Hook | wagmi analogue |
| --- | --- |
| `useAccount()` | `useAccount` — address (+raw), `isConnected`, `isRestored` |
| `useConnect()` / `useDisconnect()` | `useConnect` / `useDisconnect` — `connect()` opens the pairing modal (works with any custom button) |
| `useBalance({ address?, watch? })` | `useBalance` — `{ naet, formatted, symbol: "AET" }` |
| `useSendTransaction()` | `useSendTransaction` — `sendTransaction(intents)` + `sendAet` |
| `useReadContract({...})` | `useReadContract` — `@get` reads with `watch` polling |
| `useExecuteContract()` / `useDeployContract()` | `useWriteContract` / `useDeployContract` |
| `useSignMessage()` | `useSignMessage` |
| `usePublicClient()` / `useWalletClient()` | same |

`<AetraConnectButton />`, `<ConnectModal>`, and `<Qr>` are re-exported for a
drop-in UI; skip them and wire `useConnect().connect` to your own button for a
fully custom look.

## Develop

```bash
npm install
npm run check   # typecheck + 24 tests (node + jsdom) + build
```

## License

Apache-2.0
