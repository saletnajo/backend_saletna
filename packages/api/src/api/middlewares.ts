import { defineMiddlewares, validateAndTransformBody } from "@medusajs/framework/http";

import { AdminCodCollect } from "./admin/cod/collect/validators";
import { AdminCodFail } from "./admin/cod/fail/validators";
import { AdminCodSettle } from "./admin/cod/settle/validators";
import { StoreSetCodPaymentMethod } from "./store/cod/set-payment-method/validators";
import { blockCodManualCapture } from "./utils/cod-capture-guard";
import { requireLogisticsSignature } from "./webhooks/logistics/utils";
import { LogisticsCodWebhook } from "./webhooks/logistics/cod/validators";

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
        {
            matcher: "/admin/cod/settle",
            methods: ["POST"],
            middlewares: [validateAndTransformBody(AdminCodSettle)],
        },
        // COD payments are captured exclusively by the COD collection path;
        // the standard manual capture routes are blocked for pp_cod payments.
        {
            matcher: "/vendor/payments/:id/capture",
            methods: ["POST"],
            middlewares: [blockCodManualCapture],
        },
        {
            matcher: "/admin/payments/:id/capture",
            methods: ["POST"],
            middlewares: [blockCodManualCapture],
        },
        // Courier webhook: HMAC over the raw body is the authentication, so
        // the raw body must be preserved and the signature checked before
        // anything else touches the payload.
        {
            matcher: "/webhooks/logistics/cod",
            methods: ["POST"],
            bodyParser: { preserveRawBody: true },
            middlewares: [
                requireLogisticsSignature,
                validateAndTransformBody(LogisticsCodWebhook),
            ],
        },
    ],
});