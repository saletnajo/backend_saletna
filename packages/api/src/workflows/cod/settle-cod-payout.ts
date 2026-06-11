import {
  createWorkflow,
  transform,
  when,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import { emitEventStep } from "@medusajs/medusa/core-flows"

import { CodWorkflowEvents } from "./events"
import { ensureOrderIsCodStep } from "./steps/ensure-order-is-cod"
import { markCodPayoutSettledStep } from "./steps/mark-cod-payout-settled"
import { transitionCodStatusStep } from "./steps/transition-cod-status"
import { isCodReplay } from "./utils/idempotency"

export type SettleCodPayoutInput = {
  order_id: string
  settlement_ref: string
  idempotency_key: string
}

export const settleCodPayoutWorkflowId = "settle-cod-payout"

/**
 * Confirms that the seller was paid outside the system (bank transfer / CliQ /
 * cash): marks the ledger entry settled with the external settlement_ref, then
 * transitions the cod_order collected → settled and emits cod.settled.
 *
 * The payout step runs first as the fail-fast guard: the ledger entry only
 * exists once collection was confirmed, so settling an uncollected order dies
 * there before any state is touched. If the cod_order transition then fails,
 * the step's compensation restores the ledger entry.
 *
 * Replaying the same idempotency_key against a settled record is a no-op; a
 * different key is rejected by the state machine (settled is terminal).
 */
export const settleCodPayoutWorkflow = createWorkflow(
  settleCodPayoutWorkflowId,
  (input: SettleCodPayoutInput) => {
    const codOrder = ensureOrderIsCodStep({ order_id: input.order_id })

    const replay = transform({ codOrder, input }, ({ codOrder, input }) =>
      isCodReplay(codOrder, input.idempotency_key, "settle")
    )

    when("settle-when-not-replay", { replay }, ({ replay }) => !replay).then(
      () => {
        const payoutInput = transform(
          { codOrder, input },
          ({ codOrder, input }) => ({
            cod_order_id: codOrder.id,
            settlement_ref: input.settlement_ref,
          })
        )
        markCodPayoutSettledStep(payoutInput)

        const transitionInput = transform(
          { codOrder, input },
          ({ codOrder, input }) => ({
            cod_order_id: codOrder.id,
            to: "settled" as const,
            update: {
              settled_at: new Date(),
              idempotency_key: input.idempotency_key,
            },
          })
        )
        transitionCodStatusStep(transitionInput)

        emitEventStep({
          eventName: CodWorkflowEvents.SETTLED,
          data: transform({ codOrder, input }, ({ codOrder, input }) => ({
            cod_order_id: codOrder.id,
            order_id: input.order_id,
            settlement_ref: input.settlement_ref,
          })),
        })
      }
    )

    return new WorkflowResponse(
      transform({ codOrder, replay }, ({ codOrder, replay }) => ({
        cod_order_id: codOrder.id,
        order_id: codOrder.order_id,
        replay,
      }))
    )
  }
)
