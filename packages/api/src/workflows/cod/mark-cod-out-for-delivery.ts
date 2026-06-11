import {
  createWorkflow,
  transform,
  when,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"

import { ensureOrderIsCodStep } from "./steps/ensure-order-is-cod"
import { transitionCodStatusStep } from "./steps/transition-cod-status"

export type MarkCodOutForDeliveryInput = {
  order_id: string
}

export const markCodOutForDeliveryWorkflowId = "mark-cod-out-for-delivery"

/**
 * Shipment-driven transition pending → out_for_delivery. Deliberately
 * tolerant: shipment events can fire more than once per order (multiple
 * fulfillments, retries), so any status other than pending is a no-op
 * instead of a state machine error — collection may even have been confirmed
 * before the shipment event reached us (pending → collected is legal).
 */
export const markCodOutForDeliveryWorkflow = createWorkflow(
  markCodOutForDeliveryWorkflowId,
  (input: MarkCodOutForDeliveryInput) => {
    const codOrder = ensureOrderIsCodStep({ order_id: input.order_id })

    const shouldTransition = transform(
      { codOrder },
      ({ codOrder }) => codOrder.status === "pending"
    )

    when(
      "ofd-when-pending",
      { shouldTransition },
      ({ shouldTransition }) => shouldTransition
    ).then(() => {
      const transitionInput = transform({ codOrder }, ({ codOrder }) => ({
        cod_order_id: codOrder.id,
        to: "out_for_delivery" as const,
      }))
      transitionCodStatusStep(transitionInput)
    })

    return new WorkflowResponse(
      transform(
        { codOrder, shouldTransition },
        ({ codOrder, shouldTransition }) => ({
          cod_order_id: codOrder.id,
          order_id: codOrder.order_id,
          transitioned: shouldTransition,
        })
      )
    )
  }
)
