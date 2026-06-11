import { BigNumberInput, MedusaContainer } from "@medusajs/framework/types"
import {
  ContainerRegistrationKeys,
  MathBN,
  MedusaError,
} from "@medusajs/framework/utils"

const csv = (value: string | undefined, fallback: string[] = []): string[] => {
  const parsed = (value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
  return parsed.length ? parsed : fallback
}

export type CodEligibilityConfig = {
  /** Region allowlist; empty means any region with an allowed currency. */
  allowed_region_ids: string[]
  /** Currencies COD accepts; defaults to JOD. */
  allowed_currencies: string[]
  /** Max cart total in currency units (e.g. "500.000"); null disables the cap. */
  max_order_value: string | null
  /** Block customers whose summed COD failure attempts reach this; 0 disables. */
  max_failed_attempts: number
  /** Product tag values (case-insensitive) excluded from COD. */
  excluded_product_tags: string[]
}

export function loadCodEligibilityConfig(
  env: NodeJS.ProcessEnv = process.env
): CodEligibilityConfig {
  const maxAttempts = Number.parseInt(
    env.COD_MAX_FAILED_ATTEMPTS_PER_CUSTOMER ?? "",
    10
  )

  return {
    allowed_region_ids: csv(env.COD_ALLOWED_REGION_IDS),
    allowed_currencies: csv(env.COD_ALLOWED_CURRENCIES, ["jod"]).map((c) =>
      c.toLowerCase()
    ),
    max_order_value: env.COD_MAX_ORDER_VALUE_JOD?.trim() || null,
    max_failed_attempts: Number.isNaN(maxAttempts) ? 3 : maxAttempts,
    excluded_product_tags: csv(env.COD_EXCLUDED_PRODUCT_TAGS).map((t) =>
      t.toLowerCase()
    ),
  }
}

export type CodEligibilityCart = {
  id: string
  currency_code: string
  region_id?: string | null
  total: BigNumberInput
  customer_id?: string | null
  items?:
    | ({
        product?: {
          id: string
          title?: string | null
          tags?: ({ value?: string | null } | null)[] | null
        } | null
      } | null)[]
    | null
}

/**
 * Pure rule evaluation — returns a human-readable reason when the cart is not
 * eligible for COD, or null when it is. Amount comparisons use MathBN so JOD's
 * 3 decimals are exact.
 */
export function findCodIneligibilityReason(
  cart: CodEligibilityCart,
  failedAttempts: number,
  config: CodEligibilityConfig
): string | null {
  if (
    config.allowed_region_ids.length &&
    (!cart.region_id || !config.allowed_region_ids.includes(cart.region_id))
  ) {
    return "Cash on delivery is not available in this region"
  }

  if (!config.allowed_currencies.includes(cart.currency_code?.toLowerCase())) {
    return `Cash on delivery is only available for ${config.allowed_currencies
      .join(", ")
      .toUpperCase()} carts`
  }

  if (
    config.max_order_value !== null &&
    MathBN.gt(cart.total, config.max_order_value)
  ) {
    return `Cart total exceeds the cash on delivery limit of ${config.max_order_value} ${cart.currency_code?.toUpperCase()}`
  }

  if (
    config.max_failed_attempts > 0 &&
    failedAttempts >= config.max_failed_attempts
  ) {
    return "Cash on delivery is blocked for this customer after repeated failed collections"
  }

  if (config.excluded_product_tags.length) {
    const excluded = new Set(config.excluded_product_tags)
    const blocked = (cart.items ?? [])
      .map((item) => item?.product)
      .filter((product): product is NonNullable<typeof product> => !!product)
      .filter((product) =>
        (product.tags ?? []).some(
          (tag) => tag?.value && excluded.has(tag.value.toLowerCase())
        )
      )
      .map((product) => product.title ?? product.id)

    if (blocked.length) {
      return `These items are not eligible for cash on delivery: ${[
        ...new Set(blocked),
      ].join(", ")}`
    }
  }

  return null
}

export type CodEligibleCart = CodEligibilityCart & {
  payment_collection?: { id: string } | null
}

/**
 * Loads the cart, applies the COD eligibility rules and throws INVALID_DATA
 * with the failing rule's reason. Returns the cart (with payment collection
 * and totals) and the resolved config on success.
 */
export async function assertCartEligibleForCod(
  container: MedusaContainer,
  cartId: string
): Promise<{ cart: CodEligibleCart; config: CodEligibilityConfig }> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const config = loadCodEligibilityConfig()

  const {
    data: [cart],
  } = await query.graph({
    entity: "cart",
    fields: [
      "id",
      "currency_code",
      "region_id",
      "total",
      "customer_id",
      "payment_collection.id",
      // item money fields are required for the computed cart total to be
      // calculated — "total" alone comes back as 0
      "items.id",
      "items.quantity",
      "items.unit_price",
      "items.total",
      "items.product.id",
      "items.product.title",
      "items.product.tags.value",
    ],
    filters: { id: cartId },
  })

  if (!cart) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Cart ${cartId} was not found`
    )
  }

  let failedAttempts = 0
  if (cart.customer_id && config.max_failed_attempts > 0) {
    const { data: customerOrders } = await query.graph({
      entity: "order",
      fields: ["id", "cod_order.attempts"],
      filters: { customer_id: cart.customer_id },
    })

    failedAttempts = customerOrders.reduce((sum: number, order) => {
      const attempts = (order as { cod_order?: { attempts?: number } | null })
        .cod_order?.attempts
      return sum + (attempts ?? 0)
    }, 0)
  }

  // The graph result type does not surface computed fields like `total`,
  // although they are returned at runtime.
  const eligibleCart = cart as unknown as CodEligibleCart

  const reason = findCodIneligibilityReason(eligibleCart, failedAttempts, config)
  if (reason) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, reason)
  }

  return { cart: eligibleCart, config }
}
