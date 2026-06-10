import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { updateRegionsWorkflow } from "@medusajs/medusa/core-flows"

import { COD_PROVIDER_ID } from "../modules/payment-cod/constants"

/**
 * Enables the COD payment provider on target regions (idempotent).
 *
 * Targets the regions listed in COD_ALLOWED_REGION_IDS (comma-separated
 * region ids); when unset, falls back to every region whose currency is JOD.
 *
 * Run from packages/api:
 *   npx medusa exec ./src/scripts/enable-cod.ts
 */
export default async function enableCod({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)

  const allowedIds = (process.env.COD_ALLOWED_REGION_IDS ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean)

  const { data: regions } = await query.graph({
    entity: "region",
    fields: ["id", "name", "currency_code", "payment_providers.id"],
    ...(allowedIds.length ? { filters: { id: allowedIds } } : {}),
  })

  const targets = allowedIds.length
    ? regions
    : regions.filter((region) => region.currency_code === "jod")

  if (!targets.length) {
    logger.warn(
      "enable-cod: no target regions found — set COD_ALLOWED_REGION_IDS or create a JOD region first."
    )
    return
  }

  for (const region of targets) {
    const providerIds = (region.payment_providers ?? [])
      .filter(Boolean)
      .map((provider) => provider!.id)

    if (providerIds.includes(COD_PROVIDER_ID)) {
      logger.info(
        `enable-cod: ${COD_PROVIDER_ID} already enabled on ${region.name} (${region.id})`
      )
      continue
    }

    await updateRegionsWorkflow(container).run({
      input: {
        selector: { id: region.id },
        update: { payment_providers: [...providerIds, COD_PROVIDER_ID] },
      },
    })

    logger.info(
      `enable-cod: enabled ${COD_PROVIDER_ID} on ${region.name} (${region.id})`
    )
  }
}
