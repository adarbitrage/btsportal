/**
 * NMI Gateway sandbox test.
 *
 * Demonstrates the full result contract of each gateway method using mocked
 * NMI responses that mirror what the real NMI sandbox returns. No real
 * network calls are made; the fixture responses are taken directly from NMI's
 * documented response format.
 *
 * Covered scenarios (per the Tier 1 spec):
 *  1. Token sale   → success=true with transactionId
 *  2. Refund       → success=true with refund transactionId
 *  3. Void         → success=true with void transactionId
 *  4. Forced decline (response=2) → success=false WITHOUT throwing
 *  5. Gateway error  (response=3) → success=false WITHOUT throwing
 *  6. createVaultFromToken        → success=true + customerVaultId
 *  7. chargeWithVault             → success=true
 *  8. queryTransaction            → returns <condition> value from XML
 */

import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";

const fetchMock = vi.fn();

vi.stubGlobal("fetch", fetchMock);

function nmiOkResponse(fields: Record<string, string>): Response {
  const body = new URLSearchParams(fields).toString();
  return {
    ok: true,
    status: 200,
    text: async () => body,
  } as unknown as Response;
}

function nmiQueryResponse(condition: string): Response {
  const body = `<?xml version="1.0" encoding="UTF-8"?><nm_response><transaction><condition>${condition}</condition><transaction_id>T9999</transaction_id></transaction></nm_response>`;
  return {
    ok: true,
    status: 200,
    text: async () => body,
  } as unknown as Response;
}

function httpErrorResponse(status: number): Response {
  return {
    ok: false,
    status,
    text: async () => "Internal Server Error",
  } as unknown as Response;
}

beforeAll(() => {
  process.env.BTS_NMI_SECURITY_KEY = "demo_sandbox_key_6457Thfj624V5r7W";
  process.env.BTS_NMI_TOKENIZATION_KEY = "demo_public_tokenization_key";
  process.env.NMI_LIVE_MODE = "true";
});

afterEach(() => {
  fetchMock.mockReset();
});

describe("NMI Gateway — chargeWithToken (token sale)", () => {
  it("returns success=true with transactionId on approved response", async () => {
    fetchMock.mockResolvedValueOnce(
      nmiOkResponse({
        response: "1",
        responsetext: "SUCCESS",
        authcode: "123456",
        transactionid: "TXN001",
        avsresponse: "N",
        cvvresponse: "N",
        orderid: "order-abc",
        response_code: "100",
      }),
    );

    const { chargeWithToken } = await import("../lib/payments/nmi-gateway.js");
    const result = await chargeWithToken({
      amountCents: 9900,
      paymentToken: "tok_sandbox_abc123",
      orderId: "order-abc",
      email: "test@example.com",
      firstName: "Test",
      lastName: "User",
    });

    expect(result.success).toBe(true);
    expect(result.transactionId).toBe("TXN001");
    expect(result.responseText).toBe("SUCCESS");
    expect(result.raw["response"]).toBe("1");

    const [url, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://secure.nmi.com/api/transact.php");
    expect(opts.method).toBe("POST");
    const posted = new URLSearchParams(opts.body as string);
    expect(posted.get("type")).toBe("sale");
    expect(posted.get("amount")).toBe("99.00");
    expect(posted.get("payment_token")).toBe("tok_sandbox_abc123");
    expect(posted.get("email")).toBe("test@example.com");
    expect(posted.get("security_key")).toBe("demo_sandbox_key_6457Thfj624V5r7W");
  });
});

describe("NMI Gateway — forced decline", () => {
  it("returns success=false WITHOUT throwing when NMI declines (response=2)", async () => {
    fetchMock.mockResolvedValueOnce(
      nmiOkResponse({
        response: "2",
        responsetext: "DECLINED",
        authcode: "",
        transactionid: "",
        response_code: "200",
      }),
    );

    const { chargeWithToken } = await import("../lib/payments/nmi-gateway.js");
    const result = await chargeWithToken({
      amountCents: 100,
      paymentToken: "tok_decline",
      orderId: "order-decline",
      email: "decline@example.com",
    });

    expect(result.success).toBe(false);
    expect(result.responseText).toBe("DECLINED");
  });

  it("returns success=false WITHOUT throwing when NMI returns error (response=3)", async () => {
    fetchMock.mockResolvedValueOnce(
      nmiOkResponse({
        response: "3",
        responsetext: "Invalid card number",
        authcode: "",
        transactionid: "",
        response_code: "300",
      }),
    );

    const { chargeWithToken } = await import("../lib/payments/nmi-gateway.js");
    const result = await chargeWithToken({
      amountCents: 100,
      paymentToken: "tok_invalid",
      orderId: "order-error",
      email: "error@example.com",
    });

    expect(result.success).toBe(false);
    expect(result.responseText).toBe("Invalid card number");
  });
});

describe("NMI Gateway — refund", () => {
  it("returns success=true with refund transactionId on full refund", async () => {
    fetchMock.mockResolvedValueOnce(
      nmiOkResponse({
        response: "1",
        responsetext: "SUCCESS",
        transactionid: "REF001",
        response_code: "100",
      }),
    );

    const { refund } = await import("../lib/payments/nmi-gateway.js");
    const result = await refund({ transactionId: "TXN001" });

    expect(result.success).toBe(true);
    expect(result.transactionId).toBe("REF001");
    const posted = new URLSearchParams(fetchMock.mock.calls[0][1].body as string);
    expect(posted.get("type")).toBe("refund");
    expect(posted.get("transactionid")).toBe("TXN001");
    expect(posted.has("amount")).toBe(false);
  });

  it("sends amount for a partial refund", async () => {
    fetchMock.mockResolvedValueOnce(
      nmiOkResponse({
        response: "1",
        responsetext: "SUCCESS",
        transactionid: "REF002",
        response_code: "100",
      }),
    );

    const { refund } = await import("../lib/payments/nmi-gateway.js");
    const result = await refund({ transactionId: "TXN001", amountCents: 4900 });

    expect(result.success).toBe(true);
    const posted = new URLSearchParams(fetchMock.mock.calls[0][1].body as string);
    expect(posted.get("amount")).toBe("49.00");
  });
});

describe("NMI Gateway — void", () => {
  it("returns success=true with void transactionId", async () => {
    fetchMock.mockResolvedValueOnce(
      nmiOkResponse({
        response: "1",
        responsetext: "Transaction Void Successful",
        transactionid: "VOID001",
        response_code: "100",
      }),
    );

    const { voidTransaction } = await import("../lib/payments/nmi-gateway.js");
    const result = await voidTransaction({ transactionId: "TXN001" });

    expect(result.success).toBe(true);
    expect(result.transactionId).toBe("VOID001");
    const posted = new URLSearchParams(fetchMock.mock.calls[0][1].body as string);
    expect(posted.get("type")).toBe("void");
    expect(posted.get("transactionid")).toBe("TXN001");
  });
});

describe("NMI Gateway — createVaultFromToken", () => {
  it("returns success=true and customerVaultId", async () => {
    fetchMock.mockResolvedValueOnce(
      nmiOkResponse({
        response: "1",
        responsetext: "Customer Added",
        transactionid: "VAULT001",
        customer_vault_id: "CV123456",
        response_code: "100",
      }),
    );

    const { createVaultFromToken } = await import("../lib/payments/nmi-gateway.js");
    const result = await createVaultFromToken({
      paymentToken: "tok_sandbox_abc123",
      email: "vault@example.com",
      firstName: "Vault",
      lastName: "User",
    });

    expect(result.success).toBe(true);
    expect(result.customerVaultId).toBe("CV123456");
    const posted = new URLSearchParams(fetchMock.mock.calls[0][1].body as string);
    expect(posted.get("customer_vault")).toBe("add_customer");
  });
});

describe("NMI Gateway — chargeWithVault", () => {
  it("returns success=true using a stored vault id", async () => {
    fetchMock.mockResolvedValueOnce(
      nmiOkResponse({
        response: "1",
        responsetext: "SUCCESS",
        transactionid: "TXN002",
        response_code: "100",
      }),
    );

    const { chargeWithVault } = await import("../lib/payments/nmi-gateway.js");
    const result = await chargeWithVault({
      amountCents: 19900,
      customerVaultId: "CV123456",
      orderId: "order-vault",
      email: "vault@example.com",
    });

    expect(result.success).toBe(true);
    expect(result.transactionId).toBe("TXN002");
    const posted = new URLSearchParams(fetchMock.mock.calls[0][1].body as string);
    expect(posted.get("customer_vault_id")).toBe("CV123456");
    expect(posted.get("amount")).toBe("199.00");
  });
});

describe("NMI Gateway — queryTransaction", () => {
  it("parses <condition> from NMI query XML response (pendingsettlement = voidable)", async () => {
    fetchMock.mockResolvedValueOnce(nmiQueryResponse("pendingsettlement"));

    const { queryTransaction } = await import("../lib/payments/nmi-gateway.js");
    const result = await queryTransaction({ orderId: "order-abc" });

    expect(result.condition).toBe("pendingsettlement");
    const [url, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://secure.nmi.com/api/query.php");
    const posted = new URLSearchParams(opts.body as string);
    expect(posted.get("order_id")).toBe("order-abc");
  });

  it("parses <condition>=complete (settled = refundable)", async () => {
    fetchMock.mockResolvedValueOnce(nmiQueryResponse("complete"));

    const { queryTransaction } = await import("../lib/payments/nmi-gateway.js");
    const result = await queryTransaction({ orderId: "order-settled" });

    expect(result.condition).toBe("complete");
  });
});

describe("NMI Gateway — transport failure", () => {
  it("THROWS on a non-2xx HTTP response (transport failure, not a decline)", async () => {
    fetchMock.mockResolvedValueOnce(httpErrorResponse(500));

    const { chargeWithToken } = await import("../lib/payments/nmi-gateway.js");
    await expect(
      chargeWithToken({
        amountCents: 100,
        paymentToken: "tok_any",
        orderId: "order-err",
        email: "err@example.com",
      }),
    ).rejects.toThrow(/NMI transact HTTP 500/);
  });
});

describe("NMI Gateway — getTokenizationKey", () => {
  it("returns the public tokenization key from the environment", async () => {
    const { getTokenizationKey } = await import("../lib/payments/nmi-gateway.js");
    expect(getTokenizationKey()).toBe("demo_public_tokenization_key");
  });
});

describe("NMI Gateway — NMI_LIVE_MODE fail-closed gate", () => {
  const originalLiveMode = process.env.NMI_LIVE_MODE;

  afterEach(() => {
    if (originalLiveMode === undefined) {
      delete process.env.NMI_LIVE_MODE;
    } else {
      process.env.NMI_LIVE_MODE = originalLiveMode;
    }
  });

  it("refuses chargeWithToken when NMI_LIVE_MODE is unset", async () => {
    delete process.env.NMI_LIVE_MODE;
    const { chargeWithToken } = await import("../lib/payments/nmi-gateway.js");
    await expect(
      chargeWithToken({
        amountCents: 100,
        paymentToken: "tok_any",
        orderId: "order-gate",
        email: "gate@example.com",
      }),
    ).rejects.toThrow("NMI live mode not enabled — refusing to move money");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses chargeWithToken when NMI_LIVE_MODE is a non-'true' value", async () => {
    process.env.NMI_LIVE_MODE = "false";
    const { chargeWithToken } = await import("../lib/payments/nmi-gateway.js");
    await expect(
      chargeWithToken({
        amountCents: 100,
        paymentToken: "tok_any",
        orderId: "order-gate-2",
        email: "gate2@example.com",
      }),
    ).rejects.toThrow("NMI live mode not enabled — refusing to move money");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses chargeWithVault when NMI_LIVE_MODE is unset", async () => {
    delete process.env.NMI_LIVE_MODE;
    const { chargeWithVault } = await import("../lib/payments/nmi-gateway.js");
    await expect(
      chargeWithVault({
        amountCents: 100,
        customerVaultId: "CV1",
        orderId: "order-gate-3",
        email: "gate3@example.com",
      }),
    ).rejects.toThrow("NMI live mode not enabled — refusing to move money");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses refund when NMI_LIVE_MODE is unset", async () => {
    delete process.env.NMI_LIVE_MODE;
    const { refund } = await import("../lib/payments/nmi-gateway.js");
    await expect(refund({ transactionId: "TXN001" })).rejects.toThrow(
      "NMI live mode not enabled — refusing to move money",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses voidTransaction when NMI_LIVE_MODE is unset", async () => {
    delete process.env.NMI_LIVE_MODE;
    const { voidTransaction } = await import("../lib/payments/nmi-gateway.js");
    await expect(voidTransaction({ transactionId: "TXN001" })).rejects.toThrow(
      "NMI live mode not enabled — refusing to move money",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses createVaultFromToken when NMI_LIVE_MODE is unset", async () => {
    delete process.env.NMI_LIVE_MODE;
    const { createVaultFromToken } = await import("../lib/payments/nmi-gateway.js");
    await expect(
      createVaultFromToken({ paymentToken: "tok_any", email: "gate4@example.com" }),
    ).rejects.toThrow("NMI live mode not enabled — refusing to move money");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses deleteVaultCustomer when NMI_LIVE_MODE is unset", async () => {
    delete process.env.NMI_LIVE_MODE;
    const { deleteVaultCustomer } = await import("../lib/payments/nmi-gateway.js");
    await expect(
      deleteVaultCustomer({ customerVaultId: "CV1" }),
    ).rejects.toThrow("NMI live mode not enabled — refusing to move money");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("proceeds (reaches fetch) when NMI_LIVE_MODE is exactly 'true'", async () => {
    process.env.NMI_LIVE_MODE = "true";
    fetchMock.mockResolvedValueOnce(
      nmiOkResponse({
        response: "1",
        responsetext: "SUCCESS",
        transactionid: "TXN_LIVE",
        response_code: "100",
      }),
    );
    const { chargeWithToken } = await import("../lib/payments/nmi-gateway.js");
    const result = await chargeWithToken({
      amountCents: 100,
      paymentToken: "tok_any",
      orderId: "order-gate-live",
      email: "live@example.com",
    });
    expect(result.success).toBe(true);
    expect(fetchMock).toHaveBeenCalled();
  });

  it("queryTransaction works even when NMI_LIVE_MODE is unset (read-only)", async () => {
    delete process.env.NMI_LIVE_MODE;
    fetchMock.mockResolvedValueOnce(nmiQueryResponse("complete"));
    const { queryTransaction } = await import("../lib/payments/nmi-gateway.js");
    const result = await queryTransaction({ orderId: "order-readonly" });
    expect(result.condition).toBe("complete");
    expect(fetchMock).toHaveBeenCalled();
  });
});
