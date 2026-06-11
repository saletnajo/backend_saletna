import { COD_ORDER_STATUSES, CodOrderStatus } from "../../../modules/cod/types"
import {
  assertCodStatusTransition,
  COD_STATUS_TRANSITIONS,
} from "../steps/transition-cod-status"

describe("COD status state machine", () => {
  it("covers every status in the transition map", () => {
    expect(Object.keys(COD_STATUS_TRANSITIONS).sort()).toEqual(
      [...COD_ORDER_STATUSES].sort()
    )
  })

  // Exhaustive: every (from, to) pair behaves exactly per the map.
  for (const from of COD_ORDER_STATUSES) {
    for (const to of COD_ORDER_STATUSES) {
      const allowed = COD_STATUS_TRANSITIONS[from].includes(to)

      it(`${allowed ? "allows" : "rejects"} ${from} → ${to}`, () => {
        const attempt = () =>
          assertCodStatusTransition(from as CodOrderStatus, to as CodOrderStatus)

        if (allowed) {
          expect(attempt).not.toThrow()
        } else {
          expect(attempt).toThrow(`Invalid COD status transition: ${from} → ${to}`)
        }
      })
    }
  }

  it("treats settled and canceled as terminal", () => {
    expect(COD_STATUS_TRANSITIONS.settled).toHaveLength(0)
    expect(COD_STATUS_TRANSITIONS.canceled).toHaveLength(0)
  })

  it("rejects the double-collect and un-collect cases explicitly", () => {
    expect(() => assertCodStatusTransition("collected", "collected")).toThrow()
    expect(() =>
      assertCodStatusTransition("collected", "out_for_delivery")
    ).toThrow()
  })

  it("allows the retry loop failed → out_for_delivery → collected", () => {
    expect(() =>
      assertCodStatusTransition("failed", "out_for_delivery")
    ).not.toThrow()
    expect(() =>
      assertCodStatusTransition("out_for_delivery", "collected")
    ).not.toThrow()
  })
})
