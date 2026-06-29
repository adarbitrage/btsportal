const NMI_TRANSACT_URL = "https://secure.nmi.com/api/transact.php";
const NMI_QUERY_URL = "https://secure.nmi.com/api/query.php";

function getSecurityKey(): string {
  const key = process.env.BTS_NMI_SECURITY_KEY;
  if (!key) {
    throw new Error(
      "BTS_NMI_SECURITY_KEY is not configured. Set the secret to enable NMI gateway calls.",
    );
  }
  return key;
}

export function getTokenizationKey(): string | undefined {
  return process.env.BTS_NMI_TOKENIZATION_KEY;
}

export interface NmiResult {
  success: boolean;
  transactionId?: string;
  responseText: string;
  raw: Record<string, string>;
}

function parseNmiResponse(text: string): Record<string, string> {
  const params = new URLSearchParams(text);
  const out: Record<string, string> = {};
  for (const [k, v] of params.entries()) {
    out[k] = v;
  }
  return out;
}

function buildResult(raw: Record<string, string>): NmiResult {
  const response = raw["response"];
  const success = response === "1";
  const transactionId = raw["transactionid"] || undefined;
  const responseText = raw["responsetext"] ?? raw["response_code"] ?? "";
  return { success, transactionId, responseText, raw };
}

async function nmiPost(params: Record<string, string>): Promise<NmiResult> {
  const securityKey = getSecurityKey();
  const body = new URLSearchParams({ security_key: securityKey, ...params });

  const res = await fetch(NMI_TRANSACT_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "(no body)");
    throw new Error(`NMI transact HTTP ${res.status}: ${text}`);
  }

  const text = await res.text();
  const raw = parseNmiResponse(text);
  return buildResult(raw);
}

function centsToAmount(amountCents: number): string {
  return (amountCents / 100).toFixed(2);
}

export interface ChargeWithTokenParams {
  amountCents: number;
  paymentToken: string;
  orderId: string;
  email: string;
  firstName?: string;
  lastName?: string;
}

export async function chargeWithToken(params: ChargeWithTokenParams): Promise<NmiResult> {
  return nmiPost({
    type: "sale",
    payment_token: params.paymentToken,
    amount: centsToAmount(params.amountCents),
    orderid: params.orderId,
    email: params.email,
    ...(params.firstName ? { first_name: params.firstName } : {}),
    ...(params.lastName ? { last_name: params.lastName } : {}),
  });
}

export interface ChargeWithVaultParams {
  amountCents: number;
  customerVaultId: string;
  orderId: string;
  email: string;
}

export async function chargeWithVault(params: ChargeWithVaultParams): Promise<NmiResult> {
  return nmiPost({
    type: "sale",
    customer_vault_id: params.customerVaultId,
    amount: centsToAmount(params.amountCents),
    orderid: params.orderId,
    email: params.email,
  });
}

export interface CreateVaultFromTokenParams {
  paymentToken: string;
  email: string;
  firstName?: string;
  lastName?: string;
}

export interface CreateVaultResult extends NmiResult {
  customerVaultId?: string;
}

export async function createVaultFromToken(
  params: CreateVaultFromTokenParams,
): Promise<CreateVaultResult> {
  const result = await nmiPost({
    customer_vault: "add_customer",
    payment_token: params.paymentToken,
    email: params.email,
    ...(params.firstName ? { first_name: params.firstName } : {}),
    ...(params.lastName ? { last_name: params.lastName } : {}),
  });
  const customerVaultId = result.raw["customer_vault_id"] || undefined;
  return { ...result, customerVaultId };
}

export interface DeleteVaultParams {
  customerVaultId: string;
}

export async function deleteVaultCustomer(params: DeleteVaultParams): Promise<NmiResult> {
  return nmiPost({
    customer_vault: "delete_customer",
    customer_vault_id: params.customerVaultId,
  });
}

export interface RefundParams {
  transactionId: string;
  amountCents?: number;
}

export async function refund(params: RefundParams): Promise<NmiResult> {
  const fields: Record<string, string> = {
    type: "refund",
    transactionid: params.transactionId,
  };
  if (params.amountCents !== undefined) {
    fields["amount"] = centsToAmount(params.amountCents);
  }
  return nmiPost(fields);
}

export interface VoidParams {
  transactionId: string;
}

export async function voidTransaction(params: VoidParams): Promise<NmiResult> {
  return nmiPost({
    type: "void",
    transactionid: params.transactionId,
  });
}

export interface QueryTransactionParams {
  orderId: string;
}

export interface QueryTransactionResult {
  condition?: string;
  raw: string;
}

export async function queryTransaction(
  params: QueryTransactionParams,
): Promise<QueryTransactionResult> {
  const securityKey = getSecurityKey();
  const body = new URLSearchParams({
    security_key: securityKey,
    order_id: params.orderId,
  });

  const res = await fetch(NMI_QUERY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "(no body)");
    throw new Error(`NMI query HTTP ${res.status}: ${text}`);
  }

  const text = await res.text();
  const conditionMatch = text.match(/<condition>([^<]*)<\/condition>/);
  const condition = conditionMatch ? conditionMatch[1] : undefined;
  return { condition, raw: text };
}
