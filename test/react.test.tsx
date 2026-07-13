// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import { Wallet } from "@aetra-network/sdk";
import { AetraWalletConnect, MemoryBridge } from "@aetra-network/connect";
import type { AetraConnect } from "@aetra-network/connect/dapp";
import { useAetraConnect } from "@aetra-network/connect-react";
import { createConfig, AetraKitProvider, useAccount, useBalance, useSendTransaction } from "../src/react/index.js";
import { fakeGateway } from "./fakeGateway.js";

afterEach(cleanup);

/** Exposes kit state and captures the underlying AetraConnect for programmatic pairing. */
function Probe({ onConnect }: { onConnect: (c: AetraConnect) => void }) {
  const { connect } = useAetraConnect();
  onConnect(connect);
  const { address, isConnected, isRestored } = useAccount();
  const { data: balance } = useBalance();
  const { sendAet, data: tx } = useSendTransaction();
  return (
    <div>
      <span data-testid="restored">{String(isRestored)}</span>
      <span data-testid="connected">{String(isConnected)}</span>
      <span data-testid="address">{address ?? "-"}</span>
      <span data-testid="balance">{balance ? `${balance.formatted} ${balance.symbol}` : "-"}</span>
      <span data-testid="tx">{tx?.hash ?? "-"}</span>
      <button onClick={() => void sendAet({ to: address!, amount: "1" })}>send</button>
    </div>
  );
}

describe("@aetra-network/kit/react", () => {
  it("connects, reads the balance in AET, and sends through the wallet", async () => {
    const bridge = new MemoryBridge();
    const { fetchImpl, state } = fakeGateway();
    const walletSigner = Wallet.random();
    state.balances.set(walletSigner.address.toUserFriendly(), 3_250_000_000n);

    const walletSide = new AetraWalletConnect({
      bridge,
      signer: walletSigner,
      chainId: "aetra-test-1",
      onTransaction: async () => ({ hash: "0xREACT", accepted: true }),
    });

    const config = createConfig({
      app: { name: "Kit Test", url: "https://kit.example" },
      bridge,
      gatewayUrl: "http://gw",
      gatewayFetch: fetchImpl,
      proof: false,
    });

    let dappConnect!: AetraConnect;
    render(
      <AetraKitProvider config={config}>
        <Probe onConnect={(c) => (dappConnect = c)} />
      </AetraKitProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("restored").textContent).toBe("true"));
    expect(screen.getByTestId("connected").textContent).toBe("false");

    // Pair programmatically (a real app calls useConnect().connect for the modal).
    const hs = dappConnect.connect({ proof: false });
    await walletSide.approve(walletSide.readRequest(hs.deepLink));
    await hs.approval();

    await waitFor(() => expect(screen.getByTestId("connected").textContent).toBe("true"));
    expect(screen.getByTestId("address").textContent).toBe(walletSigner.address.toUserFriendly());
    await waitFor(() => expect(screen.getByTestId("balance").textContent).toBe("3.25 AET"));

    // The send action routes through the connected wallet's handler.
    fireEvent.click(screen.getByRole("button", { name: "send" }));
    await waitFor(() => expect(screen.getByTestId("tx").textContent).toBe("0xREACT"));
  });
});
