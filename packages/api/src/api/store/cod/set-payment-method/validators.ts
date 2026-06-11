import { z } from "zod"

export const StoreSetCodPaymentMethod = z.object({
  cart_id: z.string().min(1),
})

export type StoreSetCodPaymentMethodType = z.infer<
  typeof StoreSetCodPaymentMethod
>
