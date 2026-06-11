import {
  buildLogisticsIdempotencyKey,
  computeLogisticsSignature,
  LOGISTICS_SIGNATURE_HEADER,
  requireLogisticsSignature,
  verifyLogisticsSignature,
} from "../utils"

const SECRET = "test-secret"
const BODY = JSON.stringify({ event_id: "evt_1", type: "collected" })

describe("verifyLogisticsSignature", () => {
  const valid = computeLogisticsSignature(BODY, SECRET)

  it("accepts the HMAC of the exact raw body", () => {
    expect(verifyLogisticsSignature(BODY, valid, SECRET)).toBe(true)
  })

  it("accepts a sha256= prefixed header and uppercase hex", () => {
    expect(
      verifyLogisticsSignature(BODY, `sha256=${valid}`, SECRET)
    ).toBe(true)
    expect(
      verifyLogisticsSignature(BODY, valid.toUpperCase(), SECRET)
    ).toBe(true)
  })

  it("rejects a tampered body", () => {
    expect(verifyLogisticsSignature(BODY + " ", valid, SECRET)).toBe(false)
  })

  it("rejects a signature made with another secret", () => {
    const forged = computeLogisticsSignature(BODY, "wrong-secret")
    expect(verifyLogisticsSignature(BODY, forged, SECRET)).toBe(false)
  })

  it("rejects malformed, missing, or wrong-length headers", () => {
    expect(verifyLogisticsSignature(BODY, "abc", SECRET)).toBe(false)
    expect(verifyLogisticsSignature(BODY, undefined, SECRET)).toBe(false)
    expect(verifyLogisticsSignature(undefined, valid, SECRET)).toBe(false)
  })
})

describe("buildLogisticsIdempotencyKey", () => {
  it("scopes the key to the shipment and the courier event", () => {
    expect(buildLogisticsIdempotencyKey("AWB-1", "evt_9")).toBe(
      "logistics:AWB-1:evt_9"
    )
  })

  it("differs across events of the same shipment (new attempt ≠ replay)", () => {
    expect(buildLogisticsIdempotencyKey("AWB-1", "evt_1")).not.toBe(
      buildLogisticsIdempotencyKey("AWB-1", "evt_2")
    )
  })
})

describe("requireLogisticsSignature middleware", () => {
  const makeRes = () => {
    const res = {
      statusCode: 0,
      body: undefined as unknown,
      status(code: number) {
        this.statusCode = code
        return this
      },
      json(payload: unknown) {
        this.body = payload
        return this
      },
    }
    return res
  }

  const makeReq = (rawBody: string | undefined, header?: string) =>
    ({
      rawBody,
      headers: header ? { [LOGISTICS_SIGNATURE_HEADER]: header } : {},
    }) as never

  afterEach(() => {
    delete process.env.LOGISTICS_WEBHOOK_SECRET
  })

  it("responds 503 when the shared secret is not configured", () => {
    const res = makeRes()
    const next = jest.fn()

    requireLogisticsSignature(makeReq(BODY), res as never, next)

    expect(res.statusCode).toBe(503)
    expect(next).not.toHaveBeenCalled()
  })

  it("responds 401 on a bad signature", () => {
    process.env.LOGISTICS_WEBHOOK_SECRET = SECRET
    const res = makeRes()
    const next = jest.fn()

    requireLogisticsSignature(makeReq(BODY, "deadbeef"), res as never, next)

    expect(res.statusCode).toBe(401)
    expect(next).not.toHaveBeenCalled()
  })

  it("calls next() on a valid signature", () => {
    process.env.LOGISTICS_WEBHOOK_SECRET = SECRET
    const res = makeRes()
    const next = jest.fn()

    requireLogisticsSignature(
      makeReq(BODY, computeLogisticsSignature(BODY, SECRET)),
      res as never,
      next
    )

    expect(next).toHaveBeenCalledTimes(1)
    expect(res.statusCode).toBe(0)
  })
})
