import {
  chargeWithToken,
  chargeWithVault,
  createVaultFromToken,
  deleteVaultCustomer,
  refund,
  voidTransaction,
  queryTransaction,
  getTokenizationKey,
  type NmiResult,
  type CreateVaultResult,
  type QueryTransactionResult,
  type ChargeWithTokenParams,
  type ChargeWithVaultParams,
  type CreateVaultFromTokenParams,
  type DeleteVaultParams,
  type RefundParams,
  type VoidParams,
  type QueryTransactionParams,
} from "./nmi-gateway.js";

export type {
  NmiResult,
  CreateVaultResult,
  QueryTransactionResult,
  ChargeWithTokenParams,
  ChargeWithVaultParams,
  CreateVaultFromTokenParams,
  DeleteVaultParams,
  RefundParams,
  VoidParams,
  QueryTransactionParams,
};

export async function chargeCardToken(params: ChargeWithTokenParams): Promise<NmiResult> {
  return chargeWithToken(params);
}

export async function chargeStoredVault(params: ChargeWithVaultParams): Promise<NmiResult> {
  return chargeWithVault(params);
}

export async function storeCardToken(
  params: CreateVaultFromTokenParams,
): Promise<CreateVaultResult> {
  return createVaultFromToken(params);
}

export async function refundCharge(params: RefundParams): Promise<NmiResult> {
  return refund(params);
}

export async function voidCharge(params: VoidParams): Promise<NmiResult> {
  return voidTransaction(params);
}

export async function getTransactionStatus(
  params: QueryTransactionParams,
): Promise<QueryTransactionResult> {
  return queryTransaction(params);
}

export async function removeVaultCustomer(params: DeleteVaultParams): Promise<NmiResult> {
  return deleteVaultCustomer(params);
}

export function getPublicTokenizationKey(): string | undefined {
  return getTokenizationKey();
}
