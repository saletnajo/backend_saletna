import type { MedusaContainer } from "@medusajs/framework/types"
import {
  ContainerRegistrationKeys,
  Modules,
} from "@medusajs/framework/utils"

import type { CodSmsTemplateKey } from "./sms-templates"

export type CodSmsContext = {
  order_id: string
  display_id: string | number
  currency_code: string
  customer_phone: string | null
  seller_phone: string | null
}

/**
 * Loads everything an SMS needs about an order: display id, currency, the
 * customer phone (shipping address first, customer record as fallback) and
 * the linked seller's phone.
 */
export async function loadCodSmsContext(
  container: MedusaContainer,
  orderId: string
): Promise<CodSmsContext | null> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)

  const {
    data: [order],
  } = await query.graph({
    entity: "order",
    fields: [
      "id",
      "display_id",
      "currency_code",
      "shipping_address.phone",
      "customer.phone",
      "seller.id",
      "seller.phone",
    ],
    filters: { id: orderId },
  })

  if (!order) {
    return null
  }

  const record = order as unknown as {
    id: string
    display_id?: string | number
    currency_code: string
    shipping_address?: { phone?: string | null } | null
    customer?: { phone?: string | null } | null
    seller?: { id: string; phone?: string | null } | null
  }

  return {
    order_id: record.id,
    display_id: record.display_id ?? record.id,
    currency_code: record.currency_code,
    customer_phone:
      record.shipping_address?.phone ?? record.customer?.phone ?? null,
    seller_phone: record.seller?.phone ?? null,
  }
}

/**
 * Sends one SMS through the notification module ("sms" channel). A missing
 * phone number is a soft skip (returns false) — notifications must never
 * fail the business flow that triggered them.
 */
export async function sendCodSms(
  container: MedusaContainer,
  input: {
    to: string | null
    template: CodSmsTemplateKey
    text: string
    data?: Record<string, unknown>
  }
): Promise<boolean> {
  if (!input.to) {
    return false
  }

  const notificationService = container.resolve(Modules.NOTIFICATION)
  await notificationService.createNotifications([
    {
      to: input.to,
      channel: "sms",
      template: input.template,
      content: { text: input.text },
      data: input.data ?? {},
    },
  ])

  return true
}
