import { IOrderModuleService } from "@medusajs/framework/types"
import {
  ContainerRegistrationKeys,
  MathBN,
  Modules,
} from "@medusajs/framework/utils"
import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import { MercurModules } from "@mercurjs/types"

import {
  asMoneyValue,
  computeCodPayoutAmount,
} from "../utils/payout-math"

export type CalculateCodPayoutInput = {
  order_id: string
  cod_order: {
    id: string
    expected_amount: unknown
    collected_amount?: unknown
    cod_fee?: unknown
    currency_code: string
  }
}

export type CodPayoutCalculation = {
  order_id: string
  cod_order_id: string
  seller_id: string | null
  currency_code: string
  amount: string
  collected_amount: string | number
  commission_total: string
  refunds_total: string
  cod_fee: string | number
}

export const calculateCodPayoutStepId = "calculate-cod-payout"

/**
 * payout = collected − commission − refunds − cod_fee (MathBN, JOD-exact).
 *
 * - commission: Mercur stores commission_line records per order line item
 *   (refresh-order-commission-lines runs at placement); they are summed here
 *   via the commission module.
 * - refunds: order transactions with reference "refund" (negative amounts).
 * - cod_fee: deducted only when COD_FEE_BEARER=vendor; the fee itself lives
 *   on the cod_order record. Customer-/platform-borne fees never reduce the
 *   seller's payout.
 */
export const calculateCodPayoutStep = createStep(
  calculateCodPayoutStepId,
  async (input: CalculateCodPayoutInput, { container }) => {
    const query = container.resolve(ContainerRegistrationKeys.QUERY)
    const orderService = container.resolve<IOrderModuleService>(Modules.ORDER)
    // The commission module service type is not exported by @mercurjs/types.
    const commissionService = container.resolve<{
      listCommissionLines: (
        filters: Record<string, unknown>
      ) => Promise<{ raw_amount?: unknown; amount?: unknown }[]>
    }>(MercurModules.COMMISSION)

    const {
      data: [order],
    } = await query.graph({
      entity: "order",
      fields: ["id", "currency_code", "items.id", "seller.id"],
      filters: { id: input.order_id },
    })

    const itemIds = (order?.items ?? [])
      .map((item) => item?.id)
      .filter((id): id is string => !!id)

    const commissionLines = itemIds.length
      ? await commissionService.listCommissionLines({ item_id: itemIds })
      : []
    const commissionTotal = commissionLines
      .reduce(
        (sum, line) =>
          MathBN.add(sum, asMoneyValue(line.raw_amount ?? line.amount)),
        MathBN.convert(0)
      )
      .toString()

    const refundTransactions = await orderService.listOrderTransactions({
      order_id: input.order_id,
      reference: "refund",
    })
    const refundsTotal = refundTransactions
      .reduce(
        (sum, transaction) =>
          MathBN.add(
            sum,
            MathBN.abs(asMoneyValue(transaction.raw_amount ?? transaction.amount))
          ),
        MathBN.convert(0)
      )
      .toString()

    const feeBearer = (process.env.COD_FEE_BEARER ?? "platform").toLowerCase()
    const codFee =
      feeBearer === "vendor"
        ? asMoneyValue(input.cod_order.cod_fee, "0")
        : "0"

    const collectedAmount = asMoneyValue(
      input.cod_order.collected_amount ?? input.cod_order.expected_amount
    )

    const calculation: CodPayoutCalculation = {
      order_id: input.order_id,
      cod_order_id: input.cod_order.id,
      seller_id:
        (order as unknown as { seller?: { id: string } | null })?.seller?.id ??
        null,
      currency_code: input.cod_order.currency_code,
      amount: computeCodPayoutAmount({
        collected_amount: collectedAmount,
        commission_total: commissionTotal,
        refunds_total: refundsTotal,
        cod_fee: codFee,
      }),
      collected_amount: collectedAmount,
      commission_total: commissionTotal,
      refunds_total: refundsTotal,
      cod_fee: codFee,
    }

    return new StepResponse(calculation)
  }
)
