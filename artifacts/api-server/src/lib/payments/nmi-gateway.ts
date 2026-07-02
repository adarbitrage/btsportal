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

function assertLiveModeEnabled(): void {
  if (process.env.NMI_LIVE_MODE !== "true") {
    throw new Error("NMI live mode not enabled — refusing to move money");
  }
}

async function nmiPost(params: Record<string, string>): Promise<NmiResult> {
  assertLiveModeEnabled();
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

// ─── Read-only transaction listing (for the refund/chargeback poller) ────────
//
// NMI's query.php also supports listing transactions in a date range via
// `start_date`/`end_date` (format `YYYYMMDDHHMMSS`, UTC). This is used ONLY
// to read what happened — it never charges, refunds, or voids anything.
// Deliberately separate from `queryTransaction` above (which looks up a
// single order's settlement condition) since the shapes are different: this
// returns a list of `<transaction>` nodes, each optionally containing
// `<action>` entries describing what happened to it (sale, refund, void,
// chargeback, ...).

export interface NmiTransactionAction {
  actionType: string;
  amountCents: number | undefined;
  date: string | undefined;
  success: boolean;
}

export interface NmiTransactionRecord {
  transactionId: string;
  orderId: string | undefined;
  condition: string | undefined;
  actions: NmiTransactionAction[];
}

export interface QueryTransactionsByDateRangeParams {
  /** Inclusive start of the window, UTC. */
  startDate: Date;
  /** Exclusive end of the window, UTC. */
  endDate: Date;
}

export interface QueryTransactionsByDateRangeResult {
  transactions: NmiTransactionRecord[];
  raw: string;
}

function formatNmiDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`
  );
}

function extractTag(xml: string, tag: string): string | undefined {
  const match = xml.match(new RegExp(`<${tag}>([^<]*)<\\/${tag}>`));
  return match ? match[1] : undefined;
}

function parseAmountCents(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n)) return undefined;
  return Math.round(n * 100);
}

function parseTransactionsXml(xml: string): NmiTransactionRecord[] {
  const transactions: NmiTransactionRecord[] = [];
  const transactionBlocks = xml.match(/<transaction>[\s\S]*?<\/transaction>/g) ?? [];

  for (const block of transactionBlocks) {
    const transactionId = extractTag(block, "transaction_id");
    if (!transactionId) continue;

    const actionBlocks = block.match(/<action>[\s\S]*?<\/action>/g) ?? [];
    const actions: NmiTransactionAction[] = actionBlocks.map((actionBlock) => ({
      actionType: extractTag(actionBlock, "action_type") ?? "unknown",
      amountCents: parseAmountCents(extractTag(actionBlock, "amount")),
      date: extractTag(actionBlock, "date"),
      success: extractTag(actionBlock, "success") === "1",
    }));

    transactions.push({
      transactionId,
      orderId: extractTag(block, "order_id"),
      condition: extractTag(block, "condition"),
      actions,
    });
  }

  return transactions;
}

/**
 * List transactions in `[startDate, endDate)`. Read-only — used exclusively
 * by the refund/chargeback poller to discover reversals that happened
 * outside our own ops-refund flow (e.g. issued directly in the NMI
 * dashboard). Never mutates gateway state.
 */
export async function queryTransactionsByDateRange(
  params: QueryTransactionsByDateRangeParams,
): Promise<QueryTransactionsByDateRangeResult> {
  const securityKey = getSecurityKey();
  const body = new URLSearchParams({
    security_key: securityKey,
    report_type: "transaction",
    start_date: formatNmiDate(params.startDate),
    end_date: formatNmiDate(params.endDate),
  });

  const res = await fetch(NMI_QUERY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "(no body)");
    throw new Error(`NMI query (date range) HTTP ${res.status}: ${text}`);
  }

  const text = await res.text();
  return { transactions: parseTransactionsXml(text), raw: text };
}
