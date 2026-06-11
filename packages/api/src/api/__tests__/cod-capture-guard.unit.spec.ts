import { blockCodManualCapture } from "../utils/cod-capture-guard"

const makeReq = (payment: Record<string, unknown> | undefined) =>
  ({
    params: { id: "pay_1" },
    scope: {
      resolve: () => ({
        graph: async () => ({ data: payment ? [payment] : [] }),
      }),
    },
  }) as never

const res = {} as never

describe("blockCodManualCapture (TASK-017 guard)", () => {
  it("rejects manual capture of a pp_cod payment", async () => {
    const next = jest.fn()

    await expect(
      blockCodManualCapture(
        makeReq({ id: "pay_1", provider_id: "pp_cod" }),
        res,
        next
      )
    ).rejects.toThrow(/cannot be captured manually/)

    expect(next).not.toHaveBeenCalled()
  })

  it("passes standard payments through untouched (non-regression)", async () => {
    const next = jest.fn()

    await blockCodManualCapture(
      makeReq({ id: "pay_1", provider_id: "pp_system_default" }),
      res,
      next
    )

    expect(next).toHaveBeenCalledTimes(1)
  })

  it("passes a stripe payment through untouched", async () => {
    const next = jest.fn()

    await blockCodManualCapture(
      makeReq({ id: "pay_1", provider_id: "pp_stripe-connect_stripe" }),
      res,
      next
    )

    expect(next).toHaveBeenCalledTimes(1)
  })

  it("leaves unknown payment ids to the underlying route's 404", async () => {
    const next = jest.fn()

    await blockCodManualCapture(makeReq(undefined), res, next)

    expect(next).toHaveBeenCalledTimes(1)
  })
})
