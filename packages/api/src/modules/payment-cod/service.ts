import { randomUUID } from "crypto"

import {
  AuthorizePaymentInput,
  AuthorizePaymentOutput,
  CancelPaymentInput,
  CancelPaymentOutput,
  CapturePaymentInput,
  CapturePaymentOutput,
  DeletePaymentInput,
  DeletePaymentOutput,
  GetPaymentStatusInput,
  GetPaymentStatusOutput,
  InitiatePaymentInput,
  InitiatePaymentOutput,
  ProviderWebhookPayload,
  RefundPaymentInput,
  RefundPaymentOutput,
  RetrievePaymentInput,
  RetrievePaymentOutput,
  UpdatePaymentInput,
  UpdatePaymentOutput,
  WebhookActionResult,
} from "@medusajs/framework/types"
import {
  AbstractPaymentProvider,
  PaymentActions,
  PaymentSessionStatus,
} from "@medusajs/framework/utils"

import { COD_PROVIDER_IDENTIFIER } from "./constants"
import { CodPaymentProviderOptions, CodSessionData, CodSessionStatus } from "./types"

/**
 * Cash on Delivery payment provider. There is no gateway behind it — every
 * operation completes locally:
 *
 * - checkout authorizes the session without capturing, so orders are placed
 *   with an authorized, uncollected payment
 * - capture is only expected once cash collection is confirmed by the COD
 *   collection flow, never at checkout
 * - cancel/refund only annotate the session; cash moves outside the system
 *
 * The session `data` keeps an audit trail (expected amount, status,
 * timestamps) for the collection flows built on top of this provider.
 */
export class CodPaymentProviderService extends AbstractPaymentProvider<CodPaymentProviderOptions> {
  static identifier = COD_PROVIDER_IDENTIFIER

  // The base constructor is protected; the module provider loader (and tests)
  // need a public one.
  constructor(cradle: Record<string, unknown>, config: CodPaymentProviderOptions = {}) {
    super(cradle, config)
  }

  async initiatePayment(
    input: InitiatePaymentInput
  ): Promise<InitiatePaymentOutput> {
    const id = randomUUID()
    const data: CodSessionData = {
      session_id: id,
      amount: input.amount,
      currency_code: input.currency_code,
      status: "pending",
    }

    return { id, data }
  }

  async updatePayment(input: UpdatePaymentInput): Promise<UpdatePaymentOutput> {
    return {
      data: {
        ...this.sessionData(input),
        amount: input.amount,
        currency_code: input.currency_code,
      },
    }
  }

  async authorizePayment(
    input: AuthorizePaymentInput
  ): Promise<AuthorizePaymentOutput> {
    const data = this.sessionData(input)

    return {
      status: PaymentSessionStatus.AUTHORIZED,
      data: {
        ...data,
        status: "authorized",
        authorized_at: data.authorized_at ?? new Date().toISOString(),
      },
    }
  }

  async capturePayment(
    input: CapturePaymentInput
  ): Promise<CapturePaymentOutput> {
    const data = this.sessionData(input)

    return {
      data: {
        ...data,
        status: "captured",
        captured_at: data.captured_at ?? new Date().toISOString(),
      },
    }
  }

  async refundPayment(input: RefundPaymentInput): Promise<RefundPaymentOutput> {
    // Cash goes back to the customer by hand; the Payment module records the
    // refund amount itself, so the session data passes through unchanged.
    return { data: this.sessionData(input) }
  }

  async cancelPayment(input: CancelPaymentInput): Promise<CancelPaymentOutput> {
    const data = this.sessionData(input)

    return {
      data: {
        ...data,
        status: "canceled",
        canceled_at: data.canceled_at ?? new Date().toISOString(),
      },
    }
  }

  async deletePayment(input: DeletePaymentInput): Promise<DeletePaymentOutput> {
    return { data: input.data }
  }

  async retrievePayment(
    input: RetrievePaymentInput
  ): Promise<RetrievePaymentOutput> {
    return { data: input.data }
  }

  async getPaymentStatus(
    input: GetPaymentStatusInput
  ): Promise<GetPaymentStatusOutput> {
    const statusMap: Record<CodSessionStatus, PaymentSessionStatus> = {
      pending: PaymentSessionStatus.PENDING,
      authorized: PaymentSessionStatus.AUTHORIZED,
      captured: PaymentSessionStatus.CAPTURED,
      canceled: PaymentSessionStatus.CANCELED,
    }

    return {
      status:
        statusMap[this.sessionData(input).status] ?? PaymentSessionStatus.PENDING,
      data: input.data,
    }
  }

  async getWebhookActionAndData(
    _payload: ProviderWebhookPayload["payload"]
  ): Promise<WebhookActionResult> {
    // No gateway, no webhooks. Courier callbacks belong to the COD collection
    // flows, not to the payment provider.
    return { action: PaymentActions.NOT_SUPPORTED }
  }

  private sessionData(input: { data?: Record<string, unknown> }): CodSessionData {
    return (input.data ?? {}) as CodSessionData
  }
}
