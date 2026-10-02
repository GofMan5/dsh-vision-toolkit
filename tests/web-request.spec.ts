import { describe, expect, it } from 'vitest'
import { sameOriginPost, sameOriginRequest } from '../src/web-request.ts'

type Headers = Record<string, string | undefined>

function request(headers: Headers) {
  const incoming = {
    headers: Object.fromEntries(
      Object.entries(headers)
        .filter((entry): entry is [string, string] => entry[1] !== undefined)
        .map(([name, value]) => [name.toLowerCase(), value]),
    ),
  }
  return incoming as Parameters<typeof sameOriginRequest>[0]
}

describe('sameOriginRequest', () => {
  it('trusts the DSH Desktop shell forwarder: loopback Host, no Origin, no Sec-Fetch-Site', () => {
    // The Electron shell (dsh-app://app) proxies renderer requests through
    // forwardWebRequest, which deletes host/origin/sec-fetch-site and
    // attaches the host cookie, so plugin routes see exactly this shape.
    expect(sameOriginRequest(request({ host: '127.0.0.1:19387' }))).toBe(true)
    expect(sameOriginRequest(request({ host: 'localhost:19387' }))).toBe(true)
    expect(sameOriginRequest(request({ host: '[::1]:19387' }))).toBe(true)
    expect(sameOriginPost(request({ host: '127.0.0.1:19387', 'content-type': 'application/json' }))).toBe(true)
  })

  it('still rejects cross-site evidence even on loopback', () => {
    expect(sameOriginRequest(request({ host: '127.0.0.1:19387', 'sec-fetch-site': 'cross-site' }))).toBe(false)
    expect(sameOriginRequest(request({ host: '127.0.0.1:19387', origin: 'http://evil.example', 'sec-fetch-site': 'cross-site' }))).toBe(false)
  })

  it('accepts a matching http(s) Origin regardless of host locality', () => {
    expect(sameOriginRequest(request({ host: '127.0.0.1:19387', origin: 'http://127.0.0.1:19387' }))).toBe(true)
    expect(sameOriginRequest(request({ host: 'localhost:19387', origin: 'http://localhost:19387' }))).toBe(true)
    expect(sameOriginRequest(request({ host: 'vision.lan:8443', origin: 'https://vision.lan:8443' }))).toBe(true)
  })

  it('rejects an Origin that does not match the Host', () => {
    expect(sameOriginRequest(request({ host: '127.0.0.1:19387', origin: 'http://localhost:19387' }))).toBe(false)
    expect(sameOriginRequest(request({ host: '127.0.0.1:19387', origin: 'http://evil.example' }))).toBe(false)
    expect(sameOriginRequest(request({ host: '127.0.0.1:19387', origin: 'not a url' }))).toBe(false)
  })

  it('rejects non-http(s) Origin values such as custom app schemes', () => {
    // The Desktop shell forwards never carry Origin; a custom-scheme Origin
    // reaching this fence directly is not trusted evidence.
    expect(sameOriginRequest(request({ host: '127.0.0.1:19387', origin: 'dsh-app://app' }))).toBe(false)
  })

  it('keeps same-origin browser GETs working without an Origin header', () => {
    // Browsers attach Sec-Fetch-Site instead of Origin to same-origin GETs.
    expect(sameOriginRequest(request({ host: 'vision.lan:19387', 'sec-fetch-site': 'same-origin' }))).toBe(true)
    expect(sameOriginRequest(request({ host: 'vision.lan:19387', 'sec-fetch-site': 'none' }))).toBe(true)
  })

  it('requires origin evidence on non-loopback hosts', () => {
    expect(sameOriginRequest(request({ host: 'vision.lan:19387' }))).toBe(false)
    expect(sameOriginRequest(request({}))).toBe(false)
    expect(sameOriginRequest(request({ host: 'not a host' }))).toBe(false)
  })

  it('recognizes every 127.x.x.x loopback literal', () => {
    expect(sameOriginRequest(request({ host: '127.0.0.1:8080' }))).toBe(true)
    expect(sameOriginRequest(request({ host: '127.56.78.90:8080' }))).toBe(true)
    // 127.0.0.999 is not a valid octet literal and must not be trusted.
    expect(sameOriginRequest(request({ host: '127.0.0.999:8080' }))).toBe(false)
    // WHATWG normalizes the shorthand quad 127.0.0 to 127.0.0.0 — loopback.
    expect(sameOriginRequest(request({ host: '127.0.0:8080' }))).toBe(true)
  })
})
