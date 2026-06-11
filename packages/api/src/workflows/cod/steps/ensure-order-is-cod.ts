import { MedusaError } from "@medusajs/framework/utils"
import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"

import { COD_MODULE } from "../../../modules/cod"
import type CodModuleService from "../../../modules/cod/service"

export const ensureOrderIsCodStepId = "ensure-order-is-cod"

/**
 * Guard used by every COD mutation (collect/fail/payout): resolves the
 * cod_order record for the given order and throws when the order is not a
 * cash-on-delivery order.
 */
export const ensureOrderIsCodStep = createStep(
  ensureOrderIsCodStepId,
  async (input: { order_id: string }, { container }) => {
    const service = container.resolve<CodModuleService>(COD_MODULE)

    const [codOrder] = await service.listCodOrders({
      order_id: input.order_id,
    })

    if (!codOrder) {
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        `Order ${input.order_id} is not a cash-on-delivery order`
      )
    }

    return new StepResponse(codOrder)
  }
)
