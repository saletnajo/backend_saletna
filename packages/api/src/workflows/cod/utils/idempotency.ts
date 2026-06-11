import { CodOrderStatus } from "../../../modules/cod/types"

const REPLAY_STATUSES: Record<
  "collect" | "fail" | "settle",
  readonly CodOrderStatus[]
> = {
  collect: ["collected", "settled"],
  fail: ["failed", "out_for_delivery", "canceled"],
  settle: ["settled"],
}

/**
 * A mutation is a replay (safe no-op) when the caller resends the same
 * idempotency key AND the record already sits in a state that operation
 * produces. A different key against an already-mutated record falls through
 * to the state machine, which rejects the illegal transition.
 */
export function isCodReplay(
  codOrder: { status: string; idempotency_key?: string | null },
  idempotencyKey: string | undefined | null,
  operation: "collect" | "fail" | "settle"
): boolean {
  if (!idempotencyKey || codOrder.idempotency_key !== idempotencyKey) {
    return false
  }

  return REPLAY_STATUSES[operation].includes(codOrder.status as CodOrderStatus)
}
