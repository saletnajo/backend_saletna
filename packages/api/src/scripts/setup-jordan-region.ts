import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import {
  createWorkflow,
  transform,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import {
  createRegionsWorkflow,
  createTaxRegionsWorkflow,
  updateRegionsWorkflow,
  updateStoresStep,
} from "@medusajs/medusa/core-flows"

import { COD_PROVIDER_ID } from "../modules/payment-cod/constants"

const JORDAN = {
  name: "Jordan",
  country_code: "jo",
  currency_code: "jod",
} as const

// Same shape as the seed's update-store-currencies workflow, under a distinct
// name so both can register in one process.
const ensureStoreCurrencies = createWorkflow(
  "ensure-store-currencies",
  (input: {
    store_id: string
    supported_currencies: { currency_code: string; is_default?: boolean }[]
  }) => {
    const normalizedInput = transform({ input }, (data) => {
      return {
        selector: { id: data.input.store_id },
        update: {
          supported_currencies: data.input.supported_currencies.map(
            (currency) => {
              return {
                currency_code: currency.currency_code,
                is_default: currency.is_default ?? false,
              }
            }
          ),
        },
      }
    })

    const stores = updateStoresStep(normalizedInput)

    return new WorkflowResponse(stores)
  }
)

/**
 * Sets up the Jordan market for COD (idempotent):
 * - adds JOD to the store's supported currencies (existing default unchanged)
 * - creates a Jordan region (country jo, currency jod) with COD enabled, or
 *   appends pp_cod to the region that already owns country jo
 * - creates the jo tax region when missing
 *
 * Run from packages/api:
 *   node_modules/.bin/medusa exec ./src/scripts/setup-jordan-region.ts
 */
export default async function setupJordanRegion({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const storeModuleService = container.resolve(Modules.STORE)
  const regionModuleService = container.resolve(Modules.REGION)
  const taxModuleService = container.resolve(Modules.TAX)

  // JOD as a supported store currency. Its 3-decimal precision comes from
  // Medusa's ISO 4217 currency data; log it so the run records the check.
  const [store] = await storeModuleService.listStores(
    {},
    { relations: ["supported_currencies"] }
  )
  const supported = store.supported_currencies ?? []

  if (supported.some((c) => c.currency_code === JORDAN.currency_code)) {
    logger.info("setup-jordan: JOD already a supported store currency")
  } else {
    await ensureStoreCurrencies(container).run({
      input: {
        store_id: store.id,
        supported_currencies: [
          ...supported.map((c) => ({
            currency_code: c.currency_code,
            is_default: c.is_default,
          })),
          { currency_code: JORDAN.currency_code },
        ],
      },
    })
    logger.info("setup-jordan: added JOD to the store's supported currencies")
  }

  const { data: jodCurrency } = await query.graph({
    entity: "currency",
    fields: ["code", "decimal_digits"],
    filters: { code: JORDAN.currency_code },
  })
  logger.info(
    `setup-jordan: JOD decimal_digits=${jodCurrency[0]?.decimal_digits}`
  )

  // Jordan region with COD enabled. A country can only belong to one region,
  // so reuse the region that already owns "jo" when present.
  const regions = await regionModuleService.listRegions(
    {},
    { relations: ["countries"] }
  )
  const existing = regions.find((region) =>
    region.countries?.some((country) => country.iso_2 === JORDAN.country_code)
  )

  let regionId: string
  if (!existing) {
    const { result } = await createRegionsWorkflow(container).run({
      input: {
        regions: [
          {
            name: JORDAN.name,
            currency_code: JORDAN.currency_code,
            countries: [JORDAN.country_code],
            payment_providers: [COD_PROVIDER_ID, "pp_system_default"],
          },
        ],
      },
    })
    regionId = result[0].id
    logger.info(
      `setup-jordan: created region ${JORDAN.name} (${regionId}) with ${COD_PROVIDER_ID}`
    )
  } else {
    regionId = existing.id
    if (existing.currency_code !== JORDAN.currency_code) {
      logger.warn(
        `setup-jordan: country jo already belongs to region ${existing.name} (${existing.id}) with currency ${existing.currency_code} — leaving the region untouched, only ensuring COD`
      )
    }

    const {
      data: [regionWithProviders],
    } = await query.graph({
      entity: "region",
      fields: ["id", "payment_providers.id"],
      filters: { id: existing.id },
    })
    const providerIds = (regionWithProviders?.payment_providers ?? [])
      .filter(Boolean)
      .map((provider) => provider!.id)

    if (providerIds.includes(COD_PROVIDER_ID)) {
      logger.info(
        `setup-jordan: ${COD_PROVIDER_ID} already enabled on ${existing.name} (${existing.id})`
      )
    } else {
      await updateRegionsWorkflow(container).run({
        input: {
          selector: { id: existing.id },
          update: { payment_providers: [...providerIds, COD_PROVIDER_ID] },
        },
      })
      logger.info(
        `setup-jordan: enabled ${COD_PROVIDER_ID} on ${existing.name} (${existing.id})`
      )
    }
  }

  // Tax region for jo, mirroring the seed's tp_system setup.
  const taxRegions = await taxModuleService.listTaxRegions()
  if (taxRegions.some((tr) => tr.country_code === JORDAN.country_code)) {
    logger.info("setup-jordan: jo tax region already exists")
  } else {
    await createTaxRegionsWorkflow(container).run({
      input: [
        { country_code: JORDAN.country_code, provider_id: "tp_system" },
      ],
    })
    logger.info("setup-jordan: created jo tax region")
  }

  logger.info(
    `setup-jordan: done — region ${regionId} ready for COD checkout`
  )
}
