import { defineMiddlewares, validateAndTransformBody } from "@medusajs/framework/http";

import { AdminCodCollect } from "./admin/cod/collect/validators";
import { AdminCodFail } from "./admin/cod/fail/validators";
import { StoreSetCodPaymentMethod } from "./store/cod/set-payment-method/validators";

export default defineMiddlewares({
    routes: [
        {
            matcher: "/store/cod/set-payment-method",
            methods: ["POST"],
            middlewares: [validateAndTransformBody(StoreSetCodPaymentMethod)],
        },
        {
            matcher: "/admin/cod/collect",
            methods: ["POST"],
            middlewares: [validateAndTransformBody(AdminCodCollect)],
        },
        {
            matcher: "/admin/cod/fail",
            methods: ["POST"],
            middlewares: [validateAndTransformBody(AdminCodFail)],
        },
    ],
});