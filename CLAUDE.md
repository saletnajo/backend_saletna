# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

This is a project created from the Mercur `basic` template: a multi-vendor marketplace built on MedusaJS v2. Before making a non-trivial change, answer four questions: where should I work, which starter contract surfaces am I touching, which shared skill should I use, and what should I verify before I finish?

## Commands

Package manager is **yarn 4** (`packageManager` in package.json); the README mentions `bun` but the repo is set up with `yarn.lock`/`.yarnrc.yml`. Root scripts fan out through Turborepo:

```bash
yarn build          # build all workspaces
yarn dev            # run all dev servers
yarn lint           # lint all workspaces
yarn check-types    # typecheck all workspaces
yarn format         # prettier --write
```

Backend (run from `packages/api`):

```bash
yarn dev                        # medusa develop — backend on :9000
yarn build                      # medusa build
yarn seed                       # medusa exec ./src/scripts/seed.ts
yarn test:unit                  # jest unit tests
yarn test:integration:http     # HTTP/route integration tests
yarn test:integration:modules  # module-level integration tests
```

Tests are Jest; run a single file or test by appending args, e.g. `yarn test:unit src/modules/foo/__tests__/bar.spec.ts` or `yarn test:unit -t "test name"`. The `TEST_TYPE` env var in each script selects which tests run.

Dashboards (run from `apps/admin` / `apps/vendor`):

```bash
yarn dev    # vite — admin on :7000, vendor on :7001
yarn build  # tsc -b && vite build
yarn lint
```

The backend requires `packages/api/.env` (copy from `.env.template`): `DATABASE_URL` (Postgres), `REDIS_URL`, `JWT_SECRET`, `COOKIE_SECRET`, and CORS vars (`STORE_CORS`, `ADMIN_CORS`, `AUTH_CORS`, `VENDOR_CORS`).

## Architecture

Three yarn workspaces wired by Turborepo:

- `packages/api` (`@acme/api`) — the Medusa v2 backend with the `@mercurjs/core` plugin. Custom code lives in `src/` under the standard Medusa surfaces: `api` (HTTP routes), `modules` (domain models/services), `workflows` (multi-step processes), `links` (cross-module relationships), `subscribers` (event reactions), `jobs` (scheduled/background), `scripts`. Generated route types are exported as `@acme/api/_generated` (from `.mercur/_generated`) and consumed by the dashboard apps.
- `apps/admin` (`@acme/admin`) and `apps/vendor` (`@acme/vendor`) — thin Vite/React shells around `@mercurjs/admin` and `@mercurjs/vendor`. Customization is via file-based routing: `page.tsx` files under `src/routes/` (e.g. `src/routes/blog/[id]/page.tsx` → `/blog/:id`); export a `config: RouteConfig` to add a sidebar entry. Routing is powered by `mercurDashboardPlugin` (from `@mercurjs/dashboard-sdk`) in each app's `vite.config.ts`, which reads `packages/api/medusa-config.ts`. See `apps/*/src/README.md` for the full routing reference.
- `packages/api/medusa-config.ts` is the single wiring point: it mounts the admin dashboard at `/dashboard` and the vendor dashboard at `/seller` (via the `admin-ui`/`vendor-ui` modules pointing at the app dirs), enables feature flags (`rbac`, `seller_registration`), and registers modules/plugins. Dashboard mounting is configured here, not in the apps.
- `blocks.json` maps registry install targets: `api` → `packages/api/src`, `admin` → `apps/admin/src`, `vendor` → `apps/vendor/src`.

## Adding Features — Check the Registry First

Before implementing any new marketplace feature from scratch, search the official Mercur registry:

```bash
npx @mercurjs/cli@latest search --query <keyword>
```

Many common features (reviews, team management, wishlists, notifications, chat, CSV import/export, approval flows, Algolia search) are already available as registry blocks. Installing a block is always faster and safer than building from scratch. Use the `mercur-blocks` skill when a block looks like a match. Registry commands run from the project root, where `blocks.json` lives.

Only build custom code when the registry has no suitable block.

## Workflow

For any non-trivial task:
1. understand the request
2. if the request is a feature addition — search the registry before touching any code
3. read every matching area guide from the Task Router
4. load a matching skill from `.claude/skills/` when the task is a repeated workflow
5. implement in small steps
6. run the smallest relevant verification set
7. report what was verified and what was not

## Task Router

- Backend API, modules, workflows, links, subscribers, jobs: `packages/api/CLAUDE.md`
- Admin extensions, custom pages, forms, tabs: `apps/admin/CLAUDE.md`
- Vendor extensions, custom pages, vendor flows: `apps/vendor/CLAUDE.md`

## Starter Contract Surfaces

Treat these as public starter contracts. Do not change them silently:

- `blocks.json` aliases and registry configuration
- `packages/api/src/*` structure and custom backend entrypoints
- `packages/api/medusa-config.ts`
- `@acme/api/_generated` route types and codegen-dependent behavior
- `apps/admin/src/*` route and page structure
- `apps/vendor/src/*` route and page structure
- `apps/admin/vite.config.ts` — panel bootstrap via `mercurDashboardPlugin`
- `apps/vendor/vite.config.ts` — panel bootstrap via `mercurDashboardPlugin`

## Shared Skills

Canonical shared skills live in `.claude/skills/`:
- `mercur-cli` — CLI choice, initialization, registry commands
- `mercur-blocks` — discovering, installing, and verifying blocks
- `medusa-ui-conformance` — load before inventing new UI components; prefer local wrappers and `@medusajs/ui`
- `dashboard-page-ui` — custom admin/vendor pages
- `dashboard-form-ui` — admin/vendor forms
- `dashboard-tab-ui` — tabbed/wizard workflows
- `migration-guide` — Mercur 1.x → 2.0 migration

## Typical Verification

Run only what matches the touched area, but do not skip checks that prove a touched contract still holds:
- root build or workspace build
- backend tests from `packages/api`
- admin or vendor lint/build
- codegen when routes or generated types changed
- manual verification for new pages, routes, or block installs

## AI Resources

- **Docs**: https://docs.mercurjs.com
- **MCP Server**: https://docs.mercurjs.com/mcp — connect your AI agent for documentation search
- **llms.txt**: https://docs.mercurjs.com/llms.txt — machine-readable project summary
- **AI Development Guide**: https://docs.mercurjs.com/v2/ai-development/mcp

## Lessons Learned

When you encounter a repeatable bug, a non-obvious gotcha, or learn something that would save time in future sessions, write it to `.claude/lessons.md`. Before starting non-trivial work, check `.claude/lessons.md` for known issues that might apply.

Format each entry as:
```
### <short title>
<what happened, why, and what to do instead>
```
