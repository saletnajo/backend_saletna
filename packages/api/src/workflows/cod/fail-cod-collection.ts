import {
  createWorkflow,
  transform,
  when,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import { cancelOrderWorkflow, emitEventStep } from "@medusajs/medusa/core-flows"

import { CodWorkflowEvents } from "./events"
import { ensureOrderIsCodStep } from "./steps/ensure-order-is-cod"
import { transitionCodStatusStep } from "./steps/transition-cod-status"
import { isCodReplay } from "./utils/idempotency"

export type FailCodCollectionInput = {
  order_id: string
  failure_reason: string
  action: "retry" | "cancel"
  idempotency_key: string
  failed_by?: string
}

export const failCodCollectionWorkflowId = "fail-cod-collection"

/**
 * Records a failed collection attempt (attempts++, failure_reason), then
 * either queues a retry (back to out_for_delivery) or cancels: the cod_order
 * goes terminal and Medusa's cancelOrderWorkflow cancels the order, releases
 * its inventory reservations, and cancels the (still authorized, uncaptured)
 * COD payment. No payout can ever run from these states.
 *
 * The when-blocks are flat siblings (the composer does not support nesting);
 * each condition combines the replay guard with the requested action.
 *
 * Multi-seller caveat: seller orders share one payment, so canceling one
 * order cancels the group's authorized payment. For partially-failed
 * multi-seller groups use retry per order, or cancel all of them.
 */
export const failCodCollectionWorkflow = createWorkflow(
  failCodCollectionWorkflowId,
  (input: FailCodCollectionInput) => {
    const codOrder = ensureOrderIsCodStep({ order_id: input.order_id })

    const replay = transform({ codOrder, input }, ({ codOrder, input }) =>
      isCodReplay(codOrder, input.idempotency_key, "fail")
    )

    when("fail-when-not-replay", { replay }, ({ replay }) => !replay).then(
      () => {
        const failTransition = transform(
          { codOrder, input },
          ({ codOrder, input }) => ({
            cod_order_id: codOrder.id,
            to: "failed" as const,
            update: {
              attempts: (codOrder.attempts ?? 0) + 1,
              failure_reason: input.failure_reason,
              idempotency_key: input.idempotency_key,
            },
          })
        )
        transitionCodStatusStep(failTransition).config({
          name: "cod-fail-transition",
        })

        emitEventStep({
          eventName: CodWorkflowEvents.FAILED,
          data: transform({ codOrder, input }, ({ codOrder, input }) => ({
            cod_order_id: codOrder.id,
            order_id: input.order_id,
            action: input.action,
          })),
        })
      }
    )

    when(
      "fail-action-retry",
      { replay, input },
      ({ replay, input }) => !replay && input.action === "retry"
    ).then(() => {
      const retryTransition = transform({ codOrder }, ({ codOrder }) => ({
        cod_order_id: codOrder.id,
        to: "out_for_delivery" as const,
      }))
      transitionCodStatusStep(retryTransition).config({
        name: "cod-retry-transition",
      })
    })

    when(
      "fail-action-cancel",
      { replay, input },
      ({ replay, input }) => !replay && input.action === "cancel"
    ).then(() => {
      const cancelTransition = transform({ codOrder }, ({ codOrder }) => ({
        cod_order_id: codOrder.id,
        to: "canceled" as const,
      }))
      transitionCodStatusStep(cancelTransition).config({
        name: "cod-cancel-transition",
      })

      cancelOrderWorkflow.runAsStep({
        input: transform({ input }, ({ input }) => ({
          order_id: input.order_id,
          canceled_by: input.failed_by,
        })),
      })
    })

    return new WorkflowResponse(
      transform({ codOrder, replay }, ({ codOrder, replay }) => ({
        cod_order_id: codOrder.id,
        order_id: codOrder.order_id,
        replay,
      }))
    )
  }
)
