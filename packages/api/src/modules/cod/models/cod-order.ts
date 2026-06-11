import { model } from "@medusajs/framework/utils"

import { COD_ORDER_STATUSES } from "../types"

/**
 * One COD record per seller order. In this starter every seller order created
 * by Mercur's split-orders completion is a real `order` entity; the parent of
 * the split is the Mercur `order_group`, kept here for group-level collection
 * (the courier collects the whole group's cash at the door at once).
 */
export const CodOrder = model
  .define("cod_order", {
    id: model.id({ prefix: "cod" }).primaryKey(),
    order_id: model.text().unique(),
    order_group_id: model.text().nullable(),
    status: model.enum([...COD_ORDER_STATUSES]).default("pending"),
    expected_amount: model.bigNumber(),
    collected_amount: model.bigNumber().nullable(),
    currency_code: model.text().default("jod"),
    cod_fee: model.bigNumber().nullable(),
    attempts: model.number().default(0),
    failure_reason: model.text().nullable(),
    collected_at: model.dateTime().nullable(),
    collected_by: model.text().nullable(),
    courier_ref: model.text().nullable(),
    settled_at: model.dateTime().nullable(),
  })
  .indexes([{ on: ["status"] }, { on: ["order_group_id"] }])
