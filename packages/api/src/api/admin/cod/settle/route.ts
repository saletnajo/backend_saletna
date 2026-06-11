import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { settleCodPayoutWorkflow } from "../../../../workflows/cod/settle-cod-payout"
import { AdminCodSettleType } from "./validators"

/**
 * POST /admin/cod/settle
 *
 * Confirms the external seller payment (bank transfer / CliQ / cash) for a
 * collected COD order: marks the cod_payout ledger entry settled with the
 * settlement_ref and transitions the cod_order to settled. Replaying the same
 * idempotency_key is a no-op.
 */
export const POST = async (
  req: AuthenticatedMedusaRequest<AdminCodSettleType>,
  res: MedusaResponse
) => {
  const { order_id, settlement_ref, idempotency_key } = req.validatedBody

  const { result } = await settleCodPayoutWorkflow(req.scope).run({
    input: { order_id, settlement_ref, idempotency_key },
  })

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const {
    data: [codOrder],
  } = await query.graph({
    entity: "cod_order",
    fields: ["*"],
    filters: { id: result.cod_order_id },
  })
  const {
    data: [codPayout],
  } = await query.graph({
    entity: "cod_payout",
    fields: ["*"],
    filters: { cod_order_id: result.cod_order_id },
  })

  res
    .status(200)
    .json({ cod_order: codOrder, cod_payout: codPayout, replay: result.replay })
}
