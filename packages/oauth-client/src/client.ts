export const name = 'dsh-oauth-client'

/**
 * Host-side apply is empty on purpose. Cordis throws
 * `cannot get property "slots" without inject` if this fiber reads `ctx.slots`,
 * and `slots` is a browser service. Login UI talks to `/dsh-oauth/{provider}/`.
 */
export function apply(): void {}
