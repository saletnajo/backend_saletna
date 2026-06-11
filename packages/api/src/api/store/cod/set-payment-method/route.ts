import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import {
  createPaymentCollectionForCartWorkflow,
  createPaymentSessionsWorkflow,
} from "@medusajs/medusa/core-flows"

import { COD_PROVIDER_ID } from "../../../../modules/payment-cod/constants"
import { assertCartEligibleForCod } from "../../../../workflows/cod/utils/eligibility"
import { StoreSetCodPaymentMethodType } from "./validators"

/**
 * POST /store/cod/set-payment-method
 *
 * Validates COD eligibility for the cart, ensures it has a payment
 * collection, and initializes a payment session on the COD provider. The
 * session authorizes without capturing at completion; capture happens when
 * cash collection is confirmed.
 */
export const POST = async (
  req: AuthenticatedMedusaRequest<StoreSetCodPaymentMethodType>,
  res: MedusaResponse
) => {
  const { cart_id } = req.validatedBody

  const { cart } = await assertCartEligibleForCod(req.scope, cart_id)

  let paymentCollectionId: string | undefined = cart.payment_collection?.id
  if (!paymentCollectionId) {
    await createPaymentCollectionForCartWorkflow(req.scope).run({
      input: { cart_id },
    })

    const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
    const {
      data: [refreshed],
    } = await query.graph({
      entity: "cart",
      fields: ["id", "payment_collection.id"],
      filters: { id: cart_id },
    })
    paymentCollectionId = refreshed?.payment_collection?.id
  }

  const { result: paymentSession } = await createPaymentSessionsWorkflow(
    req.scope
  ).run({
    input: {
      payment_collection_id: paymentCollectionId!,
      provider_id: COD_PROVIDER_ID,
      customer_id: cart.customer_id ?? undefined,
      data: {},
    },
  })

  res.status(200).json({
    cart_id,
    payment_collection_id: paymentCollectionId,
    payment_session: {
      id: paymentSession.id,
      provider_id: paymentSession.provider_id,
      status: paymentSession.status,
    },
    cod: {
      provider_id: COD_PROVIDER_ID,
      expected_amount: cart.total,
      currency_code: cart.currency_code,
    },
  })
}
