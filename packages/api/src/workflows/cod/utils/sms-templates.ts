import { asMoneyValue } from "./payout-math"

/**
 * Display formatting for SMS bodies only — money math elsewhere stays on
 * MathBN. JOD renders with its 3 decimals and the Arabic dinar symbol; other
 * currencies (e.g. dev EUR fixtures) fall back to 2 decimals + ISO code.
 */
export function formatSmsAmount(value: unknown, currencyCode: string): string {
  const amount = Number(asMoneyValue(value))
  const code = (currencyCode ?? "").toLowerCase()

  if (code === "jod") {
    return `${amount.toFixed(3)} د.أ`
  }

  return `${amount.toFixed(2)} ${code.toUpperCase()}`
}

export type CodSmsVars = {
  display_id: string | number
  /** Pre-formatted via formatSmsAmount (includes the currency suffix). */
  amount: string
}

/**
 * Arabic (RTL) SMS copy for the COD lifecycle. Keys double as the
 * notification `template` ids recorded with each sent message.
 */
export const CodSmsTemplates = {
  customerOutForDelivery({ display_id, amount }: CodSmsVars): string {
    return (
      `سلتنا: عزيزنا العميل، طلبك رقم ${display_id} في طريقه إليك اليوم. ` +
      `يرجى تجهيز مبلغ ${amount} نقدًا لتسليمه لمندوب التوصيل عند الاستلام. ` +
      `شكرًا لثقتك بنا.`
    )
  },

  vendorOutForDelivery({ display_id, amount }: CodSmsVars): string {
    return (
      `سلتنا: الطلب رقم ${display_id} (دفع عند الاستلام بقيمة ${amount}) ` +
      `خرج للتوصيل الآن. سنُعلمكم فور تحصيل المبلغ من العميل.`
    )
  },

  customerCollected({ display_id, amount }: CodSmsVars): string {
    return (
      `سلتنا: تم استلام مبلغ ${amount} لطلبك رقم ${display_id} بنجاح. ` +
      `نشكر ثقتك بنا ونتمنى لك تجربة تسوق ممتعة.`
    )
  },

  vendorCollected({ display_id, amount }: CodSmsVars): string {
    return (
      `سلتنا: تم تحصيل مبلغ ${amount} نقدًا للطلب رقم ${display_id}. ` +
      `ستُحوَّل مستحقاتكم بعد خصم العمولة ضمن دورة التسوية القادمة.`
    )
  },
} as const

export type CodSmsTemplateKey = keyof typeof CodSmsTemplates
