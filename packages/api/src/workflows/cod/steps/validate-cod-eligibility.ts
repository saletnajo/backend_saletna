import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"

import { assertCartEligibleForCod } from "../utils/eligibility"

export const validateCodEligibilityStepId = "validate-cod-eligibility"

/**
 * Throws INVALID_DATA with the failing rule's reason when the cart cannot use
 * COD. All rules are env-configurable — see loadCodEligibilityConfig.
 */
export const validateCodEligibilityStep = createStep(
  validateCodEligibilityStepId,
  async (input: { cart_id: string }, { container }) => {
    const { cart } = await assertCartEligibleForCod(container, input.cart_id)
    return new StepResponse(cart)
  }
)
