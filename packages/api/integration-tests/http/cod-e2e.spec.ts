import { createHmac } from "crypto"

import {
  ContainerRegistrationKeys,
  Modules,
  ProductStatus,
} from "@medusajs/framework/utils"
import {
  createApiKeysWorkflow,
  createInventoryLevelsWorkflow,
  createOrderFulfillmentWorkflow,
  createOrderShipmentWorkflow,
  createProductsWorkflow,
  createRegionsWorkflow,
  createSalesChannelsWorkflow,
  createShippingOptionsWorkflow,
  createShippingProfilesWorkflow,
  createStockLocationsWorkflow,
  createTaxRegionsWorkflow,
  linkSalesChannelsToApiKeyWorkflow,
  linkSalesChannelsToStockLocationWorkflow,
  updateStoresWorkflow,
} from "@medusajs/medusa/core-flows"
import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import jwt from "jsonwebtoken"

import { COD_MODULE } from "../../src/modules/cod"
import type CodModuleService from "../../src/modules/cod/service"

jest.setTimeout(240 * 1000)

const WEBHOOK_SECRET = "e2e-logistics-secret"
const SIGNATURE_HEADER = "x-logistics-signature"

const CUSTOMER_PHONE = "+962790001111"
const SELLER_A_PHONE = "+962790000001"
const SELLER_B_PHONE = "+962790000002"

// JOD prices with a live third decimal (fils) to prove 3-decimal handling
const PRICE_A = 15.505
const PRICE_B = 22.75
const PRICE_C = 8.25
const SHIPPING_PRICE = 2

/** Unwraps numbers that may arrive as raw BigNumber objects or strings. */
const num = (value: unknown): number =>
  Number((value as { value?: unknown })?.value ?? value)

medusaIntegrationTestRunner({
  inApp: true,
  // One marketplace fixture is shared by the whole suite: the tests below
  // are sequential chapters of a single E2E story (runInBand keeps order).
  disableAutoTeardown: true,
  env: {
    LOGISTICS_WEBHOOK_SECRET: WEBHOOK_SECRET,
    // Neutralize any local eligibility overrides so the suite is deterministic
    COD_ALLOWED_REGION_IDS: "",
    COD_ALLOWED_CURRENCIES: "",
    COD_MAX_ORDER_VALUE_JOD: "",
    COD_MAX_FAILED_ATTEMPTS_PER_CUSTOMER: "",
    COD_EXCLUDED_PRODUCT_TAGS: "",
    COD_FEE_BEARER: "",
  },
  testSuite: ({ api, getContainer }) => {
    describe("COD end-to-end", () => {
      // Shared fixture/state across the sequential tests
      const ctx = {} as {
        container: ReturnType<typeof getContainer>
        adminHeaders: Record<string, string>
        storeHeaders: Record<string, string>
        regionId: string
        salesChannelId: string
        locationId: string
        sellerA: { id: string }
        sellerB: { id: string }
        optionA: { id: string }
        optionB: { id: string }
        variantA: { id: string }
        variantB: { id: string }
        variantC: { id: string }
        orderA: { id: string }
        orderB: { id: string }
        orderC: { id: string }
      }

      const codService = () =>
        ctx.container.resolve<CodModuleService>(COD_MODULE)
      const query = () =>
        ctx.container.resolve(ContainerRegistrationKeys.QUERY)

      const sign = (rawBody: string) =>
        createHmac("sha256", WEBHOOK_SECRET).update(rawBody).digest("hex")

      const postWebhook = (payload: Record<string, unknown>) => {
        const rawBody = JSON.stringify(payload)
        return api.post("/webhooks/logistics/cod", rawBody, {
          headers: {
            "content-type": "application/json",
            [SIGNATURE_HEADER]: sign(rawBody),
          },
          validateStatus: () => true,
        })
      }

      const storePost = (path: string, body: Record<string, unknown>) =>
        api.post(path, body, {
          headers: ctx.storeHeaders,
          validateStatus: () => true,
        })

      const adminPost = (path: string, body: Record<string, unknown>) =>
        api.post(path, body, {
          headers: ctx.adminHeaders,
          validateStatus: () => true,
        })

      /** Subscribers are async (event bus) — poll until the effect lands. */
      const poll = async <T>(
        what: string,
        fn: () => Promise<T | undefined>,
        timeoutMs = 20_000
      ): Promise<T> => {
        const deadline = Date.now() + timeoutMs
        for (;;) {
          const result = await fn()
          if (result !== undefined) {
            return result
          }
          if (Date.now() > deadline) {
            throw new Error(`Timed out waiting for ${what}`)
          }
          await new Promise((resolve) => setTimeout(resolve, 250))
        }
      }

      const pollCodStatus = (orderId: string, status: string) =>
        poll(`cod_order(${orderId}) → ${status}`, async () => {
          const [codOrder] = await codService().listCodOrders({
            order_id: orderId,
          })
          return codOrder?.status === status ? codOrder : undefined
        })

      const getOrderPayment = async (orderId: string) => {
        const {
          data: [order],
        } = await query().graph({
          entity: "order",
          fields: [
            "id",
            "status",
            "payment_collections.payments.id",
            "payment_collections.payments.provider_id",
            "payment_collections.payments.captured_at",
            "payment_collections.payments.canceled_at",
          ],
          filters: { id: orderId },
        })
        type Payment = {
          id: string
          provider_id: string
          captured_at: string | null
          canceled_at: string | null
        }
        const collections = (
          order as unknown as {
            payment_collections?: { payments?: Payment[] }[]
          }
        ).payment_collections
        return collections?.[0]?.payments?.[0]
      }

      const getInventoryLevel = async (sku: string) => {
        const inventoryService = ctx.container.resolve(Modules.INVENTORY)
        const [item] = await inventoryService.listInventoryItems({ sku })
        const [level] = await inventoryService.listInventoryLevels({
          inventory_item_id: item.id,
        })
        return {
          stocked: num(level.stocked_quantity),
          reserved: num(level.reserved_quantity),
        }
      }

      /** Store checkout: cart → items → per-seller shipping → COD → complete. */
      const completeCodCheckout = async (
        items: { variant_id: string; quantity: number }[],
        optionIds: string[]
      ) => {
        const cartRes = await storePost("/store/carts", {
          region_id: ctx.regionId,
          sales_channel_id: ctx.salesChannelId,
          email: "layla@example.jo",
          shipping_address: {
            first_name: "Layla",
            last_name: "Haddad",
            address_1: "Rainbow St 12",
            city: "Amman",
            postal_code: "11181",
            country_code: "jo",
            phone: CUSTOMER_PHONE,
          },
        })
        expect(cartRes.status).toBe(200)
        const cartId = cartRes.data.cart.id as string

        for (const item of items) {
          const addRes = await storePost(
            `/store/carts/${cartId}/line-items`,
            item
          )
          expect(addRes.status).toBe(200)
        }
        for (const optionId of optionIds) {
          const shipRes = await storePost(
            `/store/carts/${cartId}/shipping-methods`,
            { option_id: optionId }
          )
          expect(shipRes.status).toBe(200)
        }

        const codRes = await storePost("/store/cod/set-payment-method", {
          cart_id: cartId,
        })
        expect(codRes.status).toBe(200)

        const completeRes = await storePost(
          `/store/carts/${cartId}/complete`,
          {}
        )
        expect(completeRes.status).toBe(200)
        expect(completeRes.data.type).toBe("order_group")

        const {
          data: [orderGroup],
        } = await query().graph({
          entity: "order_group",
          fields: ["id", "orders.id"],
          filters: { id: completeRes.data.order_group.id },
        })
        return (
          orderGroup as unknown as { orders: { id: string }[] }
        ).orders.map((order) => order.id)
      }

      /** Which seller order owns this variant (split orders shuffle order). */
      const orderOfVariant = async (orderIds: string[], variantId: string) => {
        for (const orderId of orderIds) {
          const {
            data: [order],
          } = await query().graph({
            entity: "order",
            fields: ["id", "items.variant_id"],
            filters: { id: orderId },
          })
          const orderItems = (
            order as unknown as { items: { variant_id: string }[] }
          ).items
          if (orderItems.some((item) => item.variant_id === variantId)) {
            return orderId
          }
        }
        throw new Error(`No order in ${orderIds} carries ${variantId}`)
      }

      const shipOrder = async (orderId: string) => {
        const {
          data: [order],
        } = await query().graph({
          entity: "order",
          // order item quantity lives on the order-item detail record
          fields: ["id", "items.id", "items.detail.quantity"],
          filters: { id: orderId },
        })
        const items = (
          order as unknown as {
            items: { id: string; detail?: { quantity: unknown } }[]
          }
        ).items.map((item) => ({
          id: item.id,
          quantity: num(item.detail?.quantity),
        }))
        expect(items.every((item) => Number.isFinite(item.quantity))).toBe(true)

        await createOrderFulfillmentWorkflow(ctx.container).run({
          input: { order_id: orderId, items, location_id: ctx.locationId },
        })

        const {
          data: [withFulfillment],
        } = await query().graph({
          entity: "order",
          fields: ["id", "fulfillments.id"],
          filters: { id: orderId },
        })
        const fulfillmentId = (
          withFulfillment as unknown as { fulfillments: { id: string }[] }
        ).fulfillments[0].id

        await createOrderShipmentWorkflow(ctx.container).run({
          input: {
            order_id: orderId,
            fulfillment_id: fulfillmentId,
            items,
            labels: [],
          },
        })
      }

      it("sets up a two-seller JOD marketplace", async () => {
        ctx.container = getContainer()
        const container = ctx.container
        const link = container.resolve(ContainerRegistrationKeys.LINK)

        // Admin auth: real user + a JWT signed with the configured secret
        const userService = container.resolve(Modules.USER)
        const user = await userService.createUsers({
          email: "cod-e2e@admin.local",
        })
        // rbac feature flag is on — core admin routes need the wildcard role
        await link.create({
          [Modules.USER]: { user_id: user.id },
          [Modules.RBAC]: { rbac_role_id: "role_super_admin" },
        })
        const { jwtSecret } = container.resolve("configModule").projectConfig
          .http as { jwtSecret: string }
        ctx.adminHeaders = {
          authorization: `Bearer ${jwt.sign(
            {
              actor_id: user.id,
              actor_type: "user",
              auth_identity_id: "authid_cod_e2e",
              // rbac reads role membership from the token claims
              app_metadata: { roles: ["role_super_admin"] },
            },
            jwtSecret,
            { expiresIn: "1d" }
          )}`,
        }

        const storeService = container.resolve(Modules.STORE)
        const [store] = await storeService.listStores()
        const {
          result: [salesChannel],
        } = await createSalesChannelsWorkflow(container).run({
          input: { salesChannelsData: [{ name: "COD E2E Channel" }] },
        })
        ctx.salesChannelId = salesChannel.id
        await updateStoresWorkflow(container).run({
          input: {
            selector: { id: store.id },
            update: {
              supported_currencies: [
                { currency_code: "eur", is_default: true },
                { currency_code: "jod" },
              ],
              default_sales_channel_id: salesChannel.id,
            },
          },
        })

        const {
          result: [region],
        } = await createRegionsWorkflow(container).run({
          input: {
            regions: [
              {
                name: "Jordan",
                currency_code: "jod",
                countries: ["jo"],
                payment_providers: ["pp_cod", "pp_system_default"],
              },
            ],
          },
        })
        ctx.regionId = region.id
        await createTaxRegionsWorkflow(container).run({
          input: [{ country_code: "jo", provider_id: "tp_system" }],
        })

        const {
          result: [stockLocation],
        } = await createStockLocationsWorkflow(container).run({
          input: {
            locations: [
              {
                name: "Amman Warehouse",
                address: {
                  city: "Amman",
                  country_code: "JO",
                  address_1: "Airport Rd 1",
                },
              },
            ],
          },
        })
        ctx.locationId = stockLocation.id
        await link.create({
          [Modules.STOCK_LOCATION]: { stock_location_id: stockLocation.id },
          [Modules.FULFILLMENT]: { fulfillment_provider_id: "manual_manual" },
        })
        await linkSalesChannelsToStockLocationWorkflow(container).run({
          input: { id: stockLocation.id, add: [salesChannel.id] },
        })

        const fulfillmentService = container.resolve(Modules.FULFILLMENT)
        const existingProfiles =
          await fulfillmentService.listShippingProfiles({ type: "default" })
        let shippingProfile = existingProfiles[0]
        if (!shippingProfile) {
          const {
            result: [createdProfile],
          } = await createShippingProfilesWorkflow(container).run({
            input: { data: [{ name: "COD E2E Profile", type: "default" }] },
          })
          shippingProfile = createdProfile
        }

        const fulfillmentSet =
          await fulfillmentService.createFulfillmentSets({
            name: "Amman delivery",
            type: "shipping",
            service_zones: [
              {
                name: "Jordan",
                geo_zones: [{ country_code: "jo", type: "country" }],
              },
            ],
          })
        await link.create({
          [Modules.STOCK_LOCATION]: { stock_location_id: stockLocation.id },
          [Modules.FULFILLMENT]: { fulfillment_set_id: fulfillmentSet.id },
        })

        // Two sellers — Mercur splits cart completion into one order each
        const sellerService = container.resolve("seller") as {
          createSellers: (data: Record<string, unknown>[]) => Promise<
            { id: string }[]
          >
        }
        const [sellerA, sellerB] = await sellerService.createSellers([
          {
            name: "Amman Crafts",
            handle: "amman-crafts",
            email: "crafts@e2e.local",
            phone: SELLER_A_PHONE,
            currency_code: "jod",
            status: "open",
          },
          {
            name: "Petra Goods",
            handle: "petra-goods",
            email: "petra@e2e.local",
            phone: SELLER_B_PHONE,
            currency_code: "jod",
            status: "open",
          },
        ])
        ctx.sellerA = sellerA
        ctx.sellerB = sellerB

        // Per-seller shipping options (split completion maps them by seller)
        const shippingOptionInput = (name: string) => ({
          name,
          price_type: "flat" as const,
          provider_id: "manual_manual",
          service_zone_id: fulfillmentSet.service_zones[0].id,
          shipping_profile_id: shippingProfile.id,
          type: {
            label: "Standard",
            description: "Courier delivery",
            code: "standard",
          },
          prices: [{ currency_code: "jod", amount: SHIPPING_PRICE }],
          rules: [
            { attribute: "enabled_in_store", value: "true", operator: "eq" as const },
            { attribute: "is_return", value: "false", operator: "eq" as const },
          ],
        })
        const { result: shippingOptions } = await createShippingOptionsWorkflow(
          container
        ).run({
          input: [
            shippingOptionInput("Amman Crafts Delivery"),
            shippingOptionInput("Petra Goods Delivery"),
          ],
        })
        ctx.optionA = shippingOptions[0]
        ctx.optionB = shippingOptions[1]
        await link.create([
          {
            [Modules.FULFILLMENT]: { shipping_option_id: ctx.optionA.id },
            seller: { seller_id: sellerA.id },
          },
          {
            [Modules.FULFILLMENT]: { shipping_option_id: ctx.optionB.id },
            seller: { seller_id: sellerB.id },
          },
        ])

        // Three products: A→seller A, B→seller B, C→seller A (failure path)
        const productInput = (
          title: string,
          sku: string,
          price: number
        ) => ({
          title,
          status: ProductStatus.PUBLISHED,
          shipping_profile_id: shippingProfile.id,
          sales_channels: [{ id: salesChannel.id }],
          options: [{ title: "Default", values: ["Default"] }],
          variants: [
            {
              title: "Default",
              sku,
              options: { Default: "Default" },
              manage_inventory: true,
              prices: [{ currency_code: "jod", amount: price }],
            },
          ],
        })
        const { result: products } = await createProductsWorkflow(
          container
        ).run({
          input: {
            products: [
              productInput("Olive Oil Soap", "SOAP-1", PRICE_A),
              productInput("Dead Sea Salt", "SALT-1", PRICE_B),
              productInput("Zaatar Blend", "ZAATAR-1", PRICE_C),
            ],
          },
        })
        ctx.variantA = products[0].variants[0]
        ctx.variantB = products[1].variants[0]
        ctx.variantC = products[2].variants[0]
        await link.create([
          {
            [Modules.PRODUCT]: { product_id: products[0].id },
            seller: { seller_id: sellerA.id },
          },
          {
            [Modules.PRODUCT]: { product_id: products[1].id },
            seller: { seller_id: sellerB.id },
          },
          {
            [Modules.PRODUCT]: { product_id: products[2].id },
            seller: { seller_id: sellerA.id },
          },
        ])

        const inventoryService = container.resolve(Modules.INVENTORY)
        const inventoryItems = await inventoryService.listInventoryItems({
          sku: ["SOAP-1", "SALT-1", "ZAATAR-1"],
        })
        await createInventoryLevelsWorkflow(container).run({
          input: {
            inventory_levels: inventoryItems.map((item) => ({
              location_id: stockLocation.id,
              inventory_item_id: item.id,
              stocked_quantity: 50,
            })),
          },
        })

        const {
          result: [apiKey],
        } = await createApiKeysWorkflow(container).run({
          input: {
            api_keys: [
              { title: "COD E2E", type: "publishable", created_by: "" },
            ],
          },
        })
        await linkSalesChannelsToApiKeyWorkflow(container).run({
          input: { id: apiKey.id, add: [salesChannel.id] },
        })
        ctx.storeHeaders = { "x-publishable-api-key": apiKey.token }

        expect(ctx.sellerA.id).toBeTruthy()
        expect(ctx.sellerB.id).toBeTruthy()
      })

      it("completes a multi-vendor COD checkout authorize-only", async () => {
        const orderIds = await completeCodCheckout(
          [
            { variant_id: ctx.variantA.id, quantity: 1 },
            { variant_id: ctx.variantB.id, quantity: 1 },
          ],
          [ctx.optionA.id, ctx.optionB.id]
        )
        expect(orderIds).toHaveLength(2)
        ctx.orderA = { id: await orderOfVariant(orderIds, ctx.variantA.id) }
        ctx.orderB = { id: await orderOfVariant(orderIds, ctx.variantB.id) }

        // order.placed subscriber creates one cod_order per seller order
        const codA = await pollCodStatus(ctx.orderA.id, "pending")
        const codB = await pollCodStatus(ctx.orderB.id, "pending")
        expect(num(codA.expected_amount)).toBeCloseTo(
          PRICE_A + SHIPPING_PRICE,
          3
        )
        expect(num(codB.expected_amount)).toBeCloseTo(
          PRICE_B + SHIPPING_PRICE,
          3
        )
        expect(codA.currency_code).toBe("jod")

        // COD is authorize-only at checkout: nothing captured yet
        const payment = await getOrderPayment(ctx.orderA.id)
        expect(payment?.provider_id).toBe("pp_cod")
        expect(payment?.captured_at).toBeFalsy()
      })

      it("moves COD orders out_for_delivery on shipment and queues Arabic SMS", async () => {
        await shipOrder(ctx.orderA.id)
        await shipOrder(ctx.orderB.id)

        await pollCodStatus(ctx.orderA.id, "out_for_delivery")
        await pollCodStatus(ctx.orderB.id, "out_for_delivery")

        // The sms channel received both parties' messages for both orders
        const notificationService = ctx.container.resolve(Modules.NOTIFICATION)
        const customerSms = await poll(
          "customer out-for-delivery SMS",
          async () => {
            const list = await notificationService.listNotifications({
              channel: "sms",
              template: "customerOutForDelivery",
            })
            return list.length >= 2 ? list : undefined
          }
        )
        expect(customerSms[0].to).toBe(CUSTOMER_PHONE)

        const vendorSms = await poll(
          "vendor out-for-delivery SMS",
          async () => {
            const list = await notificationService.listNotifications({
              channel: "sms",
              template: "vendorOutForDelivery",
            })
            return list.length >= 2 ? list : undefined
          }
        )
        expect(vendorSms.map((sms) => sms.to).sort()).toEqual(
          [SELLER_A_PHONE, SELLER_B_PHONE].sort()
        )
      })

      it("captures cash and ledgers the payout when the courier reports collection", async () => {
        // Tampered signature is rejected before any state change
        const rawBody = JSON.stringify({
          event_id: "evt_forged",
          type: "collected",
          order_id: ctx.orderA.id,
          courier_ref: "AWB-1001",
          collected_amount: "17.505",
        })
        const forged = await api.post("/webhooks/logistics/cod", rawBody, {
          headers: {
            "content-type": "application/json",
            [SIGNATURE_HEADER]: "deadbeef",
          },
          validateStatus: () => true,
        })
        expect(forged.status).toBe(401)

        const collectA = {
          event_id: "evt_collect_a_1",
          type: "collected",
          order_id: ctx.orderA.id,
          courier_ref: "AWB-1001",
          collected_amount: (PRICE_A + SHIPPING_PRICE).toFixed(3),
        }
        const first = await postWebhook(collectA)
        expect(first.status).toBe(200)
        expect(first.data).toMatchObject({ accepted: true, replay: false })

        const codA = await pollCodStatus(ctx.orderA.id, "collected")
        expect(num(codA.collected_amount)).toBeCloseTo(
          PRICE_A + SHIPPING_PRICE,
          3
        )
        expect(codA.courier_ref).toBe("AWB-1001")

        // The shared group payment is captured by the dedicated COD path
        const payment = await poll("payment capture", async () => {
          const paymentA = await getOrderPayment(ctx.orderA.id)
          return paymentA?.captured_at ? paymentA : undefined
        })
        expect(payment.provider_id).toBe("pp_cod")

        // cod.collected subscriber writes the manual-ledger payout entry
        const payoutA = await poll("payout ledger entry", async () => {
          const [payout] = await codService().listCodPayouts({
            cod_order_id: codA.id,
          })
          return payout
        })
        expect(payoutA.status).toBe("pending_settlement")
        expect(num(payoutA.amount)).toBeCloseTo(PRICE_A + SHIPPING_PRICE, 3)
        expect(payoutA.seller_id).toBe(ctx.sellerA.id)

        // Courier re-delivery of the same event replays as a no-op
        const replayed = await postWebhook(collectA)
        expect(replayed.status).toBe(200)
        expect(replayed.data).toMatchObject({ accepted: true, replay: true })
        const payoutsAfterReplay = await codService().listCodPayouts({
          cod_order_id: codA.id,
        })
        expect(payoutsAfterReplay).toHaveLength(1)

        // Second seller order: capture no-ops (already captured), payout still ledgers
        const second = await postWebhook({
          event_id: "evt_collect_b_1",
          type: "collected",
          order_id: ctx.orderB.id,
          courier_ref: "AWB-1002",
          collected_amount: (PRICE_B + SHIPPING_PRICE).toFixed(3),
        })
        expect(second.status).toBe(200)
        expect(second.data).toMatchObject({ accepted: true, replay: false })
        const codB = await pollCodStatus(ctx.orderB.id, "collected")
        const payoutB = await poll("seller B payout", async () => {
          const [payout] = await codService().listCodPayouts({
            cod_order_id: codB.id,
          })
          return payout
        })
        expect(num(payoutB.amount)).toBeCloseTo(PRICE_B + SHIPPING_PRICE, 3)
        expect(payoutB.seller_id).toBe(ctx.sellerB.id)

        // Collection receipts went out over SMS
        const notificationService = ctx.container.resolve(Modules.NOTIFICATION)
        await poll("collected SMS", async () => {
          const list = await notificationService.listNotifications({
            channel: "sms",
            template: "vendorCollected",
          })
          return list.length >= 2 ? list : undefined
        })
      })

      it("settles one seller payout via the manual ledger without touching the other", async () => {
        const settleBody = {
          order_id: ctx.orderA.id,
          settlement_ref: "CLIQ-E2E-0001",
          idempotency_key: "settle-a-1",
        }
        const res = await adminPost("/admin/cod/settle", settleBody)
        expect(res.status).toBe(200)
        expect(res.data.replay).toBe(false)
        expect(res.data.cod_order.status).toBe("settled")
        expect(res.data.cod_payout.status).toBe("settled")
        expect(res.data.cod_payout.settlement_ref).toBe("CLIQ-E2E-0001")

        // Same idempotency key replays as a no-op
        const replay = await adminPost("/admin/cod/settle", settleBody)
        expect(replay.status).toBe(200)
        expect(replay.data.replay).toBe(true)

        // Seller B's money is untouched by seller A's settlement
        const [codB] = await codService().listCodOrders({
          order_id: ctx.orderB.id,
        })
        expect(codB.status).toBe("collected")
        const [payoutB] = await codService().listCodPayouts({
          cod_order_id: codB.id,
        })
        expect(payoutB.status).toBe("pending_settlement")
      })

      it("cancels the order and restocks 100% when collection fails", async () => {
        const before = await getInventoryLevel("ZAATAR-1")
        expect(before).toEqual({ stocked: 50, reserved: 0 })

        const [orderCId] = await completeCodCheckout(
          [{ variant_id: ctx.variantC.id, quantity: 2 }],
          [ctx.optionA.id]
        )
        ctx.orderC = { id: orderCId }
        const codC = await pollCodStatus(orderCId, "pending")
        expect(num(codC.expected_amount)).toBeCloseTo(
          PRICE_C * 2 + SHIPPING_PRICE,
          3
        )

        // Completion reserved the stock
        const reserved = await getInventoryLevel("ZAATAR-1")
        expect(reserved).toEqual({ stocked: 50, reserved: 2 })

        const failed = await postWebhook({
          event_id: "evt_fail_c_1",
          type: "failed",
          order_id: orderCId,
          courier_ref: "AWB-2001",
          failure_reason: "Customer unreachable after 3 attempts",
          action: "cancel",
        })
        expect(failed.status).toBe(200)
        expect(failed.data).toMatchObject({ accepted: true, replay: false })

        const canceled = await pollCodStatus(orderCId, "canceled")
        expect(canceled.failure_reason).toBe(
          "Customer unreachable after 3 attempts"
        )
        expect(num(canceled.attempts)).toBe(1)

        // Order canceled, authorized payment canceled — and never captured
        await poll("order cancellation", async () => {
          const {
            data: [order],
          } = await query().graph({
            entity: "order",
            fields: ["id", "status"],
            filters: { id: orderCId },
          })
          return (order as unknown as { status: string }).status === "canceled"
            ? order
            : undefined
        })
        const payment = await getOrderPayment(orderCId)
        expect(payment?.captured_at).toBeFalsy()
        expect(payment?.canceled_at).toBeTruthy()

        // 100% restock: the reservation is fully released, stock untouched
        const after = await poll("inventory restock", async () => {
          const level = await getInventoryLevel("ZAATAR-1")
          return level.reserved === 0 ? level : undefined
        })
        expect(after).toEqual({ stocked: 50, reserved: 0 })

        // No payout can exist for a failed collection
        const payouts = await codService().listCodPayouts({
          cod_order_id: codC.id,
        })
        expect(payouts).toHaveLength(0)

        // A later courier event against the canceled order is acked but refused
        const lateCollect = await postWebhook({
          event_id: "evt_collect_c_late",
          type: "collected",
          order_id: orderCId,
          courier_ref: "AWB-2001",
          collected_amount: "18.500",
        })
        expect(lateCollect.status).toBe(200)
        expect(lateCollect.data.accepted).toBe(false)
        expect(lateCollect.data.reason).toBeTruthy()
      })

      it("keeps standard payments capturable while COD manual capture stays blocked", async () => {
        // Standard (non-COD) checkout through the default payment flow
        const cartRes = await storePost("/store/carts", {
          region_id: ctx.regionId,
          sales_channel_id: ctx.salesChannelId,
          email: "omar@example.jo",
          shipping_address: {
            first_name: "Omar",
            last_name: "Nassar",
            address_1: "Mecca St 5",
            city: "Amman",
            postal_code: "11183",
            country_code: "jo",
            phone: "+962790002222",
          },
        })
        expect(cartRes.status).toBe(200)
        const cartId = cartRes.data.cart.id as string
        await storePost(`/store/carts/${cartId}/line-items`, {
          variant_id: ctx.variantA.id,
          quantity: 1,
        })
        await storePost(`/store/carts/${cartId}/shipping-methods`, {
          option_id: ctx.optionA.id,
        })

        const collectionRes = await storePost("/store/payment-collections", {
          cart_id: cartId,
        })
        expect(collectionRes.status).toBe(200)
        const sessionRes = await storePost(
          `/store/payment-collections/${collectionRes.data.payment_collection.id}/payment-sessions`,
          { provider_id: "pp_system_default" }
        )
        expect(sessionRes.status).toBe(200)

        const completeRes = await storePost(
          `/store/carts/${cartId}/complete`,
          {}
        )
        expect(completeRes.status).toBe(200)
        expect(completeRes.data.type).toBe("order_group")
        const {
          data: [orderGroup],
        } = await query().graph({
          entity: "order_group",
          fields: ["id", "orders.id"],
          filters: { id: completeRes.data.order_group.id },
        })
        const standardOrderId = (
          orderGroup as unknown as { orders: { id: string }[] }
        ).orders[0].id

        // Non-COD orders never get a cod_order
        await new Promise((resolve) => setTimeout(resolve, 2000))
        const codOrders = await codService().listCodOrders({
          order_id: standardOrderId,
        })
        expect(codOrders).toHaveLength(0)

        // Default Medusa capture path still works for standard providers
        const standardPayment = await getOrderPayment(standardOrderId)
        expect(standardPayment?.provider_id).toBe("pp_system_default")
        const captureRes = await adminPost(
          `/admin/payments/${standardPayment!.id}/capture`,
          {}
        )
        expect(captureRes.status).toBe(200)
        expect(captureRes.data.payment.captured_at).toBeTruthy()

        // The same route refuses COD payments — collection path only
        const codPayment = await getOrderPayment(ctx.orderB.id)
        const blocked = await adminPost(
          `/admin/payments/${codPayment!.id}/capture`,
          {}
        )
        expect(blocked.status).toBe(400)
        expect(blocked.data.message).toContain("/admin/cod/collect")
      })
    })
  },
})
