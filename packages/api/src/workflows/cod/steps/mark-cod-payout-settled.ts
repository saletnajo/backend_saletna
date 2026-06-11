import { MedusaError } from "@medusajs/framework/utils"
import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"

import { COD_MODULE } from "../../../modules/cod"
import type CodModuleService from "../../../modules/cod/service"

export type MarkCodPayoutSettledInput = {
  cod_order_id: string
  settlement_ref: string
}

export const markCodPayoutSettledStepId = "mark-cod-payout-settled"

/**
 * Flips the ledger entry pending_settlement → settled after the operator paid
 * the seller outside the system (bank transfer / CliQ / cash) and recorded the
 * external reference. Settlement is purely a ledger update — no payment
 * provider and no Stripe call, by construction.
 */
export const markCodPayoutSettledStep = createStep(
  markCodPayoutSettledStepId,
  async (input: MarkCodPayoutSettledInput, { container }) => {
    const service = container.resolve<CodModuleService>(COD_MODULE)

    const [payout] = await service.listCodPayouts({
      cod_order_id: input.cod_order_id,
    })

    if (!payout) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `No payout ledger entry exists for COD order ${input.cod_order_id} — ` +
          `collection must be confirmed (and the cod.collected payout recorded) before settling`
      )
    }

    if (payout.status !== "pending_settlement") {
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        `COD payout ${payout.id} is ${payout.status}, not pending_settlement`
      )
    }

    const settled_at = new Date()
    const [updated] = await service.updateCodPayouts([
      {
        id: payout.id,
        status: "settled",
        settlement_ref: input.settlement_ref,
        settled_at,
      },
    ])

    return new StepResponse(updated, {
      id: payout.id,
      previous: {
        status: payout.status,
        settlement_ref: payout.settlement_ref ?? null,
        settled_at: payout.settled_at ?? null,
      },
    })
  },
  async (compensation, { container }) => {
    if (!compensation) {
      return
    }

    const service = container.resolve<CodModuleService>(COD_MODULE)
    await service.updateCodPayouts([
      { id: compensation.id, ...compensation.previous },
    ])
  }
)
