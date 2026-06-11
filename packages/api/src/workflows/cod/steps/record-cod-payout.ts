import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"

import { COD_MODULE } from "../../../modules/cod"
import type CodModuleService from "../../../modules/cod/service"
import { CodPayoutCalculation } from "./calculate-cod-payout"

export const recordCodPayoutStepId = "record-cod-payout"

/**
 * Writes the manual-ledger payout entry (pending_settlement). No payout
 * provider and no Stripe call is involved by construction — settlement
 * happens outside the system and is confirmed later. The unique order_id
 * column rejects a second payout for the same order at the database level.
 */
export const recordCodPayoutStep = createStep(
  recordCodPayoutStepId,
  async (calculation: CodPayoutCalculation, { container }) => {
    const service = container.resolve<CodModuleService>(COD_MODULE)

    const payout = await service.createCodPayouts({
      cod_order_id: calculation.cod_order_id,
      order_id: calculation.order_id,
      seller_id: calculation.seller_id,
      status: "pending_settlement",
      // bigNumber columns accept decimal strings at runtime; the generated
      // types only advertise number.
      amount: calculation.amount as unknown as number,
      currency_code: calculation.currency_code,
      collected_amount: calculation.collected_amount as unknown as number,
      commission_total: calculation.commission_total as unknown as number,
      refunds_total: calculation.refunds_total as unknown as number,
      cod_fee: calculation.cod_fee as unknown as number,
      breakdown: {
        collected_amount: `${calculation.collected_amount}`,
        commission_total: calculation.commission_total,
        refunds_total: calculation.refunds_total,
        cod_fee: `${calculation.cod_fee}`,
        amount: calculation.amount,
      },
    })

    return new StepResponse(payout, payout.id)
  },
  async (payoutId, { container }) => {
    if (!payoutId) {
      return
    }

    const service = container.resolve<CodModuleService>(COD_MODULE)
    await service.deleteCodPayouts(payoutId)
  }
)
