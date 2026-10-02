import type { IncomingMessage } from 'node:http';
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
export declare function sameOriginRequest(req: IncomingMessage): boolean;
/** Accept state-changing requests only from the DSH Web application's origin. */
export declare function sameOriginPost(req: IncomingMessage): boolean;
//# sourceMappingURL=web-request.d.ts.map