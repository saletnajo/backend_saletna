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
