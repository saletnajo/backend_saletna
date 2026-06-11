import { defineLink } from "@medusajs/framework/utils"
import OrderModule from "@medusajs/medusa/order"

import CodModule from "../modules/cod"

/**
 * cod_order ↔ order (the seller order). Enables query.graph traversal in both
 * directions: order.cod_order and cod_order.order.
 */
export default defineLink(CodModule.linkable.codOrder, OrderModule.linkable.order)
