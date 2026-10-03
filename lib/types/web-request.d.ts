import type { IncomingMessage } from 'node:http';
/**
 * Accept a request from the DSH Web application's origin. Method-agnostic:
 * the same fence guards state-changing POSTs and policy/snapshot GETs.
 *
 * The fence mirrors the host's own `/api` browser-trust boundary
 * (`isTrustedApiRequest` in @deepseek-ai/dsh-client-connection):
 * - the Host must be this machine's (loopback or one of its interface
 *   addresses), which kills DNS rebinding — the rebinder's domain can
 *   resolve here, but it is not a Host this machine serves;
 * - a present `Sec-Fetch-Site: cross-site` always rejects;
 * - a present `Origin` must be an http(s) URL whose authority equals the
 *   request's `Host`;
 * - a request with **no** Origin is trusted once the Host is ours. Two real
 *   clients produce exactly that shape: the DSH Desktop shell forwards
 *   renderer requests through its authenticated host proxy with
 *   `Host`/`Origin`/`Sec-Fetch-Site` stripped and the host cookie attached,
 *   and same-origin browser GETs carry `Sec-Fetch-Site` instead of `Origin`.
 *   `Sec-Fetch-Site` itself is never treated as trust evidence: browsers set
 *   it, but nothing stops a non-browser client from forging it.
 * @param req - the incoming request whose headers carry the origin evidence.
 * @returns whether the request may be answered.
 */
export declare function sameOriginRequest(req: IncomingMessage): boolean;
/** Accept state-changing requests only from the DSH Web application's origin. */
export declare function sameOriginPost(req: IncomingMessage): boolean;
//# sourceMappingURL=web-request.d.ts.map