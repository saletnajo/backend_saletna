import { createHmac, timingSafeEqual } from "crypto"

import type {
  MedusaNextFunction,
  MedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"

export const LOGISTICS_SIGNATURE_HEADER = "x-logistics-signature"

/** Hex HMAC-SHA256 of the raw request body, keyed by the shared secret. */
export function computeLogisticsSignature(
  rawBody: string | Buffer,
  secret: string
): string {
  return createHmac("sha256", secret).update(rawBody).digest("hex")
}

/**
 * Constant-time comparison of the courier's signature header against the
 * HMAC of the raw body. Accepts an optional `sha256=` prefix and
 * case-insensitive hex.
 */
export function verifyLogisticsSignature(
  rawBody: string | Buffer | undefined,
  header: string | undefined,
  secret: string
): boolean {
  if (!rawBody || !header) {
    return false
  }

  const provided = (
    header.startsWith("sha256=") ? header.slice("sha256=".length) : header
  ).toLowerCase()
  const expected = computeLogisticsSignature(rawBody, secret)

  const providedBuffer = Buffer.from(provided, "utf8")
  const expectedBuffer = Buffer.from(expected, "utf8")
  if (providedBuffer.length !== expectedBuffer.length) {
    return false
  }

  return timingSafeEqual(providedBuffer, expectedBuffer)
}

/**
 * Webhook idempotency key, scoped to the courier shipment. Re-deliveries of
 * the same courier event carry the same event_id and replay as a no-op;
 * a genuinely new event for the same shipment (e.g. a second failed attempt)
 * carries a new event_id and is processed.
 */
export function buildLogisticsIdempotencyKey(
  courierRef: string,
  eventId: string
): string {
  return `logistics:${courierRef}:${eventId}`
}

/**
 * Route middleware: rejects requests whose HMAC signature does not match the
 * raw body (401), or reports a server misconfiguration when the shared
 * secret is unset (503 — couriers retry non-2xx, so deliveries recover once
 * ops sets the secret). Must run on a route configured with
 * `bodyParser: { preserveRawBody: true }`.
 */
export function requireLogisticsSignature(
  req: MedusaRequest,
  res: MedusaResponse,
  next: MedusaNextFunction
) {
  const secret = process.env.LOGISTICS_WEBHOOK_SECRET

  if (!secret) {
    res.status(503).json({
      type: "not_configured",
      message: "LOGISTICS_WEBHOOK_SECRET is not configured",
    })
    return
  }

  const header = req.headers[LOGISTICS_SIGNATURE_HEADER] as string | undefined
  const rawBody = (req as MedusaRequest & { rawBody?: Buffer }).rawBody

  if (!verifyLogisticsSignature(rawBody, header, secret)) {
    res.status(401).json({
      type: "unauthorized",
      message: "Invalid logistics webhook signature",
    })
    return
  }

  next()
}
