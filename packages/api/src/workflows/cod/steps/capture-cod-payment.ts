import { IOrderModuleService, IPaymentModuleService } from "@medusajs/framework/types"
import {
  ContainerRegistrationKeys,
  MathBN,
  MedusaError,
  Modules,
} from "@medusajs/framework/utils"
import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"

import { COD_PROVIDER_ID } from "../../../modules/payment-cod/constants"

/**
 * Graph results type money as plain numbers or raw BigNumber objects
 * ({ value, precision }); MathBN wants the scalar.
 */
const asBnValue = (value: unknown): string | number => {
  if (value && typeof value === "object" && "value" in (value as object)) {
    return (value as { value: string | number }).value
  }
  return value as string | number
}

export type CaptureCodPaymentInput = {
  /** Any seller order belonging to the COD order group. */
  order_id: string
  /** Actor confirming the cash collection (admin/courier id). */
  captured_by?: string
}

export const captureCodPaymentStepId = "capture-cod-payment"

/**
 * Captures the COD payment once cash collection is confirmed.
 *
 * SPIKE findings this step is built on (Mercur basic / @mercurjs/core 2.1.6,
 * Medusa 2.13.4):
 * - There is no `split_order_payment` entity in this version. All seller
 *   orders split from one cart share ONE payment collection with ONE payment;
 *   the courier collects the whole group's cash at the door in one event, so
 *   COD capture is a single full capture of that shared payment.
 * - `capturePaymentWorkflow` must NOT be used here: its order-transaction
 *   logic queries `order_payment_collection` with `list: false` and books the
 *   FULL captured amount on one arbitrary seller order. Mercur itself works
 *   around this at placement time by distributing transactions proportionally
 *   (complete-cart-with-split-orders); this step mirrors that exact
 *   proportional math (MathBN, no rounding) for post-placement captures.
 * - Capture is irreversible (cash is physically in hand), so the step has no
 *   compensation; instead every part is idempotent and a retry completes
 *   whatever is missing (capture once, then top up missing transactions).
 */
export const captureCodPaymentStep = createStep(
  captureCodPaymentStepId,
  async (input: CaptureCodPaymentInput, { container }) => {
    const query = container.resolve(ContainerRegistrationKeys.QUERY)
    const paymentService = container.resolve<IPaymentModuleService>(
      Modules.PAYMENT
    )
    const orderService = container.resolve<IOrderModuleService>(Modules.ORDER)

    const {
      data: [orderWithCollection],
    } = await query.graph({
      entity: "order",
      fields: ["id", "payment_collections.id"],
      filters: { id: input.order_id },
    })

    const paymentCollectionId =
      orderWithCollection?.payment_collections?.[0]?.id
    if (!paymentCollectionId) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Order ${input.order_id} has no payment collection`
      )
    }

    const paymentFields = [
      "id",
      "amount",
      "raw_amount",
      "currency_code",
      "provider_id",
      "captured_at",
      "captures.id",
      "captures.amount",
      "captures.raw_amount",
    ]

    const { data: payments } = await query.graph({
      entity: "payment",
      fields: paymentFields,
      filters: { payment_collection_id: paymentCollectionId },
    })

    let payment = payments.find((p) => p?.provider_id === COD_PROVIDER_ID)
    if (!payment) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Order ${input.order_id} has no cash-on-delivery payment`
      )
    }

    const alreadyCaptured = !!payment.captured_at
    if (!alreadyCaptured) {
      // No amount → the payment module captures the full remaining amount.
      await paymentService.capturePayment({
        payment_id: payment.id,
        captured_by: input.captured_by,
      })

      const { data: refreshed } = await query.graph({
        entity: "payment",
        fields: paymentFields,
        filters: { id: payment.id },
      })
      payment = refreshed[0] ?? payment
    }

    // All seller orders sharing the payment collection get their proportional
    // share of every capture as an order transaction.
    const { data: orderLinks } = await query.graph({
      entity: "order_payment_collection",
      fields: ["order_id"],
      filters: { payment_collection_id: paymentCollectionId },
    })
    const orderIds = [
      ...new Set(
        orderLinks.map((l) => l?.order_id).filter((id): id is string => !!id)
      ),
    ]

    const { data: sellerOrders } = await query.graph({
      entity: "order",
      fields: ["id", "total", "currency_code"],
      filters: { id: orderIds },
    })

    const existingTransactions = await orderService.listOrderTransactions({
      order_id: orderIds,
      reference: "capture",
    })
    const existingKeys = new Set(
      existingTransactions.map((t) => `${t.order_id}:${t.reference_id}`)
    )

    const paymentAmount = asBnValue(payment.raw_amount ?? payment.amount)
    const toCreate = sellerOrders.flatMap((order) => {
      const proportion = MathBN.div(asBnValue(order.total), paymentAmount)

      return (payment!.captures ?? [])
        .filter((capture) => !existingKeys.has(`${order.id}:${capture!.id}`))
        .map((capture) => ({
          order_id: order.id,
          amount: MathBN.mult(
            asBnValue(capture!.raw_amount ?? capture!.amount),
            proportion
          ),
          currency_code: payment!.currency_code,
          reference: "capture",
          reference_id: capture!.id,
        }))
    })

    if (toCreate.length) {
      await orderService.addOrderTransactions(toCreate)
    }

    return new StepResponse({
      payment_id: payment.id,
      captured: !alreadyCaptured,
      order_ids: orderIds,
      transactions_added: toCreate.length,
    })
  }
)
