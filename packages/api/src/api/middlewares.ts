import { defineMiddlewares, validateAndTransformBody } from "@medusajs/framework/http";

import { StoreSetCodPaymentMethod } from "./store/cod/set-payment-method/validators";

export default defineMiddlewares({
    routes: [
        {
            matcher: "/store/cod/set-payment-method",
            methods: ["POST"],
            middlewares: [validateAndTransformBody(StoreSetCodPaymentMethod)],
        },
    ],
});