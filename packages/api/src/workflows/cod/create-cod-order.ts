import { createWorkflow, WorkflowResponse } from "@medusajs/framework/workflows-sdk"

import { createCodOrderRecordStep } from "./steps/create-cod-order-record"

export const createCodOrderWorkflowId = "create-cod-order"

/**
 * Runs for every placed (seller) order: when the order was paid with the COD
 * provider, creates its pending cod_order record and links it to the order.
 * No-ops (returns null) for non-COD orders, so it can be subscribed to
 * order.placed blindly.
 */
export const createCodOrderWorkflow = createWorkflow(
  createCodOrderWorkflowId,
  (input: { order_id: string }) => {
    const codOrder = createCodOrderRecordStep(input)

    return new WorkflowResponse(codOrder)
  }
)
