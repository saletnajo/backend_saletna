/**
 * Lifecycle states of a COD order record. Terminal states: settled, canceled.
 */
export const COD_ORDER_STATUSES = [
  "pending",
  "out_for_delivery",
  "collected",
  "failed",
  "canceled",
  "settled",
] as const

export type CodOrderStatus = (typeof COD_ORDER_STATUSES)[number]

/**
 * Lifecycle of a manual-ledger COD payout entry: recorded as
 * pending_settlement when collection is confirmed, settled once the seller is
 * actually paid outside the system (bank transfer / CliQ / cash).
 */
export const COD_PAYOUT_STATUSES = ["pending_settlement", "settled"] as const

export type CodPayoutStatus = (typeof COD_PAYOUT_STATUSES)[number]
