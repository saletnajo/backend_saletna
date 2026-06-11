import { z } from "zod"

export const AdminCodCollect = z.object({
  order_id: z.string().min(1),
  collected_amount: z.union([z.string().min(1), z.number().nonnegative()]),
  idempotency_key: z.string().min(1),
  courier_ref: z.string().optional(),
})

export type AdminCodCollectType = z.infer<typeof AdminCodCollect>
