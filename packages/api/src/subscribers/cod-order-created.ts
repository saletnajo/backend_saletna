import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { OrderWorkflowEvents } from "@medusajs/framework/utils"

import { createCodOrderWorkflow } from "../workflows/cod/create-cod-order"

/**
 * Mercur's split-orders completion emits order.placed once per seller order;
 * the workflow itself skips non-COD orders.
 */
export default async function codOrderCreatedHandler({
  event: { data },
  container,
}: SubscriberArgs<{ id: string }>) {
  await createCodOrderWorkflow(container).run({
    input: { order_id: data.id },
  })
}

export const config: SubscriberConfig = {
  event: OrderWorkflowEvents.PLACED,
  context: {
    subscriberId: "cod-order-created",
  },
}
