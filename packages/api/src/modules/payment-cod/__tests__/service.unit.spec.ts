import {
  PaymentActions,
  PaymentSessionStatus,
} from "@medusajs/framework/utils"

import { COD_PROVIDER_ID, COD_PROVIDER_IDENTIFIER } from "../constants"
import { CodPaymentProviderService } from "../service"
import { CodSessionData } from "../types"

// JOD carries 3 decimals (fils) — amounts must round-trip untouched.
const JOD_AMOUNT = "149.750"

const buildService = () => new CodPaymentProviderService({}, {})

const initiate = async (service: CodPaymentProviderService) => {
  const output = await service.initiatePayment({
    amount: JOD_AMOUNT,
    currency_code: "jod",
  })
  return { id: output.id, data: output.data as CodSessionData }
}

describe("CodPaymentProviderService", () => {
  let service: CodPaymentProviderService

  beforeEach(() => {
    service = buildService()
  })

  it("registers under the cod identifier resolving to pp_cod", () => {
    expect(CodPaymentProviderService.identifier).toBe(COD_PROVIDER_IDENTIFIER)
    expect(COD_PROVIDER_ID).toBe("pp_cod")
  })

  describe("initiatePayment", () => {
    it("creates a pending local session preserving JOD precision", async () => {
      const { id, data } = await initiate(service)

      expect(id).toEqual(expect.any(String))
      expect(data).toEqual({
        session_id: id,
        amount: JOD_AMOUNT,
        currency_code: "jod",
        status: "pending",
      })
    })

    it("generates a unique session id per payment", async () => {
      const first = await initiate(service)
      const second = await initiate(service)

      expect(first.id).not.toBe(second.id)
    })
  })

  describe("updatePayment", () => {
    it("updates amount and currency while keeping the session identity", async () => {
      const { id, data } = await initiate(service)

      const updated = await service.updatePayment({
        data,
        amount: "99.999",
        currency_code: "jod",
      })

      expect(updated.data).toEqual({
        ...data,
        session_id: id,
        amount: "99.999",
      })
    })
  })

  describe("authorizePayment", () => {
    it("authorizes without capturing", async () => {
      const { data } = await initiate(service)

      const authorized = await service.authorizePayment({ data })
      const authorizedData = authorized.data as CodSessionData

      expect(authorized.status).toBe(PaymentSessionStatus.AUTHORIZED)
      expect(authorizedData.status).toBe("authorized")
      expect(authorizedData.authorized_at).toEqual(expect.any(String))
      expect(authorizedData.captured_at).toBeUndefined()
      expect(authorizedData.amount).toBe(JOD_AMOUNT)
    })

    it("keeps the original authorization timestamp on re-authorization", async () => {
      const { data } = await initiate(service)

      const first = await service.authorizePayment({ data })
      const second = await service.authorizePayment({
        data: first.data,
      })

      expect((second.data as CodSessionData).authorized_at).toBe(
        (first.data as CodSessionData).authorized_at
      )
    })
  })

  describe("capturePayment", () => {
    const authorizedData = async () => {
      const { data } = await initiate(service)
      const authorized = await service.authorizePayment({ data })
      return authorized.data as CodSessionData
    }

    it("marks the session captured when collection is confirmed", async () => {
      const data = await authorizedData()

      const captured = await service.capturePayment({ data })
      const capturedData = captured.data as CodSessionData

      expect(capturedData.status).toBe("captured")
      expect(capturedData.captured_at).toEqual(expect.any(String))
      expect(capturedData.amount).toBe(JOD_AMOUNT)
      expect(capturedData.currency_code).toBe("jod")
    })

    it("is idempotent — a second capture keeps the first capture timestamp", async () => {
      const data = await authorizedData()

      const first = await service.capturePayment({ data })
      const second = await service.capturePayment({ data: first.data })

      expect((second.data as CodSessionData).captured_at).toBe(
        (first.data as CodSessionData).captured_at
      )
    })
  })

  describe("cancelPayment", () => {
    it("marks the session canceled", async () => {
      const { data } = await initiate(service)

      const canceled = await service.cancelPayment({ data })
      const canceledData = canceled.data as CodSessionData

      expect(canceledData.status).toBe("canceled")
      expect(canceledData.canceled_at).toEqual(expect.any(String))
    })
  })

  describe("refundPayment", () => {
    it("passes the session data through unchanged", async () => {
      const { data } = await initiate(service)
      const captured = await service.capturePayment({ data })

      const refunded = await service.refundPayment({
        data: captured.data,
        amount: "10.500",
      })

      expect(refunded.data).toEqual(captured.data)
    })
  })

  describe("deletePayment / retrievePayment", () => {
    it("round-trips the session data", async () => {
      const { data } = await initiate(service)

      await expect(service.deletePayment({ data })).resolves.toEqual({ data })
      await expect(service.retrievePayment({ data })).resolves.toEqual({ data })
    })
  })

  describe("getPaymentStatus", () => {
    it.each([
      ["pending", PaymentSessionStatus.PENDING],
      ["authorized", PaymentSessionStatus.AUTHORIZED],
      ["captured", PaymentSessionStatus.CAPTURED],
      ["canceled", PaymentSessionStatus.CANCELED],
    ])("maps stored status %s", async (stored, expected) => {
      const result = await service.getPaymentStatus({
        data: { status: stored },
      })

      expect(result.status).toBe(expected)
    })

    it("defaults to pending when the session data is missing", async () => {
      const result = await service.getPaymentStatus({})

      expect(result.status).toBe(PaymentSessionStatus.PENDING)
    })
  })

  describe("getWebhookActionAndData", () => {
    it("reports webhooks as not supported", async () => {
      const result = await service.getWebhookActionAndData(
        {} as never
      )

      expect(result).toEqual({ action: PaymentActions.NOT_SUPPORTED })
    })
  })
})
