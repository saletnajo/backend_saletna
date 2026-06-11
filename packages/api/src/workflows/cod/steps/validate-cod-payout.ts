import {
  ContainerRegistrationKeys,
  MedusaError,
} from "@medusajs/framework/utils"
import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"

import { COD_MODULE } from "../../../modules/cod"
import type CodModuleService from "../../../modules/cod/service"
import { COD_PROVIDER_ID } from "../../../modules/payment-cod/constants"

export type ValidateCodPayoutInput = {
  order_id: string
  cod_order: { id: string; status: string }
}

export const validateCodPayoutStepId = "validate-cod-payout"

/**
 * A COD payout may only be recorded once, and only after the cash was
 * collected (cod_status=collected) AND the payment was captured. Guards the
 * payout path against premature or duplicate runs no matter who calls it.
 */
export const validateCodPayoutStep = createStep(
  validateCodPayoutStepId,
  async (input: ValidateCodPayoutInput, { container }) => {
    const service = container.resolve<CodModuleService>(COD_MODULE)
    const query = container.resolve(ContainerRegistrationKeys.QUERY)

    if (input.cod_order.status !== "collected") {
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        `COD payout requires cod_status=collected, got "${input.cod_order.status}" for order ${input.order_id}`
      )
    }

    const [existingPayout] = await service.listCodPayouts({
      order_id: input.order_id,
    })
    if (existingPayout) {
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        `A COD payout (${existingPayout.id}) is already recorded for order ${input.order_id}`
      )
    }

    const {
      data: [order],
    } = await query.graph({
      entity: "order",
      fields: [
        "id",
        "payment_collections.payments.provider_id",
        "payment_collections.payments.captured_at",
      ],
      filters: { id: input.order_id },
    })

    const codPayment = (order?.payment_collections ?? [])
      .flatMap((collection) => collection?.payments ?? [])
      .find((payment) => payment?.provider_id === COD_PROVIDER_ID)

    if (!codPayment?.captured_at) {
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        `COD payout requires a captured payment for order ${input.order_id}`
      )
    }

    return new StepResponse(void 0)
  }
)
