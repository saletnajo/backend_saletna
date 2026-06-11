import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { failCodCollectionWorkflow } from "../../../../workflows/cod/fail-cod-collection"
import { AdminCodFailType } from "./validators"

/**
 * POST /admin/cod/fail
 *
 * Records a failed collection attempt. action=retry sends the record back
 * out for delivery; action=cancel terminates it and cancels the order
 * (releasing reservations and the authorized payment). No payout can result.
 */
export const POST = async (
  req: AuthenticatedMedusaRequest<AdminCodFailType>,
  res: MedusaResponse
) => {
  const { order_id, failure_reason, action, idempotency_key } =
    req.validatedBody

  const { result } = await failCodCollectionWorkflow(req.scope).run({
    input: {
      order_id,
      failure_reason,
      action,
      idempotency_key,
      failed_by: req.auth_context?.actor_id,
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
