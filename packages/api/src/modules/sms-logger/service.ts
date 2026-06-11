import type {
  Logger,
  ProviderSendNotificationDTO,
  ProviderSendNotificationResultsDTO,
} from "@medusajs/framework/types"
import { AbstractNotificationProviderService } from "@medusajs/framework/utils"

type InjectedDependencies = {
  logger: Logger
}

/**
 * Notification provider for the "sms" channel. Placeholder transport: it
 * writes the message to the application log instead of calling an SMS
 * gateway, so the COD notification flow is fully wired and observable in
 * dev/staging. Swap `send` for a real gateway call (Twilio, local Jordanian
 * aggregator, ...) without touching the subscribers.
 */
export class SmsLoggerNotificationService extends AbstractNotificationProviderService {
  static identifier = "sms-logger"

  protected logger_: Logger

  constructor({ logger }: InjectedDependencies) {
    super()
    this.logger_ = logger
  }

  async send(
    notification: ProviderSendNotificationDTO
  ): Promise<ProviderSendNotificationResultsDTO> {
    const text = notification.content?.text ?? ""

    this.logger_.info(
      `[SMS:${notification.template}] to=${notification.to} :: ${text}`
    )

    return {}
  }
}
