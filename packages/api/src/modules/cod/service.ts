import { MedusaService } from "@medusajs/framework/utils"

import { CodOrder } from "./models/cod-order"
import { CodPayout } from "./models/cod-payout"

class CodModuleService extends MedusaService({ CodOrder, CodPayout }) {}

export default CodModuleService
