import { z } from "zod"

export const AdminCodSettle = z.object({
  order_id: z.string().min(1),
  settlement_ref: z.string().min(1),
  idempotency_key: z.string().min(1),
})

export type AdminCodSettleType = z.infer<typeof AdminCodSettle>
