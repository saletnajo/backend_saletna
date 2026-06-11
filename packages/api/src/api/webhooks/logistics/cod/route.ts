import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  ContainerRegistrationKeys,
  MedusaError,
} from "@medusajs/framework/utils"

import { confirmCodCollectionWorkflow } from "../../../../workflows/cod/confirm-cod-collection"
import { failCodCollectionWorkflow } from "../../../../workflows/cod/fail-cod-collection"
import { buildLogisticsIdempotencyKey } from "../utils"
import { LogisticsCodWebhookType } from "./validators"

const WEBHOOK_ACTOR = "webhook:logistics"

/**
 * Statuses a webhook event can permanently fail with (wrong state, unknown
 * or non-COD order). These are acknowledged with 200 { accepted: false } and
 * a logged warning — couriers retry non-2xx responses, and retrying an event
 * the state machine already rejected can never succeed. Transient errors
 * still bubble to a 5xx so the courier retries them.
 */
const NON_RETRYABLE_ERROR_TYPES: string[] = [
  MedusaError.Types.NOT_ALLOWED,
  MedusaError.Types.NOT_FOUND,
  MedusaError.Types.INVALID_DATA,
]

/**
 * POST /webhooks/logistics/cod
 *
 * Courier delivery updates for COD orders. Authenticated by HMAC signature
 * (see requireLogisticsSignature in src/api/middlewares.ts), idempotent per
 * courier event via `logistics:{courier_ref}:{event_id}` — a re-delivered
 * event replays as a no-op, a new event for the same shipment is processed.
 *
 * type=collected → confirm-cod-collection (capture + ledger payout chain)
 * type=failed    → fail-cod-collection (attempts++, retry or cancel)
 */
export const POST = async (
  req: MedusaRequest<LogisticsCodWebhookType>,
  res: MedusaResponse
) => {
  const payload = req.validatedBody
  const idempotency_key = buildLogisticsIdempotencyKey(
    payload.courier_ref,
    payload.event_id
  )

  try {
    if (payload.type === "collected") {
      const { result } = await confirmCodCollectionWorkflow(req.scope).run({
        input: {
          order_id: payload.order_id,
          collected_amount: payload.collected_amount!,
          idempotency_key,
          collected_by: WEBHOOK_ACTOR,
          courier_ref: payload.courier_ref,
        },
      })

      res.status(200).json({
        accepted: true,
        replay: result.replay,
        cod_order_id: result.cod_order_id,
      })
      return
    }

    const { result } = await failCodCollectionWorkflow(req.scope).run({
      input: {
        order_id: payload.order_id,
        failure_reason: payload.failure_reason!,
        action: payload.action ?? "retry",
        idempotency_key,
        failed_by: WEBHOOK_ACTOR,
      },
    })

    res.status(200).json({
      accepted: true,
      replay: result.replay,
      cod_order_id: result.cod_order_id,
    })
  } catch (error) {
    const type = (error as { type?: string })?.type
    if (type && NON_RETRYABLE_ERROR_TYPES.includes(type)) {
      const logger = req.scope.resolve(ContainerRegistrationKeys.LOGGER)
      logger.warn(
        `Logistics COD webhook event ${payload.event_id} (${payload.type}) ` +
          `not applied to ${payload.order_id}: ${(error as Error).message}`
      )
      res.status(200).json({
        accepted: false,
        reason: (error as Error).message,
      })
      return
    }

    throw error
  }
}
