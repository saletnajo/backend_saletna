import { loadEnv, defineConfig } from '@medusajs/framework/utils'
import { DashboardModuleOptions } from '@mercurjs/types'
import path from 'path'
loadEnv(process.env.NODE_ENV || 'development', process.cwd())

module.exports = defineConfig({
  projectConfig: {
    databaseUrl: process.env.DATABASE_URL,
    http: {
      storeCors: process.env.STORE_CORS!,
      adminCors: process.env.ADMIN_CORS!,
      authCors: process.env.AUTH_CORS!,
      // @ts-expect-error: vendorCors is not defined in medusa config module
      vendorCors: process.env.VENDOR_CORS!,
      jwtSecret: process.env.JWT_SECRET || "supersecret",
      cookieSecret: process.env.COOKIE_SECRET || "supersecret",
    }
  },
  featureFlags: {
    rbac: true,
    seller_registration: true
  },
  modules: [
    {
      resolve: "@medusajs/medusa/rbac",
    },
    {
      resolve: '@medusajs/medusa/payment',
      options: {
        providers: [
          {
            // Cash on Delivery: authorize-only manual provider. No `id` is
            // set on purpose so the registered provider id is exactly
            // `pp_cod` (the loader appends `_${id}` only when an id is set).
            resolve: './src/modules/payment-cod',
            options: {},
          }
        ],
      },
    },
    {
      resolve: './src/modules/cod',
    },
    {
      resolve: '@medusajs/medusa/notification',
      options: {
        providers: [
          // Configuring the module replaces Medusa's default entry, so the
          // stock in-app feed provider is re-declared alongside our channel.
          {
            resolve: '@medusajs/medusa/notification-local',
            id: 'local',
            options: {
              name: 'Local Notification Provider',
              channels: ['feed'],
            },
          },
          {
            // COD SMS channel: log-transport placeholder, swap the provider
            // service for a real gateway without touching subscribers.
            resolve: './src/modules/sms-logger',
            id: 'sms',
            options: {
              channels: ['sms'],
            },
          },
        ],
      },
    },
    {
      resolve: '@mercurjs/core/modules/admin-ui',
      options: {
        appDir: path.join(__dirname, '../../apps/admin'),
        path: '/dashboard',
      } as DashboardModuleOptions
    },
    {
      resolve: '@mercurjs/core/modules/vendor-ui',
      options: {
        appDir: path.join(__dirname, '../../apps/vendor'),
        path: '/seller',
      } as DashboardModuleOptions
    },
  ],
  plugins: [{
    resolve: "@mercurjs/core",
    options: {}
  }]
})
