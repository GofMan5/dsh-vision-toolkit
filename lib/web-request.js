import { networkInterfaces } from 'node:os';
/**
 * Whether one hostname is a loopback literal (mirrors the host connection
 * service's `isLoopbackHostname`): `localhost`, `[::1]`, or any `127.x.x.x`.
 */
function isLoopbackHostname(hostname) {
    if (hostname === 'localhost' || hostname === '[::1]')
        return true;
    const parts = hostname.split('.');
    return parts.length === 4 && parts[0] === '127'
        && parts.every(part => /^\d{1,3}$/u.test(part) && Number(part) <= 255);
}
/**
 * Normalize one hostname literal for address comparison: lowercase, IPv6
 * brackets stripped, zone suffix stripped (`[fe80::1%eno1]` → `fe80::1`).
 */
function comparableAddress(hostname) {
    return hostname.toLowerCase().replace(/^\[/u, '').replace(/\]$/u, '').split('%')[0] ?? '';
}
/**
 * The addresses this machine actually serves on, as the Host header can
 * legitimately spell them: every bound interface address plus the loopback
 * forms.
 */
function ownHostnames() {
    const addresses = new Set();
    for (const infos of Object.values(networkInterfaces())) {
        for (const info of infos ?? [])
            addresses.add(comparableAddress(info.address));
    }
    return addresses;
}
/**
 * Whether the request is addressed to this machine: a loopback Host or one
 * of the machine's own interface addresses. This is the boundary the host's
 * own `/api` fence draws first (`isTrustedApiRequest` requires a loopback or
 * trusted authority before any browser evidence is considered): a Host the
 * machine does not serve — a DNS rebinder's domain that resolves here —
 * never earns trust, whatever Origin or Fetch-Metadata it carries, because
 * those headers are chosen by the attacker's page or forged outright by
 * non-browser clients.
 */
function isOwnHost(hostUrl) {
    if (isLoopbackHostname(hostUrl.hostname))
        return true;
    return ownHostnames().has(comparableAddress(hostUrl.hostname));
}
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
export function sameOriginRequest(req) {
    const fetchSite = req.headers['sec-fetch-site'];
    if (fetchSite === 'cross-site')
        return false;
    const host = req.headers.host;
    if (host === undefined)
        return false;
    let hostUrl;
    try {
        hostUrl = new URL(`http://${host}`);
    }
    catch {
        return false;
    }
    if (!isOwnHost(hostUrl))
        return false;
    const origin = req.headers.origin;
    if (origin === undefined)
        return true;
    try {
        const parsed = new URL(origin);
        return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && parsed.host === hostUrl.host;
    }
    catch {
        return false;
    }
}
/** Accept state-changing requests only from the DSH Web application's origin. */
export function sameOriginPost(req) {
    return sameOriginRequest(req);
}
//# sourceMappingURL=web-request.js.map