import { ModuleProvider, Modules } from "@medusajs/framework/utils"

import { SmsLoggerNotificationService } from "./service"

export default ModuleProvider(Modules.NOTIFICATION, {
  services: [SmsLoggerNotificationService],
})
