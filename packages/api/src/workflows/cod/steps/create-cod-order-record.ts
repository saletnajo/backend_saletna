import {
  ContainerRegistrationKeys,
  MedusaError,
  Modules,
} from "@medusajs/framework/utils"
import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"

import { COD_MODULE } from "../../../modules/cod"
import type CodModuleService from "../../../modules/cod/service"
import { COD_PROVIDER_ID } from "../../../modules/payment-cod/constants"

export const createCodOrderRecordStepId = "create-cod-order-record"

/**
 * Creates the pending cod_order record for a (seller) order paid with the COD
 * provider and links it to the order. Returns null for non-COD orders, and is
 * idempotent for COD ones: an existing record is returned untouched
 * (order.placed deliveries are at-least-once).
 */
export const createCodOrderRecordStep = createStep(
  createCodOrderRecordStepId,
  async (input: { order_id: string }, { container }) => {
    const query = container.resolve(ContainerRegistrationKeys.QUERY)
    const service = container.resolve<CodModuleService>(COD_MODULE)
    const link = container.resolve(ContainerRegistrationKeys.LINK)

    const {
      data: [order],
    } = await query.graph({
      entity: "order",
      fields: [
        "id",
        "total",
        "currency_code",
        "order_group.id",
        "payment_collections.payment_sessions.provider_id",
      ],
      filters: { id: input.order_id },
    })

    if (!order) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `Order ${input.order_id} was not found`
      )
    }

    const sessions = (order.payment_collections ?? []).flatMap(
      (collection) => collection?.payment_sessions ?? []
    )
    const isCod = sessions.some(
      (session) => session?.provider_id === COD_PROVIDER_ID
    )
    if (!isCod) {
      return new StepResponse(null, null)
    }

    const [existing] = await service.listCodOrders({
      order_id: input.order_id,
    })
    if (existing) {
      return new StepResponse(existing, null)
    }

    const orderData = order as unknown as {
      id: string
      total: unknown
      currency_code: string
      order_group?: { id: string } | null
    }

    const created = await service.createCodOrders({
      order_id: orderData.id,
      order_group_id: orderData.order_group?.id ?? null,
      // bigNumber columns accept BigNumberInput at runtime; the generated
      // create type only advertises number.
      expected_amount: orderData.total as number,
      currency_code: orderData.currency_code,
      status: "pending",
    })

    await link.create({
      [COD_MODULE]: { cod_order_id: created.id },
      [Modules.ORDER]: { order_id: orderData.id },
    })

    return new StepResponse(created, {
      cod_order_id: created.id,
      order_id: orderData.id,
    })
  },
  async (compensation, { container }) => {
    if (!compensation) {
      return
    }

    const service = container.resolve<CodModuleService>(COD_MODULE)
    const link = container.resolve(ContainerRegistrationKeys.LINK)

    await link.dismiss({
      [COD_MODULE]: { cod_order_id: compensation.cod_order_id },
      [Modules.ORDER]: { order_id: compensation.order_id },
    })
    await service.deleteCodOrders(compensation.cod_order_id)
  }
)
