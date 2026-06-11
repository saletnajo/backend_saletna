import { model } from "@medusajs/framework/utils"

import { COD_PAYOUT_STATUSES } from "../types"

/**
 * Manual-ledger payout entry for a COD seller order. Deliberately NOT a
 * Mercur payout-module record: COD cash never moves through a payment
 * gateway, so the seller's owed amount is tracked here and settled outside
 * the system (bank transfer / CliQ / cash). The unique order_id makes double
 * payouts impossible at the database level.
 */
export const CodPayout = model
  .define("cod_payout", {
    id: model.id({ prefix: "codpay" }).primaryKey(),
    cod_order_id: model.text(),
    order_id: model.text().unique(),
    seller_id: model.text().nullable(),
    status: model.enum([...COD_PAYOUT_STATUSES]).default("pending_settlement"),
    amount: model.bigNumber(),
    currency_code: model.text(),
    collected_amount: model.bigNumber(),
    commission_total: model.bigNumber(),
    refunds_total: model.bigNumber(),
    cod_fee: model.bigNumber().nullable(),
    breakdown: model.json().nullable(),
    settlement_ref: model.text().nullable(),
    settled_at: model.dateTime().nullable(),
  })
  .indexes([
    { on: ["status"] },
    { on: ["seller_id"] },
    { on: ["cod_order_id"] },
  ])
