import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import {
  ContainerRegistrationKeys,
  FulfillmentWorkflowEvents,
} from "@medusajs/framework/utils"

import { COD_MODULE } from "../modules/cod"
import type CodModuleService from "../modules/cod/service"
import { markCodOutForDeliveryWorkflow } from "../workflows/cod/mark-cod-out-for-delivery"
import { loadCodSmsContext, sendCodSms } from "../workflows/cod/utils/cod-sms"
import {
  CodSmsTemplates,
  formatSmsAmount,
} from "../workflows/cod/utils/sms-templates"

/**
 * shipment.created fires for every order; non-COD orders are skipped here.
 * For a COD order still pending, the cod_order moves to out_for_delivery and
 * both parties get the Arabic SMS: the customer is told to prepare the cash
 * amount, the vendor that the order left for delivery. Repeat shipment
 * events (or collect-before-ship) make the workflow a no-op and send nothing.
 */
export default async function codDeliveryShippedHandler({
  event: { data },
  container,
}: SubscriberArgs<{ id: string }>) {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)

  const {
    data: [fulfillment],
  } = await query.graph({
    entity: "fulfillment",
    fields: ["id", "order.id"],
    filters: { id: data.id },
  })

  const orderId = (
    fulfillment as unknown as { order?: { id: string } | null }
  )?.order?.id
  if (!orderId) {
    return
  }

  const codService = container.resolve<CodModuleService>(COD_MODULE)
  const [codOrder] = await codService.listCodOrders({ order_id: orderId })
  if (!codOrder) {
    return
  }

  const { result } = await markCodOutForDeliveryWorkflow(container).run({
    input: { order_id: orderId },
  })

  if (!result.transitioned) {
    return
  }

  const context = await loadCodSmsContext(container, orderId)
  if (!context) {
    return
  }

  const vars = {
    display_id: context.display_id,
    amount: formatSmsAmount(codOrder.expected_amount, context.currency_code),
  }

  const customerSent = await sendCodSms(container, {
    to: context.customer_phone,
    template: "customerOutForDelivery",
    text: CodSmsTemplates.customerOutForDelivery(vars),
    data: { order_id: orderId, cod_order_id: codOrder.id },
  })
  const vendorSent = await sendCodSms(container, {
    to: context.seller_phone,
    template: "vendorOutForDelivery",
    text: CodSmsTemplates.vendorOutForDelivery(vars),
    data: { order_id: orderId, cod_order_id: codOrder.id },
  })

  if (!customerSent || !vendorSent) {
    logger.warn(
      `COD out-for-delivery SMS skipped for order ${orderId}: ` +
        `customer_phone=${context.customer_phone ?? "missing"}, ` +
        `seller_phone=${context.seller_phone ?? "missing"}`
    )
  }
}

export const config: SubscriberConfig = {
  event: FulfillmentWorkflowEvents.SHIPMENT_CREATED,
  context: {
    subscriberId: "cod-delivery-shipped",
  },
}
