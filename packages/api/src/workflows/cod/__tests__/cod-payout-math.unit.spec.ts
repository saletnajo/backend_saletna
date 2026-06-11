import { asMoneyValue, computeCodPayoutAmount } from "../utils/payout-math"

describe("computeCodPayoutAmount (JOD 3-decimal exact)", () => {
  it("subtracts a percentage commission to the fils", () => {
    // 10% of 149.750 = 14.975
    expect(
      computeCodPayoutAmount({
        collected_amount: "149.750",
        commission_total: "14.975",
        refunds_total: "0",
        cod_fee: "0",
      })
    ).toBe("134.775")
  })

  it("handles mixed flat + percentage commission with refunds", () => {
    // collected 500.000, commission 2.500 flat + 50.000 (10%), refund 19.999
    expect(
      computeCodPayoutAmount({
        collected_amount: "500.000",
        commission_total: "52.500",
        refunds_total: "19.999",
        cod_fee: "0",
      })
    ).toBe("427.501")
  })

  it("deducts the vendor-borne COD fee", () => {
    expect(
      computeCodPayoutAmount({
        collected_amount: "100.000",
        commission_total: "10.000",
        refunds_total: "0",
        cod_fee: "1.250",
      })
    ).toBe("88.75")
  })

  it("does not lose fils precision on float-hostile values", () => {
    // 0.1 + 0.2 style trap: 30.103 − 0.001 must be exactly 30.102
    expect(
      computeCodPayoutAmount({
        collected_amount: "30.103",
        commission_total: "0.001",
        refunds_total: "0",
        cod_fee: "0",
      })
    ).toBe("30.102")
  })

  it("returns a negative payout instead of hiding over-refunds", () => {
    expect(
      computeCodPayoutAmount({
        collected_amount: "10.000",
        commission_total: "1.000",
        refunds_total: "10.000",
        cod_fee: "0",
      })
    ).toBe("-1")
  })
})

describe("asMoneyValue", () => {
  it("unwraps raw BigNumber objects", () => {
    expect(asMoneyValue({ value: "149.750", precision: 20 })).toBe("149.750")
  })

  it("passes scalars through", () => {
    expect(asMoneyValue("12.345")).toBe("12.345")
    expect(asMoneyValue(60)).toBe(60)
  })

  it("falls back for null/undefined", () => {
    expect(asMoneyValue(null)).toBe("0")
    expect(asMoneyValue(undefined, "5")).toBe("5")
  })
})
