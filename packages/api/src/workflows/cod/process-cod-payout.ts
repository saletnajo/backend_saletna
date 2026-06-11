import {
  createWorkflow,
  transform,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import { emitEventStep } from "@medusajs/medusa/core-flows"

import { CodWorkflowEvents } from "./events"
import { calculateCodPayoutStep } from "./steps/calculate-cod-payout"
import { ensureOrderIsCodStep } from "./steps/ensure-order-is-cod"
import { recordCodPayoutStep } from "./steps/record-cod-payout"
import { validateCodPayoutStep } from "./steps/validate-cod-payout"

export const processCodPayoutWorkflowId = "process-cod-payout"

/**
 * COD counterpart of a payout flow, as a manual ledger: validates the order
 * is COD, collected, captured, and not yet paid out — then calculates
 * (collected − commission − refunds − cod_fee) and records the
 * pending_settlement ledger entry. Never touches Mercur's payout module or
 * any payment gateway.
 */
export const processCodPayoutWorkflow = createWorkflow(
  processCodPayoutWorkflowId,
  (input: { order_id: string }) => {
    const codOrder = ensureOrderIsCodStep({ order_id: input.order_id })

    const validationInput = transform(
      { input, codOrder },
      ({ input, codOrder }) => ({
        order_id: input.order_id,
        cod_order: { id: codOrder.id, status: codOrder.status as string },
      })
    )
    validateCodPayoutStep(validationInput)

    const calculationInput = transform(
      { input, codOrder },
      ({ input, codOrder }) => ({
        order_id: input.order_id,
        cod_order: {
          id: codOrder.id,
          expected_amount: codOrder.expected_amount,
          collected_amount: codOrder.collected_amount,
          cod_fee: codOrder.cod_fee,
          currency_code: codOrder.currency_code,
        },
      })
    )
    const calculation = calculateCodPayoutStep(calculationInput)

    const payout = recordCodPayoutStep(calculation)

    emitEventStep({
      eventName: CodWorkflowEvents.PAYOUT_RECORDED,
      data: transform({ payout, input }, ({ payout, input }) => ({
        id: payout.id,
        order_id: input.order_id,
      })),
    })

    return new WorkflowResponse(payout)
  }
)
