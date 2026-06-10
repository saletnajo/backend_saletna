import { BigNumberInput } from "@medusajs/framework/types"

/**
 * Options accepted by the COD provider in `medusa-config.ts`. None are
 * required today; the type exists so future options (e.g. a COD fee policy)
 * have one place to land.
 */
export type CodPaymentProviderOptions = Record<string, unknown>

/**
 * Lifecycle of a COD payment session — the subset of Medusa's
 * PaymentSessionStatus values this provider can produce.
 */
export type CodSessionStatus = "pending" | "authorized" | "captured" | "canceled"

/**
 * Audit trail stored in the payment session's `data`. The Payment module owns
 * the authoritative amounts and refund records; these fields exist for the
 * COD collection flows and debugging. `amount` is stored exactly as received
 * to avoid precision loss (JOD has 3 decimals).
 */
export type CodSessionData = {
  session_id: string
  amount: BigNumberInput
  currency_code: string
  status: CodSessionStatus
  authorized_at?: string
  captured_at?: string
  canceled_at?: string
}
