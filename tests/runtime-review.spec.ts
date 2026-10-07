import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Credentials } from '@deepseek-ai/dsh-credentials'
import { resolveConfig, type VisionToolkitConfig } from '../src/config.ts'
import { Semaphore, VisionToolkitRuntime } from '../src/runtime.ts'
import { UpstreamAdapter, type UpstreamRunResult } from '../src/upstream.ts'

// Only the byte-budget test changes metadata, avoiding a 512 MiB allocation.
vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return { ...actual, lstat: vi.fn(actual.lstat) }
})

const roots: string[] = []
const contexts: Context[] = []
const signal = new AbortController().signal
const ok = (stdout = 'fixture answer'): UpstreamRunResult => ({
  stdout, stderr: '', stdoutTruncated: false, stderrTruncated: false,
  outcome: { exitCode: 0, signal: null },
})

async function setup(workspace?: string, overrides: VisionToolkitConfig = {}) {
  const root = workspace ?? await mkdtemp(join(tmpdir(), 'dsh-vision-runtime-review-'))
  if (workspace === undefined) roots.push(root)
  const ctx = new Context()
  contexts.push(ctx)
  ctx.provide('credentials', {
    resolve: async () => ({ value: 'fixture-key', source: 'env' }),
  } as unknown as Credentials)
  const config = resolveConfig({
    provider: { baseUrl: 'https://fixture.invalid/v1', credential: 'FIXTURE', model: 'fixture-model' },
    maxImageBytes: 1024,
    ...overrides,
  })
  const adapter = new UpstreamAdapter(ctx, config, {
    source: 'external', root, cleanHome: root,
    python: { program: 'unused-fixture-python', prefix: [], display: 'unused-fixture-python' },
    pythonVersion: 'fixture', dependencies: {},
  })
  vi.spyOn(adapter, 'probeImageSize').mockResolvedValue({ width: 8, height: 8, format: 'png', mode: 'RGBA' })
  const compress = vi.spyOn(adapter, 'compressImage').mockImplementation(async (input, output) => {
    const bytes = (await readFile(input)).subarray(0, 64)
    await writeFile(output, bytes)
    return {
      bytes: bytes.length, width: 8, height: 8, format: 'png', mode: 'RGBA',
      lossy: false, resized: false, candidate: 'fixture', sourceAnimated: false,
    }
  })
  const run = vi.spyOn(adapter, 'run').mockImplementation(async (_tool, args) => {
    for (const path of args.filter(path => path.endsWith('.png'))) await readFile(path)
    return ok()
  })
  vi.spyOn(adapter, 'findChrome').mockResolvedValue(undefined)
  return { workspace: root, ctx, adapter, config, compress, run, runtime: new VisionToolkitRuntime(ctx, config, adapter) }
}

async function input(workspace: string, name: string, byte: number): Promise<string> {
  const path = join(workspace, name)
  await writeFile(path, Buffer.alloc(2048, byte))
  return path
}

async function seedCache(workspace: string, count: number): Promise<string> {
  const root = join(workspace, '.dsh-vision-toolkit', 'tmp', 'compressed-images')
  await mkdir(root, { recursive: true })
  const bytes = Buffer.from('old cached fixture')
  const digest = createHash('sha256').update(bytes).digest('hex').slice(0, 16)
  await Promise.all(Array.from({ length: count }, async (_value, index) => {
    const path = join(root, `v2-${index.toString(16).padStart(16, '0')}-b1024-p20000000-${digest}-8x8.png`)
    await writeFile(path, bytes)
    const timestamp = new Date(Date.now() - 3600000 + index * 1000)
    await utimes(path, timestamp, timestamp)
  }))
  return root
}

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>(done => { resolve = done })
  return { promise, resolve }
}

afterEach(async () => {
  vi.restoreAllMocks()
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
  vi.mocked(lstat).mockImplementation(actual.lstat)
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('runtime review regressions', () => {
  it('R07 keeps new entries at the 200-entry cap and reuses them on the next call', async () => {
    const { runtime, workspace, compress } = await setup()
    await input(workspace, 'new.png', 1)
    const cache = await seedCache(workspace, 200)
    const before = (await readdir(cache)).sort()
    const first = await runtime.glance({ images: ['new.png'] }, { signal, workspace })
    const second = await runtime.glance({ images: ['new.png'] }, { signal, workspace })
    expect(second).toEqual(first)
    expect(compress).toHaveBeenCalledTimes(1)
    const after = await readdir(cache)
    expect(after).toHaveLength(200)
    expect(after).toContain(basename(first.images[0]!.path))
    expect(after).not.toContain(before[0])
    expect(after).toContain(before.at(-1))
  })

  it('R07 evicts old byte-budget entries instead of the newly compressed file', async () => {
    const { runtime, workspace } = await setup()
    await input(workspace, 'new.png', 2)
    const cache = await seedCache(workspace, 1)
    const old = join(cache, (await readdir(cache))[0]!)
    const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
    vi.mocked(lstat).mockImplementation(async (...args: Parameters<typeof lstat>) => {
      const info = await actual.lstat(...args)
      if (String(args[0]) === old) Object.assign(info, { size: 512 * 1024 * 1024 })
      return info
    })
    const result = await runtime.glance({ images: ['new.png'] }, { signal, workspace })
    expect(await readdir(cache)).toEqual([basename(result.images[0]!.path)])
    await expect(readFile(result.images[0]!.path)).resolves.toHaveLength(64)
  })

  it('R07 protects earlier images throughout a multi-image operation under cache churn', async () => {
    const { runtime, workspace, compress } = await setup()
    await input(workspace, 'first.png', 3)
    await input(workspace, 'second.png', 4)
    const cache = await seedCache(workspace, 199)
    compress.mockImplementation(async (source, output) => {
      const bytes = (await readFile(source)).subarray(0, 64)
      await writeFile(output, bytes)
      // Both new entries appear older than the existing cache, so sorting
      // alone cannot protect the first path returned to this operation.
      await utimes(output, new Date(0), new Date(0))
      return { bytes: 64, width: 8, height: 8, format: 'png', mode: 'RGBA',
        lossy: false, resized: false, candidate: 'fixture', sourceAnimated: false }
    })
    const result = await runtime.glance({ images: ['first.png', 'second.png'] }, { signal, workspace })
    expect(result.images).toHaveLength(2)
    expect(await readdir(cache)).toHaveLength(200)
  })

  it('R07 refcounts in-flight cache hits across runtimes and releases pins after failure', async () => {
    const first = await setup()
    await input(first.workspace, 'same.png', 5)
    const cache = await seedCache(first.workspace, 0)
    const enteredFirst = deferred()
    const releaseFirst = deferred()
    let path = ''
    first.run.mockImplementationOnce(async (_tool, args) => {
      path = args[0]!
      await utimes(path, new Date(0), new Date(0))
      enteredFirst.resolve()
      await releaseFirst.promise
      return ok()
    })
    const pendingFirst = first.runtime.glance({ images: ['same.png'] }, { signal, workspace: first.workspace })
    await enteredFirst.promise
    const second = await setup(first.workspace)
    const enteredSecond = deferred()
    const releaseSecond = deferred()
    second.run.mockImplementationOnce(async (_tool, args) => {
      expect(args[0]).toBe(path)
      enteredSecond.resolve()
      await releaseSecond.promise
      await readFile(path)
      throw new Error('fixture failure after read')
    })
    const pendingSecond = second.runtime.glance({ images: ['same.png'] }, { signal, workspace: first.workspace })
      .then(() => undefined, error => error)
    await enteredSecond.promise
    try {
      expect(second.compress).not.toHaveBeenCalled()
      releaseFirst.resolve()
      await pendingFirst
      await seedCache(first.workspace, 200)
      const third = await setup(first.workspace)
      await input(first.workspace, 'different.png', 6)
      await third.runtime.glance({ images: ['different.png'] }, { signal, workspace: first.workspace })
      await expect(readFile(path)).resolves.toHaveLength(64)
    } finally {
      releaseFirst.resolve()
      releaseSecond.resolve()
      await pendingFirst
      expect(await pendingSecond).toMatchObject({ code: 'runtime' })
    }
    // A later prune may now remove the failed operation's unpinned entry.
    await seedCache(first.workspace, 200)
    const fourth = await setup(first.workspace)
    await fourth.runtime.glance({ images: ['different.png'] }, { signal, workspace: first.workspace })
    await expect(readFile(path)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readdir(cache)).toHaveLength(200)
  })

  it.skipIf(process.platform !== 'win32').each([1024, 4096])('R08 rejects case aliases for crop, both previews, and foreground with byte limit %d', async (maxImageBytes) => {
    const { runtime, workspace, adapter, run } = await setup(undefined, { maxImageBytes })
    const artifacts = join(workspace, '.dsh-vision-toolkit', 'artifacts')
    await mkdir(artifacts, { recursive: true })
    const original = await input(artifacts, 'original.png', 7)
    run.mockResolvedValue(ok('no elements detected'))
    const render = vi.spyOn(adapter, 'renderAnnotatedPreview')
    const options = { signal, workspace }
    for (const output of ['original.png', 'ORIGINAL.png']) {
      await expect(runtime.crop({ image: original, region: '0,0,4,4', output }, options)).rejects.toMatchObject({ code: 'input' })
      await expect(runtime.ground({ image: original, target: 'x', preview: true, previewOutput: output }, options)).rejects.toMatchObject({ code: 'input' })
      await expect(runtime.detect({ image: original, target: 'x', preview: true, previewOutput: output }, options)).rejects.toMatchObject({ code: 'input' })
      await expect(runtime.extractForeground({ image: original, output }, options)).rejects.toMatchObject({ code: 'input' })
    }
    expect(render).not.toHaveBeenCalled()
    run.mockImplementationOnce(async (_tool, args) => {
      const output = args[args.indexOf('-o') + 1]!
      await writeFile(output, 'distinct output')
      return ok(`wrote ${output} (8x8)`)
    })
    await expect(runtime.crop({ image: original, region: '0,0,4,4', output: 'sibling.png' }, options))
      .resolves.toMatchObject({ width: 8, height: 8 })
    await expect(readFile(original)).resolves.toEqual(Buffer.alloc(2048, 7))
  })

  it('R02 health rejects redirects without forwarding fixture keys or routing headers', async () => {
    const received: unknown[] = []
    const destination = createServer((req, res) => { received.push(req.headers); res.end('{}') })
    await new Promise<void>(resolve => destination.listen(0, '127.0.0.1', resolve))
    const address = destination.address()
    if (address === null || typeof address === 'string') throw new Error('missing destination')
    const source = createServer((_req, res) => {
      res.writeHead(302, { Location: `http://127.0.0.1:${address.port}/outside` })
      res.end()
    })
    await new Promise<void>(resolve => source.listen(0, '127.0.0.1', resolve))
    try {
      const from = source.address()
      if (from === null || typeof from === 'string') throw new Error('missing source')
      const { runtime, workspace } = await setup(undefined, { provider: {
        baseUrl: `http://127.0.0.1:${from.port}/v1`, credential: 'FIXTURE', model: 'fixture-model',
        protocol: 'anthropic', headers: { 'x-route': 'fixture-route' },
      } })
      await expect(runtime.health(true, { signal, workspace })).resolves.toMatchObject({ checks: { service: { status: 'error' } } })
      expect(received).toEqual([])
    } finally {
      await Promise.all([source, destination].map(server => new Promise<void>(resolve => server.close(() => resolve()))))
    }
  })

  it('R22 admits a lightweight runtime call after cancelling a queued jobs=3 OCR head', async () => {
    const { runtime, workspace, run } = await setup(undefined, { concurrency: 3, maxImageBytes: 4096 })
    await input(workspace, 'source.png', 9)
    const entered = deferred()
    const release = deferred()
    run.mockImplementationOnce(async () => {
      entered.resolve()
      await release.promise
      return ok()
    })
    const options = { signal, workspace, sessionId: 'weighted-session' }
    const active = runtime.glance({ images: ['source.png'] }, options)
    await entered.promise
    const head = new AbortController()
    const heavy = runtime.longScreenshotOcr({ image: 'source.png', jobs: 3 }, { ...options, signal: head.signal })
      .catch(error => error)
    const follower = runtime.glance({ images: ['source.png'] }, options)
    try {
      head.abort()
      // The active operation still owns its slot; no release can wake this.
      await expect(follower).resolves.toMatchObject({ answer: 'fixture answer' })
      expect(await heavy).toMatchObject({ code: 'cancelled' })
      expect(run).toHaveBeenCalledTimes(2)
    } finally {
      release.resolve()
      await active
    }
  })

  it('R22 immediately drains a lightweight follower when the weighted head aborts', async () => {
    const semaphore = new Semaphore(3)
    await semaphore.acquire(signal)
    const head = new AbortController()
    const heavy = semaphore.acquire(head.signal, 3).catch(error => error)
    let started = false
    const follower = semaphore.acquire(signal).then(() => { started = true })
    head.abort()
    await new Promise<void>(resolve => setImmediate(resolve))
    expect(started).toBe(true)
    expect(await heavy).toMatchObject({ code: 'cancelled' })
    await follower
    semaphore.release()
    semaphore.release()
    expect(semaphore.idle).toBe(true)
  })
})
