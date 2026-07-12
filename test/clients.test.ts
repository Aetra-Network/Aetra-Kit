import { describe, it, expect } from "vitest";
import { Wallet, Field, Mnemonic } from "@aetra/sdk";
import { AetraWalletConnect, MemoryBridge, type SendTransactionParams } from "@aetra/connect";
import { AetraConnect } from "@aetra/connect/dapp";
import { createPublicClient, createWalletClient, localAccount, connectAccount } from "../src/index.js";
import { fakeGateway } from "./fakeGateway.js";

describe("PublicClient", () => {
  it("reads balance (naet + AET), account, status", async () => {
    const { fetchImpl, state } = fakeGateway();
    const pub = createPublicClient({ url: "http://gw", fetch: fetchImpl });
    const wallet = Wallet.random();
    const user = wallet.address.toUserFriendly();
    state.balances.set(user, 2_500_000_000n);

    expect(await pub.getBalance(user)).toBe(2_500_000_000n);
    expect(await pub.getBalanceAet(user)).toBe("2.5");
    // Raw ae1… input resolves to the same account.
    expect(await pub.getBalance(wallet.address.toRaw())).toBe(2_500_000_000n);

    const account = await pub.getAccount(user);
    expect(account).toMatchObject({ exists: true, accountNumber: 7n, sequence: 3n });

    const status = await pub.getStatus();
    expect(status).toEqual({ chainId: "aetra-test-1", height: 42, catchingUp: false });
  });

  it("waitForTransaction polls 404s until delivery", async () => {
    const { fetchImpl, state } = fakeGateway();
    state.pendingPolls.set("HASHX", 2); // 404 twice, then found
    const pub = createPublicClient({ url: "http://gw", fetch: fetchImpl });
    const tx = await pub.waitForTransaction("HASHX", { intervalMs: 5, timeoutMs: 2_000 });
    expect(tx.hash).toBe("HASHX");
    expect(tx.success).toBe(true);
  });

  it("reads a contract @get method", async () => {
    const { fetchImpl } = fakeGateway();
    const pub = createPublicClient({ url: "http://gw", fetch: fetchImpl });
    const res = await pub.readContract({
      address: Wallet.random().address.toUserFriendly(),
      method: "currentCounter",
      args: [Field.uint("n", 5, 32)],
    });
    expect(res.success).toBe(true);
    expect(res.result).toBe("7");
  });
});

describe("WalletClient — local account", () => {
  it("sends AET: builds, signs, broadcasts through the gateway", async () => {
    const { fetchImpl, state } = fakeGateway();
    const signer = Wallet.random();
    const wc = createWalletClient({ account: signer, url: "http://gw", fetch: fetchImpl });

    expect(wc.address).toBe(signer.address.toUserFriendly());
    expect(wc.addressRaw).toBe(signer.address.toRaw());

    const res = await wc.sendAet({ to: Wallet.random().address.toUserFriendly(), amount: "1.5", comment: "gm" });
    expect(res).toEqual({ hash: "HASH1", accepted: true });
    expect(state.broadcasts).toHaveLength(1);
    expect(state.broadcasts[0]!.length).toBeGreaterThan(100); // a real signed tx body
  });

  it("accepts a mnemonic source and bigint amounts", async () => {
    const { fetchImpl } = fakeGateway();
    const mnemonic = Mnemonic.generate();
    const expected = Wallet.fromMnemonic(mnemonic);
    const wc = createWalletClient({
      account: { mnemonic: mnemonic.toString() },
      url: "http://gw",
      fetch: fetchImpl,
    });
    expect(wc.address).toBe(expected.address.toUserFriendly());
    const res = await wc.sendAet({ to: Wallet.random().address.toUserFriendly(), amount: 42n });
    expect(res.accepted).toBe(true);
  });

  it("accepts a raw private-key-hex source", async () => {
    const { fetchImpl } = fakeGateway();
    const phrase = Wallet.random();
    const wc = createWalletClient({
      account: { privateKeyHex: phrase.privateKeyHex },
      url: "http://gw",
      fetch: fetchImpl,
    });
    expect(wc.address).toBe(phrase.address.toUserFriendly());
    const res = await wc.sendAet({ to: Wallet.random().address.toUserFriendly(), amount: 42n });
    expect(res.accepted).toBe(true);
  });

  it("normalizes a raw bech32 recipient (compileIntents doesn't require the caller to pre-normalize)", async () => {
    const { fetchImpl } = fakeGateway();
    const wc = createWalletClient({ account: Wallet.random(), url: "http://gw", fetch: fetchImpl });
    const recipient = Wallet.random().address;

    const res = await wc.send([{ kind: "send", to: recipient.toRaw(), amountNaet: "100" }]);
    expect(res.accepted).toBe(true);
  });

  it("surfaces a rejected broadcast instead of a silent success", async () => {
    const { fetchImpl } = fakeGateway({ broadcastFailure: { code: 5, log: "insufficient funds" } });
    const wc = createWalletClient({ account: Wallet.random(), url: "http://gw", fetch: fetchImpl });

    const res = await wc.sendAet({ to: Wallet.random().address.toUserFriendly(), amount: "1" });
    expect(res.accepted).toBe(false);
  });

  it("serializes concurrent sends on the same local account instead of racing the sequence", async () => {
    const { fetchImpl, state } = fakeGateway();
    const wc = createWalletClient({ account: Wallet.random(), url: "http://gw", fetch: fetchImpl });

    const [a, b] = await Promise.all([
      wc.sendAet({ to: Wallet.random().address.toUserFriendly(), amount: "1" }),
      wc.sendAet({ to: Wallet.random().address.toUserFriendly(), amount: "1" }),
    ]);

    expect(a.accepted).toBe(true);
    expect(b.accepted).toBe(true);
    expect(state.broadcasts).toHaveLength(2);
    // Each send read a distinct, up-to-date sequence — proof the second waited for the first.
    expect(state.sequencesServed).toEqual([3, 4]);
  });

  it("executes a batch of intents in one tx (send + stake.deposit)", async () => {
    const { fetchImpl, state } = fakeGateway();
    const wc = createWalletClient({ account: Wallet.random(), url: "http://gw", fetch: fetchImpl });
    const res = await wc.send([
      { kind: "send", to: Wallet.random().address.toUserFriendly(), amountNaet: "100" },
      { kind: "stake.deposit", poolId: "pool-1", amountNaet: "5000" },
    ]);
    expect(res.hash).toBe("HASH1");
    expect(state.broadcasts).toHaveLength(1); // one tx, two messages
  });

  it("activates (fee paid by the plain account)", async () => {
    const { fetchImpl } = fakeGateway();
    const wc = createWalletClient({ account: Wallet.random(), url: "http://gw", fetch: fetchImpl });
    const res = await wc.activate();
    expect(res.accepted).toBe(true);
  });

  it("deploys a contract and predicts its address deterministically", async () => {
    const { fetchImpl } = fakeGateway();
    const signer = Wallet.random();
    const wc = createWalletClient({ account: signer, url: "http://gw", fetch: fetchImpl });
    const bytecode = new Uint8Array(64).fill(7);

    const res = await wc.deployContract({ bytecode, salt: "kit-1", initFields: [Field.uint("start", 1, 32)] });
    expect(res.accepted).toBe(true);
    expect(res.contract).toMatch(/^AE/);
    expect(res.codeId.length).toBeGreaterThan(0);

    // Deterministic: same inputs → same predicted address.
    const again = await wc.deployContract({ bytecode, salt: "kit-1", initFields: [Field.uint("start", 1, 32)] });
    expect(again.contract).toBe(res.contract);
  });

  it("executes a contract @external call", async () => {
    const { fetchImpl } = fakeGateway();
    const wc = createWalletClient({ account: Wallet.random(), url: "http://gw", fetch: fetchImpl });
    const res = await wc.executeContract({
      contract: Wallet.random().address.toUserFriendly(),
      opcode: 0x2001,
      fields: [Field.uint("nonce", 5, 32)],
      funds: "0.1",
      gasLimit: 150_000,
    });
    expect(res.accepted).toBe(true);
  });

  it("signs an off-chain message locally", async () => {
    const { fetchImpl } = fakeGateway();
    const signer = Wallet.random();
    const wc = createWalletClient({ account: signer, url: "http://gw", fetch: fetchImpl });
    const sig = await wc.signMessage("hello");
    expect(sig.address).toBe(signer.address.toUserFriendly());
    expect(sig.signatureHex).toMatch(/^[0-9a-f]{128}$/);
  });
});

describe("WalletClient — connect account (full e2e over MemoryBridge)", () => {
  async function pair() {
    const bridge = new MemoryBridge();
    const walletSigner = Wallet.random();
    const received: SendTransactionParams[] = [];
    const walletSide = new AetraWalletConnect({
      bridge,
      signer: walletSigner,
      chainId: "aetra-test-1",
      onTransaction: async (params) => {
        received.push(params);
        return { hash: "0xCONNECT", accepted: true };
      },
    });
    const dapp = new AetraConnect({ app: { name: "Kit", url: "https://kit.example" }, bridge });
    const hs = dapp.connect({ proof: false });
    await walletSide.approve(walletSide.readRequest(hs.deepLink));
    await hs.approval();
    return { dapp, walletSigner, received };
  }

  it("routes the same actions through the connected wallet", async () => {
    const { fetchImpl, state } = fakeGateway();
    const { dapp, walletSigner, received } = await pair();
    state.balances.set(walletSigner.address.toUserFriendly(), 9_000_000_000n);

    const wc = createWalletClient({ account: connectAccount(dapp), url: "http://gw", fetch: fetchImpl });
    expect(wc.address).toBe(walletSigner.address.toUserFriendly());
    expect(await wc.getBalanceAet()).toBe("9");

    const res = await wc.sendAet({ to: Wallet.random().address.toUserFriendly(), amount: "2", comment: "hi" });
    expect(res).toEqual({ hash: "0xCONNECT", accepted: true });
    expect(received[0]!.messages[0]).toMatchObject({ kind: "send", amountNaet: "2000000000", comment: "hi" });

    // Deploy over connect: intent forwarded, address still predicted client-side.
    const deploy = await wc.deployContract({ bytecode: new Uint8Array(32).fill(1), salt: "s" });
    expect(deploy.hash).toBe("0xCONNECT");
    expect(deploy.contract).toMatch(/^AE/);
    expect(received[1]!.messages[0]).toMatchObject({ kind: "contract.deploy", salt: "s" });

    // signMessage goes through the wallet and is verified by the connect layer.
    const sig = await wc.signMessage("log in");
    expect(sig.address).toBe(walletSigner.address.toUserFriendly());

    await wc.disconnect();
    expect(dapp.connected).toBe(false);
  });

  it("accepts the AetraConnect instance directly as the account", async () => {
    const { fetchImpl } = fakeGateway();
    const { dapp } = await pair();
    const wc = createWalletClient({ account: dapp, url: "http://gw", fetch: fetchImpl });
    expect(wc.account.type).toBe("connect");
  });

  it("throws a clear error when reading the address while disconnected", () => {
    const bridge = new MemoryBridge();
    const dapp = new AetraConnect({ app: { name: "Kit", url: "https://kit.example" }, bridge });
    const account = connectAccount(dapp);
    expect(() => account.address).toThrow(/no connected wallet/);
  });
});
