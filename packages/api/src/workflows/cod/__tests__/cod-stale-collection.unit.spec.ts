import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import codStaleCollectionJob, {
  config as jobConfig,
} from "../../../jobs/cod-stale-collection"
import { COD_MODULE } from "../../../modules/cod"
import {
  DEFAULT_STALE_COLLECTION_HOURS,
  getStaleCollectionCutoff,
  hoursSince,
  resolveStaleCollectionHours,
} from "../utils/stale-collection"

describe("resolveStaleCollectionHours", () => {
  it("defaults to 72 when unset, non-numeric, or non-positive", () => {
    expect(resolveStaleCollectionHours(undefined)).toBe(72)
    expect(resolveStaleCollectionHours("")).toBe(72)
    expect(resolveStaleCollectionHours("abc")).toBe(72)
    expect(resolveStaleCollectionHours("0")).toBe(72)
    expect(resolveStaleCollectionHours("-5")).toBe(72)
    expect(DEFAULT_STALE_COLLECTION_HOURS).toBe(72)
  })

  it("parses explicit values, including fractional hours", () => {
    expect(resolveStaleCollectionHours("24")).toBe(24)
    expect(resolveStaleCollectionHours("1.5")).toBe(1.5)
  })
})

describe("getStaleCollectionCutoff", () => {
  it("subtracts the window from now", () => {
    const now = new Date("2026-06-11T12:00:00.000Z")
    expect(getStaleCollectionCutoff(now, 72).toISOString()).toBe(
      "2026-06-08T12:00:00.000Z"
    )
    expect(getStaleCollectionCutoff(now, 1.5).toISOString()).toBe(
      "2026-06-11T10:30:00.000Z"
    )
  })
})

describe("hoursSince", () => {
  it("returns whole hours since the timestamp, accepting strings", () => {
    const now = new Date("2026-06-11T12:00:00.000Z")
    expect(hoursSince(new Date("2026-06-08T12:00:00.000Z"), now)).toBe(72)
    expect(hoursSince("2026-06-11T09:10:00.000Z", now)).toBe(2)
  })
})

describe("codStaleCollectionJob", () => {
  const ambientHours = process.env.COD_STALE_COLLECTION_HOURS

  const makeLogger = () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  })

  const makeContainer = (
    logger: ReturnType<typeof makeLogger>,
    listCodOrders: jest.Mock
  ) =>
    ({
      resolve: (key: string) => {
        if (key === COD_MODULE) {
          return { listCodOrders }
        }
        if (key === ContainerRegistrationKeys.LOGGER) {
          return logger
        }
        throw new Error(`unexpected resolve: ${key}`)
      },
    }) as unknown as MedusaContainer

  beforeEach(() => {
    delete process.env.COD_STALE_COLLECTION_HOURS
  })

  afterAll(() => {
    if (ambientHours === undefined) {
      delete process.env.COD_STALE_COLLECTION_HOURS
    } else {
      process.env.COD_STALE_COLLECTION_HOURS = ambientHours
    }
  })

  it("runs hourly and never mutates state (warn-only contract)", () => {
    expect(jobConfig).toEqual({
      name: "cod-stale-collection",
      schedule: "0 * * * *",
    })
  })

  it("queries out_for_delivery orders older than the default 72h window", async () => {
    const logger = makeLogger()
    const listCodOrders = jest.fn().mockResolvedValue([])
    const before = Date.now()

    await codStaleCollectionJob(makeContainer(logger, listCodOrders))

    const [filters] = listCodOrders.mock.calls[0]
    expect(filters.status).toBe("out_for_delivery")
    const cutoff = filters.updated_at.$lt as Date
    const expected = before - 72 * 60 * 60 * 1000
    expect(Math.abs(cutoff.getTime() - expected)).toBeLessThan(5_000)
  })

  it("honors COD_STALE_COLLECTION_HOURS", async () => {
    process.env.COD_STALE_COLLECTION_HOURS = "24"
    const logger = makeLogger()
    const listCodOrders = jest.fn().mockResolvedValue([])

    await codStaleCollectionJob(makeContainer(logger, listCodOrders))

    const cutoff = listCodOrders.mock.calls[0][0].updated_at.$lt as Date
    const expected = Date.now() - 24 * 60 * 60 * 1000
    expect(Math.abs(cutoff.getTime() - expected)).toBeLessThan(5_000)
  })

  it("warns once per stale order plus a summary", async () => {
    const logger = makeLogger()
    const listCodOrders = jest.fn().mockResolvedValue([
      {
        id: "cod_1",
        order_id: "order_1",
        courier_ref: "AWB-9",
        expected_amount: "45.5",
        currency_code: "jod",
        updated_at: new Date(Date.now() - 80 * 60 * 60 * 1000),
      },
      {
        id: "cod_2",
        order_id: "order_2",
        courier_ref: null,
        expected_amount: "60",
        currency_code: "jod",
        updated_at: new Date(Date.now() - 100 * 60 * 60 * 1000),
      },
    ])

    await codStaleCollectionJob(makeContainer(logger, listCodOrders))

    expect(logger.warn).toHaveBeenCalledTimes(3)
    const messages = logger.warn.mock.calls.map(([m]) => m as string)
    expect(messages[0]).toContain("cod_1")
    expect(messages[0]).toContain("order_1")
    expect(messages[0]).toContain("AWB-9")
    expect(messages[0]).toContain("80h")
    expect(messages[1]).toContain("cod_2")
    expect(messages[1]).toContain("courier_ref=none")
    expect(messages[2]).toContain("2 COD order(s)")
    expect(logger.info).not.toHaveBeenCalled()
  })

  it("logs a quiet info line when nothing is stale", async () => {
    const logger = makeLogger()
    const listCodOrders = jest.fn().mockResolvedValue([])

    await codStaleCollectionJob(makeContainer(logger, listCodOrders))

    expect(logger.warn).not.toHaveBeenCalled()
    expect(logger.info).toHaveBeenCalledTimes(1)
    expect(logger.info.mock.calls[0][0]).toContain("72h")
  })
})
