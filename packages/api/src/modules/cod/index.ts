import { Module } from "@medusajs/framework/utils"

import CodModuleService from "./service"

export const COD_MODULE = "cod"

export default Module(COD_MODULE, {
  service: CodModuleService,
})
