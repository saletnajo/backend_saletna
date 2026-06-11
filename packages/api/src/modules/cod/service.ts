import { MedusaService } from "@medusajs/framework/utils"

import { CodOrder } from "./models/cod-order"

class CodModuleService extends MedusaService({ CodOrder }) {}

export default CodModuleService
