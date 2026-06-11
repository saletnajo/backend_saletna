import { z } from "zod"

export const AdminCodFail = z.object({
  order_id: z.string().min(1),
  failure_reason: z.string().min(1),
  action: z.enum(["retry", "cancel"]),
  idempotency_key: z.string().min(1),
})

export type AdminCodFailType = z.infer<typeof AdminCodFail>
