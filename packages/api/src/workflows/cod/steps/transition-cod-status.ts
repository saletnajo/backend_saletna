import { MedusaError } from "@medusajs/framework/utils"
import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"

import { COD_MODULE } from "../../../modules/cod"
import type CodModuleService from "../../../modules/cod/service"
import { CodOrderStatus } from "../../../modules/cod/types"

/**
 * Allowed transitions of the COD state machine. `settled` and `canceled` are
 * terminal. `pending → collected` is allowed deliberately: collection can be
 * confirmed before any courier "shipped" event reached us. Anything not
 * listed (including double collect / double settle) throws.
 */
export const COD_STATUS_TRANSITIONS: Record<
  CodOrderStatus,
  readonly CodOrderStatus[]
> = {
  pending: ["out_for_delivery", "collected", "failed", "canceled"],
  out_for_delivery: ["collected", "failed"],
  failed: ["out_for_delivery", "canceled"],
  collected: ["settled"],
  settled: [],
  canceled: [],
}

export function assertCodStatusTransition(
  from: CodOrderStatus,
  to: CodOrderStatus
): void {
  if (!COD_STATUS_TRANSITIONS[from]?.includes(to)) {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      `Invalid COD status transition: ${from} → ${to}`
    )
  }
}

export type TransitionCodStatusInput = {
  cod_order_id: string
  to: CodOrderStatus
  /**
   * Extra cod_order fields persisted together with the status change
   * (collected_amount, failure_reason, timestamps, ...).
   */
  update?: Record<string, unknown>
}

export const transitionCodStatusStepId = "transition-cod-status"

export const transitionCodStatusStep = createStep(
  transitionCodStatusStepId,
  async (input: TransitionCodStatusInput, { container }) => {
    const service = container.resolve<CodModuleService>(COD_MODULE)

    const current = await service.retrieveCodOrder(input.cod_order_id)
    assertCodStatusTransition(current.status as CodOrderStatus, input.to)

    const update = input.update ?? {}
    const [updated] = await service.updateCodOrders([
      { id: current.id, status: input.to, ...update },
    ])

    const previous: Record<string, unknown> = { status: current.status }
    for (const key of Object.keys(update)) {
      previous[key] = (current as Record<string, unknown>)[key] ?? null
    }

    return new StepResponse(updated, { id: current.id, previous })
  },
  async (compensation, { container }) => {
    if (!compensation) {
      return
    }

    const service = container.resolve<CodModuleService>(COD_MODULE)
    await service.updateCodOrders([
      { id: compensation.id, ...compensation.previous },
    ])
  }
)
