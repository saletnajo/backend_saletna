import type {
  MedusaNextFunction,
  MedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import {
  ContainerRegistrationKeys,
  MedusaError,
} from "@medusajs/framework/utils"

import { COD_PROVIDER_ID } from "../../modules/payment-cod/constants"

/**
 * TASK-017 guard: COD payments must only ever be captured by the dedicated
 * collection path (POST /admin/cod/collect → confirm-cod-collection), which
 * pairs the capture with the cod_order state machine and the ledger payout.
 *
 * @mercurjs/core 2.1.6 ships no auto-capture job and no payout-on-order-event
 * subscriber (verified — its only subscriber is payout-webhook, driven by the
 * Stripe-bound payout.webhook_received event that COD never emits). The only
 * surfaces that can capture a payment by hand are the HTTP routes
 * POST /vendor/payments/:id/capture (Mercur) and
 * POST /admin/payments/:id/capture (Medusa core), and since both ship
 * prebuilt in node_modules they are guarded here, in front of the router,
 * instead of by patching package sources.
 *
 * Non-COD payments pass through untouched, as does an unknown payment id
 * (the underlying route owns the 404).
 */
export async function blockCodManualCapture(
  req: MedusaRequest,
  _res: MedusaResponse,
  next: MedusaNextFunction
) {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  const {
    data: [payment],
  } = await query.graph({
    entity: "payment",
    fields: ["id", "provider_id"],
    filters: { id: req.params.id },
  })

  if (payment?.provider_id === COD_PROVIDER_ID) {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      `Payment ${payment.id} is cash-on-delivery and cannot be captured manually — ` +
        `confirm the cash collection via POST /admin/cod/collect instead`
    )
  }

  return next()
}
