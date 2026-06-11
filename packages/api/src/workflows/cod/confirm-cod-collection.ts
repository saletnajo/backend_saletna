import {
  createWorkflow,
  transform,
  when,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import { emitEventStep } from "@medusajs/medusa/core-flows"

import { CodWorkflowEvents } from "./events"
import { captureCodPaymentStep } from "./steps/capture-cod-payment"
import { ensureOrderIsCodStep } from "./steps/ensure-order-is-cod"
import { transitionCodStatusStep } from "./steps/transition-cod-status"
import { isCodReplay } from "./utils/idempotency"

export type ConfirmCodCollectionInput = {
  order_id: string
  collected_amount: string | number
  idempotency_key: string
  collected_by?: string
  courier_ref?: string
}

export const confirmCodCollectionWorkflowId = "confirm-cod-collection"

/**
 * Confirms cash collection for a COD (seller) order: captures the shared
 * group payment (idempotent — first confirmation captures for the whole
 * group), transitions the cod_order to collected with the collection audit
 * fields, and emits cod.collected. The payout is NOT run inline: capturing
 * cash is irreversible, so a payout failure must never compensate the
 * collection — the cod.collected subscriber runs process-cod-payout, which
 * is independently retryable and double-payout-safe.
 *
 * Replaying the same idempotency_key is a no-op; a different key against an
 * already-collected record is rejected by the state machine.
 */
export const confirmCodCollectionWorkflow = createWorkflow(
  confirmCodCollectionWorkflowId,
  (input: ConfirmCodCollectionInput) => {
    const codOrder = ensureOrderIsCodStep({ order_id: input.order_id })

    const replay = transform({ codOrder, input }, ({ codOrder, input }) =>
      isCodReplay(codOrder, input.idempotency_key, "collect")
    )

    when("confirm-when-not-replay", { replay }, ({ replay }) => !replay).then(
      () => {
        captureCodPaymentStep({
          order_id: input.order_id,
          captured_by: input.collected_by,
        })

        const transitionInput = transform(
          { codOrder, input },
          ({ codOrder, input }) => ({
            cod_order_id: codOrder.id,
            to: "collected" as const,
            update: {
              collected_amount: input.collected_amount,
              collected_at: new Date(),
              collected_by: input.collected_by ?? null,
              courier_ref: input.courier_ref ?? null,
              idempotency_key: input.idempotency_key,
            },
          })
        )
        transitionCodStatusStep(transitionInput)

        emitEventStep({
          eventName: CodWorkflowEvents.COLLECTED,
          data: transform({ codOrder, input }, ({ codOrder, input }) => ({
            cod_order_id: codOrder.id,
            order_id: input.order_id,
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
