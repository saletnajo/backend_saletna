import {
  CodSmsTemplates,
  formatSmsAmount,
} from "../utils/sms-templates"

describe("formatSmsAmount", () => {
  it("renders JOD with 3 decimals and the dinar symbol", () => {
    expect(formatSmsAmount("45.5", "jod")).toBe("45.500 د.أ")
    expect(formatSmsAmount(149.75, "JOD")).toBe("149.750 د.أ")
  })

  it("unwraps raw BigNumber objects", () => {
    expect(formatSmsAmount({ value: "60", precision: 20 }, "jod")).toBe(
      "60.000 د.أ"
    )
  })

  it("falls back to 2 decimals + ISO code for other currencies", () => {
    expect(formatSmsAmount("60", "eur")).toBe("60.00 EUR")
  })
})

describe("CodSmsTemplates (Arabic copy)", () => {
  const vars = { display_id: 17, amount: "45.500 د.أ" }

  it("interpolates every template with no leftover placeholders", () => {
    for (const template of Object.values(CodSmsTemplates)) {
      const text = template(vars)
      expect(text).toContain("17")
      expect(text).toContain("45.500 د.أ")
      expect(text).not.toMatch(/\$\{|undefined|null/)
      expect(text.startsWith("سلتنا:")).toBe(true)
    }
  })

  it("tells the customer to prepare the cash amount on dispatch", () => {
    const text = CodSmsTemplates.customerOutForDelivery(vars)
    expect(text).toContain("في طريقه إليك")
    expect(text).toContain("يرجى تجهيز مبلغ")
  })

  it("tells the vendor the order left and collection will be reported", () => {
    const text = CodSmsTemplates.vendorOutForDelivery(vars)
    expect(text).toContain("خرج للتوصيل")
    expect(text).toContain("فور تحصيل المبلغ")
  })

  it("confirms the cash receipt to the customer", () => {
    const text = CodSmsTemplates.customerCollected(vars)
    expect(text).toContain("تم استلام مبلغ")
  })

  it("tells the vendor about collection and the coming settlement", () => {
    const text = CodSmsTemplates.vendorCollected(vars)
    expect(text).toContain("تم تحصيل مبلغ")
    expect(text).toContain("دورة التسوية")
  })

  it("keeps every message within 3 GSM segments of Arabic (≤201 chars)", () => {
    // Arabic SMS uses UCS-2: 70 chars/segment, 67 for concatenated parts.
    for (const template of Object.values(CodSmsTemplates)) {
      expect(template(vars).length).toBeLessThanOrEqual(201)
    }
  })
})
