import { z } from "zod"

export const LogisticsCodWebhook = z
  .object({
    event_id: z.string().min(1),
    type: z.enum(["collected", "failed"]),
    order_id: z.string().min(1),
    courier_ref: z.string().min(1),
    collected_amount: z
      .union([z.string().min(1), z.number().nonnegative()])
      .optional(),
    failure_reason: z.string().min(1).optional(),
    action: z.enum(["retry", "cancel"]).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.type === "collected" && data.collected_amount === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["collected_amount"],
        message: "collected_amount is required for collected events",
      })
    }
    if (data.type === "failed" && !data.failure_reason) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["failure_reason"],
        message: "failure_reason is required for failed events",
      })
    }
  })

export type LogisticsCodWebhookType = z.infer<typeof LogisticsCodWebhook>
