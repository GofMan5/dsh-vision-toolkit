import type { IncomingMessage } from 'node:http'

/**
 * Whether one hostname is a loopback literal (mirrors the host connection
 * service's `isLoopbackHostname`): `localhost`, `[::1]`, or any `127.x.x.x`.
 */
function isLoopbackHostname(hostname: string): boolean {
  if (hostname === 'localhost' || hostname === '[::1]') return true
  const parts = hostname.split('.')
  return parts.length === 4 && parts[0] === '127'
    && parts.every(part => /^\d{1,3}$/u.test(part) && Number(part) <= 255)
}

/**
 * Accept a request from the DSH Web application's origin. Method-agnostic:
 * the same fence guards state-changing POSTs and policy GETs.
 *
 * The fence mirrors the host's own `/api` browser-trust boundary
 * (`isTrustedApiRequest` in @deepseek-ai/dsh-client-connection):
 * - a present `Sec-Fetch-Site: cross-site` header always rejects;
 * - a present `Origin` must be an http(s) URL whose host equals the request's
 *   `Host` header (the one header DNS rebinding cannot forge);
 * - a request with **no** Origin is trusted on a loopback Host. Two real
 *   clients produce exactly that shape: the DSH Desktop shell forwards
 *   renderer requests through its authenticated host proxy with
 *   `Host`/`Origin`/`Sec-Fetch-Site` stripped and the host cookie attached,
 *   and same-origin browser GETs carry `Sec-Fetch-Site` instead of `Origin`.
 *   Non-loopback deployments without Origin still need `Sec-Fetch-Site`
 *   same-origin evidence.
 * @param req - the incoming request whose headers carry the origin evidence.
 * @returns whether the request may be answered.
 */
export function sameOriginRequest(req: IncomingMessage): boolean {
  const fetchSite = req.headers['sec-fetch-site']
  if (fetchSite === 'cross-site') return false
  const host = req.headers.host
  if (host === undefined) return false
  let hostUrl: URL
  try {
    hostUrl = new URL(`http://${host}`)
  } catch {
    return false
  }
  const origin = req.headers.origin
  if (origin === undefined) {
    if (isLoopbackHostname(hostUrl.hostname)) return true
    return fetchSite === 'same-origin' || fetchSite === 'same-site' || fetchSite === 'none'
  }
  try {
    const parsed = new URL(origin)
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && parsed.host === hostUrl.host
  } catch {
    return false
  }
}

/** Accept state-changing requests only from the DSH Web application's origin. */
export function sameOriginPost(req: IncomingMessage): boolean {
  return sameOriginRequest(req)
}
