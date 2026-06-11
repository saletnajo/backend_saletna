import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { COD_MODULE } from "../modules/cod"
import type CodModuleService from "../modules/cod/service"
import {
  getStaleCollectionCutoff,
  hoursSince,
  resolveStaleCollectionHours,
} from "../workflows/cod/utils/stale-collection"

/**
 * Hourly watchdog for cash stuck in transit: a COD order that has been
 * out_for_delivery longer than COD_STALE_COLLECTION_HOURS (default 72) with
 * no collect/fail event means the courier never reported back — ops should
 * chase the courier or fail the collection manually. Warn-only: the job
 * never mutates state.
 */
export default async function codStaleCollectionJob(
  container: MedusaContainer
) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const codService = container.resolve<CodModuleService>(COD_MODULE)

  const now = new Date()
  const hours = resolveStaleCollectionHours(
    process.env.COD_STALE_COLLECTION_HOURS
  )
  const cutoff = getStaleCollectionCutoff(now, hours)

  const staleOrders = await codService.listCodOrders(
    {
      status: "out_for_delivery",
      updated_at: { $lt: cutoff },
    },
    { order: { updated_at: "ASC" } }
  )

  if (!staleOrders.length) {
    logger.info(
      `[cod-stale-collection] no COD orders out_for_delivery older than ${hours}h`
    )
    return
  }

  for (const codOrder of staleOrders) {
    logger.warn(
      `[cod-stale-collection] COD order ${codOrder.id} ` +
        `(order ${codOrder.order_id}) has been out_for_delivery for ` +
        `${hoursSince(codOrder.updated_at, now)}h ` +
        `(courier_ref=${codOrder.courier_ref ?? "none"}, ` +
        `expected_amount=${codOrder.expected_amount} ${codOrder.currency_code}). ` +
        `Chase the courier, then confirm or fail the collection.`
    )
  }

  logger.warn(
    `[cod-stale-collection] ${staleOrders.length} COD order(s) stuck in ` +
      `out_for_delivery beyond ${hours}h`
  )
}

export const config = {
  name: "cod-stale-collection",
  schedule: "0 * * * *",
}
