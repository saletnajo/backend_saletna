import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { COD_MODULE } from "../modules/cod"
import type CodModuleService from "../modules/cod/service"
import { CodWorkflowEvents } from "../workflows/cod/events"
import { loadCodSmsContext, sendCodSms } from "../workflows/cod/utils/cod-sms"
import {
  CodSmsTemplates,
  formatSmsAmount,
} from "../workflows/cod/utils/sms-templates"

/**
 * Runs next to cod-collected-payout on cod.collected (independent
 * subscribers — an SMS failure can never block the payout, and vice versa).
 * The customer gets a cash receipt confirmation, the vendor a collection
 * notice with the settlement expectation.
 */
export default async function codCollectedNotifyHandler({
  event: { data },
  container,
}: SubscriberArgs<{ cod_order_id: string; order_id: string }>) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)

  const codService = container.resolve<CodModuleService>(COD_MODULE)
  const [codOrder] = await codService.listCodOrders({ id: data.cod_order_id })
  if (!codOrder) {
    return
  }

  const context = await loadCodSmsContext(container, data.order_id)
  if (!context) {
    return
  }

  const vars = {
    display_id: context.display_id,
    amount: formatSmsAmount(
      codOrder.collected_amount ?? codOrder.expected_amount,
      context.currency_code
    ),
  }

  const customerSent = await sendCodSms(container, {
    to: context.customer_phone,
    template: "customerCollected",
    text: CodSmsTemplates.customerCollected(vars),
    data: { order_id: data.order_id, cod_order_id: codOrder.id },
  })
  const vendorSent = await sendCodSms(container, {
    to: context.seller_phone,
    template: "vendorCollected",
    text: CodSmsTemplates.vendorCollected(vars),
    data: { order_id: data.order_id, cod_order_id: codOrder.id },
  })

  if (!customerSent || !vendorSent) {
    logger.warn(
      `COD collected SMS skipped for order ${data.order_id}: ` +
        `customer_phone=${context.customer_phone ?? "missing"}, ` +
        `seller_phone=${context.seller_phone ?? "missing"}`
    )
  }
}

export const config: SubscriberConfig = {
  event: CodWorkflowEvents.COLLECTED,
  context: {
    subscriberId: "cod-collected-notify",
  },
}
