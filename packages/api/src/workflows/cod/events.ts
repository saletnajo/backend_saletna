/**
 * COD domain events. Deliberately namespaced `cod.*` — Mercur's payout module
 * owns the `payout.*` namespace (e.g. payout.webhook_received) and COD must
 * never trigger that Stripe-bound path.
 */
export const CodWorkflowEvents = {
  COLLECTED: "cod.collected",
  FAILED: "cod.failed",
  PAYOUT_RECORDED: "cod.payout_recorded",
} as const
