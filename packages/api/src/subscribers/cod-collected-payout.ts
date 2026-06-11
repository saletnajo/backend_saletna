import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"

import { CodWorkflowEvents } from "../workflows/cod/events"
import { processCodPayoutWorkflow } from "../workflows/cod/process-cod-payout"

/**
 * The only trigger of the COD payout path: fired by
 * confirm-cod-collection after a successful capture. The workflow itself
 * re-validates (collected + captured + no existing payout), so replays or
 * manual re-runs cannot double-pay.
 */
export default async function codCollectedPayoutHandler({
  event: { data },
  container,
}: SubscriberArgs<{ cod_order_id: string; order_id: string }>) {
  await processCodPayoutWorkflow(container).run({
    input: { order_id: data.order_id },
  })
}

export const config: SubscriberConfig = {
  event: CodWorkflowEvents.COLLECTED,
  context: {
    subscriberId: "cod-collected-payout",
  },
}
