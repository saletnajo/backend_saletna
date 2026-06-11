import { isCodReplay } from "../utils/idempotency"

describe("isCodReplay", () => {
  const collected = { status: "collected", idempotency_key: "key-1" }

  it("treats the same key against a collected record as a collect replay", () => {
    expect(isCodReplay(collected, "key-1", "collect")).toBe(true)
  })

  it("is not a replay when the key differs (state machine rejects instead)", () => {
    expect(isCodReplay(collected, "key-2", "collect")).toBe(false)
  })

  it("is not a replay when no key was stored yet", () => {
    expect(
      isCodReplay({ status: "pending", idempotency_key: null }, "key-1", "collect")
    ).toBe(false)
  })

  it("requires the record to be in a state the operation produces", () => {
    // same key, but the record is still pending → not a replay
    expect(
      isCodReplay(
        { status: "pending", idempotency_key: "key-1" },
        "key-1",
        "collect"
      )
    ).toBe(false)
  })

  it("matches fail replays for failed, retried, and canceled records", () => {
    for (const status of ["failed", "out_for_delivery", "canceled"]) {
      expect(
        isCodReplay({ status, idempotency_key: "fail-1" }, "fail-1", "fail")
      ).toBe(true)
    }
  })

  it("never replays without an incoming key", () => {
    expect(isCodReplay(collected, undefined, "collect")).toBe(false)
    expect(isCodReplay(collected, null, "collect")).toBe(false)
  })

  it("treats the same key against a settled record as a settle replay", () => {
    expect(
      isCodReplay(
        { status: "settled", idempotency_key: "settle-1" },
        "settle-1",
        "settle"
      )
    ).toBe(true)
  })

  it("does not settle-replay a collected record (settle has not run yet)", () => {
    // same key stored by collect, but settle never produced "settled"
    expect(isCodReplay(collected, "key-1", "settle")).toBe(false)
  })
})
