/**
 * A fake Aetra gateway as a `fetch` implementation — serves the endpoints the
 * kit's clients hit, records broadcasts, and lets tests tune balances/latency.
 */
export interface FakeGatewayState {
  chainId: string;
  height: number;
  balances: Map<string, bigint>;
  /** Base64 tx bodies received on /tx/broadcast, in order. */
  broadcasts: string[];
  /** Hashes that /txs/:hash should 404 for this many more polls (for waitForTransaction). */
  pendingPolls: Map<string, number>;
  contractResult: { success: boolean; result?: string; result_type?: string; error?: string };
  /** account_number/sequence served by /accounts/:addr; sequence auto-increments on each accepted broadcast. */
  accountNumber: string;
  sequence: number;
  /** The sequence value served on each /accounts/:addr call, in order — lets tests prove sends serialized. */
  sequencesServed: number[];
  /** When set, /tx/broadcast returns this rejection instead of accepting. */
  broadcastFailure?: { code: number; log: string };
}

export function fakeGateway(overrides: Partial<FakeGatewayState> = {}) {
  const state: FakeGatewayState = {
    chainId: "aetra-test-1",
    height: 42,
    balances: new Map(),
    broadcasts: [],
    pendingPolls: new Map(),
    contractResult: { success: true, result: "7", result_type: "uint64" },
    accountNumber: "7",
    sequence: 3,
    sequencesServed: [],
    ...overrides,
  };

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const path = decodeURIComponent(url.pathname);

    if (path === "/status") {
      return json({ chain_id: state.chainId, latest_height: state.height, catching_up: false });
    }
    if (path.startsWith("/address/")) {
      const addr = path.slice("/address/".length);
      return json({ input: addr, valid: true, address: addr, kind: "wallet", balance: (state.balances.get(addr) ?? 0n).toString() });
    }
    if (path.startsWith("/accounts/") && !path.includes("/txs") && !path.endsWith("/status")) {
      const addr = path.slice("/accounts/".length);
      state.sequencesServed.push(state.sequence);
      return json({ address: addr, valid: true, exists: true, account_number: state.accountNumber, sequence: String(state.sequence) });
    }
    if (path === "/fees/estimate") {
      const gas = Number(url.searchParams.get("gas") ?? "200000");
      return json({
        gas_limit: gas,
        // The real gateway returns the fee denom-suffixed — keep the fake honest.
        required_fee: "500000000naet",
        base_fee: "500000000naet",
        max_fee: "1000000000naet",
        utilization_bps: 0,
        congested: false,
        at_hard_cap: false,
        denom: "naet",
      });
    }
    if (path === "/tx/broadcast") {
      const body = JSON.parse(String(init?.body ?? "{}")) as { tx_bytes?: string };
      state.broadcasts.push(body.tx_bytes ?? "");
      if (state.broadcastFailure) {
        return json({ hash: `HASH${state.broadcasts.length}`, code: state.broadcastFailure.code, log: state.broadcastFailure.log, accepted: false });
      }
      state.sequence += 1;
      return json({ hash: `HASH${state.broadcasts.length}`, code: 0, log: "", accepted: true });
    }
    if (path.startsWith("/txs/")) {
      const hash = path.slice("/txs/".length);
      const remaining = state.pendingPolls.get(hash) ?? 0;
      if (remaining > 0) {
        state.pendingPolls.set(hash, remaining - 1);
        return json({ error: "not found" }, 404);
      }
      return json({
        hash,
        height: state.height,
        time: "2026-07-12T00:00:00Z",
        index: 0,
        success: true,
        code: 0,
        gas_wanted: 200000,
        gas_used: 90000,
        messages: [{ type_url: "/cosmos.bank.v1beta1.MsgSend" }],
      });
    }
    if (path.endsWith("/get") && path.startsWith("/contracts/")) {
      return json({
        success: state.contractResult.success,
        exit_code: state.contractResult.success ? 0 : 1,
        gas_used: 1234,
        method: "m",
        selector: "0xdeadbeef",
        ...(state.contractResult.result !== undefined ? { result: state.contractResult.result } : {}),
        ...(state.contractResult.result_type !== undefined ? { result_type: state.contractResult.result_type } : {}),
        ...(state.contractResult.error !== undefined ? { error: state.contractResult.error } : {}),
      });
    }
    return json({ error: `unhandled path ${path}` }, 404);
  }) as typeof fetch;

  return { fetchImpl, state };
}
