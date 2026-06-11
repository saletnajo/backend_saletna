import { MathBN } from "@medusajs/framework/utils"

export type CodPayoutMathInput = {
  /** Cash actually collected for the seller order. */
  collected_amount: string | number
  /** Sum of the order's commission lines. */
  commission_total: string | number
  /** Sum of refunds already given back to the customer (positive number). */
  refunds_total: string | number
  /** COD fee charged to the vendor; 0 when another party bears it. */
  cod_fee: string | number
}

/**
 * payout = collected − commission − refunds − cod_fee, computed with MathBN
 * so JOD's 3 decimals stay exact. The result is returned as a decimal string
 * and is NOT clamped: a negative payout is a real signal (refunds exceeding
 * collection) that settlement must surface, not hide.
 */
export function computeCodPayoutAmount(input: CodPayoutMathInput): string {
  return MathBN.sub(
    input.collected_amount,
    input.commission_total,
    input.refunds_total,
    input.cod_fee
  ).toString()
}

/**
 * Graph/service money values arrive as numbers, decimal strings, or raw
 * BigNumber objects ({ value, precision }); normalize to the scalar.
 */
export function asMoneyValue(value: unknown, fallback: string = "0"): string | number {
  if (value === null || value === undefined) {
    return fallback
  }
  if (typeof value === "object" && "value" in (value as object)) {
    return (value as { value: string | number }).value
  }
  return value as string | number
}
