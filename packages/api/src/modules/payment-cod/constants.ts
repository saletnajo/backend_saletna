/**
 * Static identifier of the COD payment provider class.
 */
export const COD_PROVIDER_IDENTIFIER = "cod"

/**
 * Provider id as registered by the Payment module loader. The loader builds
 * `pp_${identifier}` and appends `_${id}` only when an `id` is configured for
 * the provider in `medusa-config.ts` — none is set on purpose, so the id is
 * exactly `pp_cod`. Use this when enabling the provider on a region or
 * filtering payments/sessions by provider.
 */
export const COD_PROVIDER_ID = `pp_${COD_PROVIDER_IDENTIFIER}`
