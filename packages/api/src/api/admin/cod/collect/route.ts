import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { confirmCodCollectionWorkflow } from "../../../../workflows/cod/confirm-cod-collection"
import { AdminCodCollectType } from "./validators"

/**
 * POST /admin/cod/collect
 *
 * Confirms cash collection for a COD seller order: captures the (shared)
 * payment, marks the cod_order collected, and triggers the ledger payout via
 * the cod.collected event. Replaying the same idempotency_key is a no-op.
 */
export const POST = async (
  req: AuthenticatedMedusaRequest<AdminCodCollectType>,
  res: MedusaResponse
) => {
  const { order_id, collected_amount, idempotency_key, courier_ref } =
    req.validatedBody

  const { result } = await confirmCodCollectionWorkflow(req.scope).run({
    input: {
      order_id,
      collected_amount,
      idempotency_key,
      courier_ref,
      collected_by: req.auth_context?.actor_id,
    },
  })

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const {
    data: [codOrder],
  } = await query.graph({
    entity: "cod_order",
    fields: ["*"],
    filters: { id: result.cod_order_id },
  })

  res.status(200).json({ cod_order: codOrder, replay: result.replay })
}
