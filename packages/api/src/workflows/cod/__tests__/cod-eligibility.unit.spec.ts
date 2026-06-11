import {
  CodEligibilityCart,
  CodEligibilityConfig,
  findCodIneligibilityReason,
  loadCodEligibilityConfig,
} from "../utils/eligibility"

const baseConfig = (
  overrides: Partial<CodEligibilityConfig> = {}
): CodEligibilityConfig => ({
  allowed_region_ids: [],
  allowed_currencies: ["jod"],
  max_order_value: null,
  max_failed_attempts: 3,
  excluded_product_tags: [],
  ...overrides,
})

const baseCart = (
  overrides: Partial<CodEligibilityCart> = {}
): CodEligibilityCart => ({
  id: "cart_1",
  currency_code: "jod",
  region_id: "reg_jo",
  total: "150.000",
  items: [],
  ...overrides,
})

describe("loadCodEligibilityConfig", () => {
  it("applies defaults when env vars are unset", () => {
    expect(loadCodEligibilityConfig({})).toEqual({
      allowed_region_ids: [],
      allowed_currencies: ["jod"],
      max_order_value: null,
      max_failed_attempts: 3,
      excluded_product_tags: [],
    })
  })

  it("parses csv values, trims, and lowercases currencies and tags", () => {
    expect(
      loadCodEligibilityConfig({
        COD_ALLOWED_REGION_IDS: "reg_a, reg_b ,",
        COD_ALLOWED_CURRENCIES: "JOD, EUR",
        COD_MAX_ORDER_VALUE_JOD: "500.000",
        COD_MAX_FAILED_ATTEMPTS_PER_CUSTOMER: "5",
        COD_EXCLUDED_PRODUCT_TAGS: "No-COD, Fragile",
      })
    ).toEqual({
      allowed_region_ids: ["reg_a", "reg_b"],
      allowed_currencies: ["jod", "eur"],
      max_order_value: "500.000",
      max_failed_attempts: 5,
      excluded_product_tags: ["no-cod", "fragile"],
    })
  })
})

describe("findCodIneligibilityReason", () => {
  it("accepts an eligible cart", () => {
    expect(findCodIneligibilityReason(baseCart(), 0, baseConfig())).toBeNull()
  })

  describe("region rule", () => {
    it("rejects a region outside the allowlist", () => {
      const reason = findCodIneligibilityReason(
        baseCart({ region_id: "reg_other" }),
        0,
        baseConfig({ allowed_region_ids: ["reg_jo"] })
      )
      expect(reason).toMatch(/region/)
    })

    it("accepts any region when the allowlist is empty", () => {
      expect(
        findCodIneligibilityReason(
          baseCart({ region_id: "reg_other" }),
          0,
          baseConfig()
        )
      ).toBeNull()
    })

    it("accepts an allowlisted region", () => {
      expect(
        findCodIneligibilityReason(
          baseCart({ region_id: "reg_jo" }),
          0,
          baseConfig({ allowed_region_ids: ["reg_jo"] })
        )
      ).toBeNull()
    })
  })

  describe("currency rule", () => {
    it("rejects a non-JOD cart by default", () => {
      const reason = findCodIneligibilityReason(
        baseCart({ currency_code: "eur" }),
        0,
        baseConfig()
      )
      expect(reason).toMatch(/JOD/)
    })

    it("accepts additional currencies when configured", () => {
      expect(
        findCodIneligibilityReason(
          baseCart({ currency_code: "eur" }),
          0,
          baseConfig({ allowed_currencies: ["jod", "eur"] })
        )
      ).toBeNull()
    })
  })

  describe("max order value rule (JOD precision)", () => {
    const config = baseConfig({ max_order_value: "500.000" })

    it("accepts a total exactly at the cap", () => {
      expect(
        findCodIneligibilityReason(baseCart({ total: "500.000" }), 0, config)
      ).toBeNull()
    })

    it("rejects a total one fils over the cap", () => {
      const reason = findCodIneligibilityReason(
        baseCart({ total: "500.001" }),
        0,
        config
      )
      expect(reason).toMatch(/500\.000/)
    })

    it("ignores the cap when disabled", () => {
      expect(
        findCodIneligibilityReason(
          baseCart({ total: "999999.999" }),
          0,
          baseConfig()
        )
      ).toBeNull()
    })
  })

  describe("failed attempts rule", () => {
    it("blocks a customer at the attempts threshold", () => {
      const reason = findCodIneligibilityReason(baseCart(), 3, baseConfig())
      expect(reason).toMatch(/blocked/)
    })

    it("accepts a customer below the threshold", () => {
      expect(findCodIneligibilityReason(baseCart(), 2, baseConfig())).toBeNull()
    })

    it("never blocks when the check is disabled", () => {
      expect(
        findCodIneligibilityReason(
          baseCart(),
          99,
          baseConfig({ max_failed_attempts: 0 })
        )
      ).toBeNull()
    })
  })

  describe("excluded products rule", () => {
    const config = baseConfig({ excluded_product_tags: ["no-cod"] })
    const taggedItem = {
      product: {
        id: "prod_1",
        title: "Gold Bar",
        tags: [{ value: "No-COD" }],
      },
    }

    it("rejects carts containing an excluded tag (case-insensitive)", () => {
      const reason = findCodIneligibilityReason(
        baseCart({ items: [taggedItem] }),
        0,
        config
      )
      expect(reason).toMatch(/Gold Bar/)
    })

    it("accepts carts without excluded tags", () => {
      expect(
        findCodIneligibilityReason(
          baseCart({
            items: [
              { product: { id: "p", title: "Soap", tags: [{ value: "new" }] } },
            ],
          }),
          0,
          config
        )
      ).toBeNull()
    })
  })
})
