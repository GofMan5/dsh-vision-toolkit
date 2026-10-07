import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { access, chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { SubprocessHandle, SubprocessOutputRead, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  compareVersions,
  gitInstallSource,
  PLUGIN_RESTART_HELPER_SOURCE,
  VisionToolkitPluginUpdateService,
  VISION_TOOLKIT_PACKAGE,
} from '../src/plugin-update.ts'

vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return { ...actual, access: vi.fn(actual.access) }
})

const roots: string[] = []

afterEach(async () => {
  vi.mocked(access).mockReset()
  vi.mocked(access).mockImplementation((await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')).access)
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

function output(text: string): SubprocessOutputRead {
  return { text, nextOffset: Buffer.byteLength(text), lossy: false }
}

class FakeSubprocess {
  readonly spawns: SubprocessSpawnSpec[] = []
  readonly resolveExecutable = vi.fn(async () => '/usr/local/bin/pnpm')

  constructor(
    private readonly run: (spec: SubprocessSpawnSpec) => Promise<{ stdout?: string; stderr?: string; exitCode?: number }>,
  ) {}

  spawn = (spec: SubprocessSpawnSpec): SubprocessHandle => {
    this.spawns.push(spec)
    const result = this.run(spec)
    const collected = {
      stdout: { readFrom: () => output('') },
      stderr: { readFrom: () => output('') },
    }
    const handle: SubprocessHandle = {
      pid: this.spawns.length,
      stdin: undefined,
      stdout: undefined,
      stderr: undefined,
      collected,
      done: result.then((value) => {
        const stdout = value.stdout ?? ''
        const stderr = value.stderr ?? ''
        Object.assign(collected, {
          stdout: { readFrom: () => output(stdout) },
          stderr: { readFrom: () => output(stderr) },
        })
        return { exitCode: value.exitCode ?? 0, signal: null }
      }),
      terminate: () => {},
      waitForExit: () => Promise.resolve(true),
    }
    return handle
  }
}

async function profileFixture(spec = '0.1.0') {
  const root = await mkdtemp(join(tmpdir(), 'dvt-plugin-update-'))
  roots.push(root)
  const profileDir = join(root, 'profiles', 'web')
  const installedDir = join(profileDir, 'node_modules', '@gofman5', 'dsh-vision-toolkit')
  await mkdir(installedDir, { recursive: true })
  await writeFile(join(profileDir, 'package.json'), JSON.stringify({
    name: 'dsh-profile-web',
    private: true,
    dependencies: { [VISION_TOOLKIT_PACKAGE]: spec },
  }))
  await writeFile(join(installedDir, 'package.json'), JSON.stringify({
    name: VISION_TOOLKIT_PACKAGE,
    version: '0.1.0',
  }))
  return { profileDir, installedDir }
}

function host(subprocess: FakeSubprocess): Pick<Context, 'subprocess'> {
  return { subprocess: subprocess as unknown as Context['subprocess'] }
}

describe('plugin update version ordering', () => {
  it('orders stable and prerelease SemVer versions correctly', () => {
    expect(compareVersions('0.1.10', '0.1.9')).toBeGreaterThan(0)
    expect(compareVersions('1.0.0', '1.0.0-rc.1')).toBeGreaterThan(0)
    expect(compareVersions('1.0.0-rc.2', '1.0.0-rc.10')).toBeLessThan(0)
    expect(compareVersions('v1.2.3', '1.2.3')).toBe(0)
  })
})

describe('git install source parsing', () => {
  it('parses github shorthand and git+https specs, ignoring refs and .git suffixes', () => {
    expect(gitInstallSource('github:GofMan5/dsh-vision-toolkit')).toEqual({
      baseSpec: 'github:GofMan5/dsh-vision-toolkit',
      owner: 'GofMan5',
      repo: 'dsh-vision-toolkit',
    })
    expect(gitInstallSource('github:GofMan5/dsh-vision-toolkit#0cd35b1d75fc4514e19d195f93e69f506f5fbaa9')).toEqual({
      baseSpec: 'github:GofMan5/dsh-vision-toolkit',
      owner: 'GofMan5',
      repo: 'dsh-vision-toolkit',
    })
    expect(gitInstallSource('git+https://github.com/GofMan5/dsh-vision-toolkit.git')).toEqual({
      baseSpec: 'git+https://github.com/GofMan5/dsh-vision-toolkit.git',
      owner: 'GofMan5',
      repo: 'dsh-vision-toolkit',
    })
    expect(gitInstallSource('git+https://github.com/GofMan5/dsh-vision-toolkit')).toEqual({
      baseSpec: 'git+https://github.com/GofMan5/dsh-vision-toolkit.git',
      owner: 'GofMan5',
      repo: 'dsh-vision-toolkit',
    })
  })

  it('rejects local, workspace, and non-GitHub sources', () => {
    expect(gitInstallSource('link:/workspace/dsh-vision-toolkit')).toBeUndefined()
    expect(gitInstallSource('file:./plugin')).toBeUndefined()
    expect(gitInstallSource('./plugin')).toBeUndefined()
    expect(gitInstallSource('git+ssh://git@github.com/GofMan5/dsh-vision-toolkit.git')).toBeUndefined()
    expect(gitInstallSource('git+https://gitlab.com/GofMan5/dsh-vision-toolkit.git')).toBeUndefined()
    expect(gitInstallSource('@gofman5/dsh-vision-toolkit')).toBeUndefined()
  })
})

describe('git installation updates', () => {
  const HEAD_COMMIT = '1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d'
  const rawManifest = (version: string): Response => new Response(JSON.stringify({
    name: VISION_TOOLKIT_PACKAGE,
    version,
  }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  const headCommits = (sha: string): Response => new Response(JSON.stringify([{ sha }]), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })

  it('supports git installs, checks GitHub for the head, and installs the pinned commit', async () => {
    const fixture = await profileFixture('github:GofMan5/dsh-vision-toolkit')
    const subprocess = new FakeSubprocess(async (spec) => {
      // The `add` spawn simulates pnpm resolving the pinned commit.
      if (spec.argv.some(part => String(part).includes('github:GofMan5/dsh-vision-toolkit#'))) {
        await writeFile(join(fixture.installedDir, 'package.json'), JSON.stringify({
          name: VISION_TOOLKIT_PACKAGE,
          version: '0.4.0',
        }))
        return { stdout: 'updated\n' }
      }
      return { stdout: '' }
    })
    const prepareRestart = vi.fn()
    const terminateCurrent = vi.fn()
    const schedule = vi.fn((callback: () => void) => { callback() })
    const service = new VisionToolkitPluginUpdateService(host(subprocess), '0.1.0', {
      profileDir: fixture.profileDir,
      packageRoot: fixture.installedDir,
      argv: ['web'],
      allowDetachedRestart: true,
      platform: 'linux',
      prepareRestart,
      terminateCurrent,
      schedule,
    })

    await expect(service.capability()).resolves.toMatchObject({
      supported: true,
      checkSupported: true,
      profile: 'web',
      dependencySpec: 'github:GofMan5/dsh-vision-toolkit',
    })

    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const target = String(url)
      if (target.startsWith('https://api.github.com/repos/GofMan5/dsh-vision-toolkit/commits')) return headCommits(HEAD_COMMIT)
      if (target.startsWith(`https://raw.githubusercontent.com/GofMan5/dsh-vision-toolkit/${HEAD_COMMIT}/package.json`)) return rawManifest('0.4.0')
      throw new Error(`unexpected fetch ${target}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const check = await service.check()
    expect(check).toMatchObject({
      supported: true,
      currentVersion: '0.1.0',
      latestVersion: '0.4.0',
      latestCommit: HEAD_COMMIT,
      updateAvailable: true,
    })

    // The install pins the resolved commit so pnpm never reuses the stale
    // floating-spec resolution.
    const install = await service.installAndRestart('0.4.0')
    expect(install).toMatchObject({ fromVersion: '0.1.0', toVersion: '0.4.0', profile: 'web', restarting: true })
    const installSpawn = subprocess.spawns.find(spec =>
      spec.argv.some(part => String(part).includes('github:GofMan5/dsh-vision-toolkit#')))
    expect(installSpawn).toBeDefined()
    expect(JSON.stringify(installSpawn?.argv)).toContain(HEAD_COMMIT)
    expect(JSON.stringify(installSpawn?.argv)).not.toContain('--save-exact')
    vi.unstubAllGlobals()
  })

  it('checks the selected GitHub source when the profile is read-only', async () => {
    const fixture = await profileFixture('github:GofMan5/dsh-vision-toolkit')
    const subprocess = new FakeSubprocess(async () => ({ stdout: '"0.1.1"\n' }))
    const service = new VisionToolkitPluginUpdateService(host(subprocess), '0.1.0', {
      profileDir: fixture.profileDir,
      packageRoot: fixture.installedDir,
      argv: ['web'],
    })
    vi.mocked(access).mockRejectedValue(Object.assign(new Error('read-only fixture'), { code: 'EACCES' }))
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const target = String(url)
      if (target === 'https://api.github.com/repos/GofMan5/dsh-vision-toolkit/commits?per_page=1') return headCommits(HEAD_COMMIT)
      if (target === `https://raw.githubusercontent.com/GofMan5/dsh-vision-toolkit/${HEAD_COMMIT}/package.json`) return rawManifest('0.4.0')
      throw new Error(`unexpected fetch ${target}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(service.check()).resolves.toMatchObject({
      supported: false,
      checkSupported: true,
      reason: 'profile-read-only',
      dependencySpec: 'github:GofMan5/dsh-vision-toolkit',
      currentVersion: '0.1.0',
      latestVersion: '0.4.0',
      latestCommit: HEAD_COMMIT,
      updateAvailable: true,
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(subprocess.spawns).toHaveLength(0)
    await expect(service.installAndRestart('0.4.0')).rejects.toMatchObject({ code: 'update-unavailable' })
    expect(subprocess.spawns).toHaveLength(0)
  })

  it('reports already-current when the GitHub head matches the installed version', async () => {
    const fixture = await profileFixture('github:GofMan5/dsh-vision-toolkit')
    const subprocess = new FakeSubprocess(async () => ({ stdout: '' }))
    const service = new VisionToolkitPluginUpdateService(host(subprocess), '0.4.0', {
      profileDir: fixture.profileDir,
      packageRoot: fixture.installedDir,
      argv: ['web'],
    })
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const target = String(url)
      if (target.startsWith('https://api.github.com/repos/GofMan5/dsh-vision-toolkit/commits')) return headCommits(HEAD_COMMIT)
      return rawManifest('0.4.0')
    })
    vi.stubGlobal('fetch', fetchMock)

    const check = await service.check()
    expect(check.updateAvailable).toBe(false)
    expect(check.latestVersion).toBe('0.4.0')

    await expect(service.installAndRestart('0.4.0')).rejects.toMatchObject({ code: 'already-current' })
    vi.unstubAllGlobals()
  })

  it('turns GitHub check failures into actionable update-check-failed errors', async () => {
    const fixture = await profileFixture('github:GofMan5/dsh-vision-toolkit')
    const subprocess = new FakeSubprocess(async () => ({ stdout: '' }))
    const service = new VisionToolkitPluginUpdateService(host(subprocess), '0.1.0', {
      profileDir: fixture.profileDir,
      packageRoot: fixture.installedDir,
      argv: ['web'],
    })
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const target = String(url)
      if (target.startsWith('https://api.github.com/repos/')) {
        return new Response('rate limited', { status: 403 })
      }
      return rawManifest('0.4.0')
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(service.check()).rejects.toMatchObject({
      code: 'update-check-failed',
      message: expect.stringContaining('HTTP 403'),
    })
    vi.unstubAllGlobals()
  })
})

describe('VisionToolkitPluginUpdateService', () => {
  it('does not overwrite a local link installation', async () => {
    const fixture = await profileFixture('link:/workspace/dsh-vision-toolkit')
    const subprocess = new FakeSubprocess(async () => ({ stdout: '' }))
    const service = new VisionToolkitPluginUpdateService(host(subprocess), '0.1.0', {
      profileDir: fixture.profileDir,
      packageRoot: fixture.installedDir,
      argv: ['web'],
      allowDetachedRestart: true,
    })

    await expect(service.capability()).resolves.toEqual({
      supported: false,
      checkSupported: true,
      profile: 'web',
      dependencySpec: 'link:/workspace/dsh-vision-toolkit',
      reason: 'unsupported-install-source',
    })
    expect(subprocess.resolveExecutable).toHaveBeenCalledWith('pnpm')
  })

  it('supports installing from a detached Web process and leaves restart to the user', async () => {
    const fixture = await profileFixture()
    const subprocess = new FakeSubprocess(async () => ({ stdout: '' }))
    const service = new VisionToolkitPluginUpdateService(host(subprocess), '0.1.0', {
      profileDir: fixture.profileDir,
      packageRoot: fixture.installedDir,
      argv: ['web'],
    })

    await expect(service.capability()).resolves.toMatchObject({
      supported: true,
      profile: 'web',
    })
    expect(subprocess.resolveExecutable).toHaveBeenCalledWith('pnpm')
  })

  it('still supports installation when DSH Web uses a dynamically allocated port', async () => {
    const fixture = await profileFixture()
    const subprocess = new FakeSubprocess(async () => ({ stdout: '' }))
    const service = new VisionToolkitPluginUpdateService(host(subprocess), '0.1.0', {
      profileDir: fixture.profileDir,
      packageRoot: fixture.installedDir,
      argv: ['web', '--port', '0'],
      allowDetachedRestart: true,
    })

    await expect(service.capability()).resolves.toMatchObject({ supported: true, checkSupported: true })
  })

  it('falls back to manual restart when the active WebServer port cannot be reproduced', async () => {
    const fixture = await profileFixture()
    const subprocess = new FakeSubprocess(async () => ({ stdout: '' }))
    const service = new VisionToolkitPluginUpdateService(host(subprocess), '0.1.0', {
      profileDir: fixture.profileDir,
      packageRoot: fixture.installedDir,
      argv: ['web'],
      allowDetachedRestart: true,
    })

    service.configureWebServer('0.0.0.0', 8080)
    await expect(service.capability()).resolves.toMatchObject({ supported: true })
  })

  it('uses the active WebServer address when it matches an explicit fixed port', async () => {
    const fixture = await profileFixture()
    const subprocess = new FakeSubprocess(async () => ({ stdout: '' }))
    const service = new VisionToolkitPluginUpdateService(host(subprocess), '0.1.0', {
      profileDir: fixture.profileDir,
      packageRoot: fixture.installedDir,
      argv: ['web', '--host', '0.0.0.0', '--port', '8080'],
      allowDetachedRestart: true,
    })

    service.configureWebServer('0.0.0.0', 8080)
    await expect(service.capability()).resolves.toMatchObject({ supported: true })
  })

  it('supports installation on Windows even though automatic restart is unavailable', async () => {
    const fixture = await profileFixture()
    const subprocess = new FakeSubprocess(async () => ({ stdout: '' }))
    const service = new VisionToolkitPluginUpdateService(host(subprocess), '0.1.0', {
      profileDir: fixture.profileDir,
      packageRoot: fixture.installedDir,
      argv: ['web'],
      allowDetachedRestart: true,
      platform: 'win32',
    })

    await expect(service.capability()).resolves.toMatchObject({ supported: true, profile: 'web' })
  })

  it.each(['CMD', 'bat'])('routes Windows pnpm %s shims through a Node launcher', async extension => {
    const fixture = await profileFixture()
    const subprocess = new FakeSubprocess(async () => ({ stdout: '"0.2.0"\n' }))
    const pnpmPath = `C:\\Users\\space folder\\pnpm.${extension}`
    subprocess.resolveExecutable.mockResolvedValue(pnpmPath)
    const service = new VisionToolkitPluginUpdateService(host(subprocess), '0.1.0', {
      profileDir: fixture.profileDir,
      packageRoot: fixture.installedDir,
      argv: ['web'],
      platform: 'win32',
    })

    await expect(service.check()).resolves.toMatchObject({ latestVersion: '0.2.0' })
    expect(subprocess.spawns[0]?.argv).toEqual([
      process.execPath, '-e', expect.any(String), pnpmPath,
      'view', VISION_TOOLKIT_PACKAGE, 'version', '--json',
    ])
  })

  it.skipIf(process.platform !== 'win32')('executes a harmless pnpm.cmd under a path with spaces and shell metacharacters', async () => {
    const fixture = await profileFixture()
    const shimDir = join(fixture.profileDir, 'space folder & (shim)^ %DVT_SHIM_PATH% !')
    await mkdir(shimDir)
    const pnpmPath = join(shimDir, 'fake-pnpm.CMD')
    const observedPath = join(shimDir, 'observed.json')
    const entryPath = join(shimDir, 'fake-pnpm.cjs')
    await writeFile(entryPath, `
const { writeFileSync } = require('node:fs')
writeFileSync(${JSON.stringify(observedPath)}, JSON.stringify(process.argv.slice(2)))
console.log(JSON.stringify('0.2.0'))
`)
    await writeFile(pnpmPath, `@echo off\r\n"${process.execPath}" "%~dp0fake-pnpm.cjs" %*\r\n`)
    vi.stubEnv('DVT_SHIM_PATH', 'must-not-expand')
    const subprocess = new FakeSubprocess(async spec => {
      const child = spawn(spec.argv[0]!, spec.argv.slice(1), {
        cwd: spec.cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
        signal: spec.signal,
        windowsHide: true,
      })
      let stdout = ''
      let stderr = ''
      child.stdout?.on('data', chunk => { stdout += String(chunk) })
      child.stderr?.on('data', chunk => { stderr += String(chunk) })
      const [exitCode] = await once(child, 'close') as [number]
      return { stdout, stderr, exitCode }
    })
    subprocess.resolveExecutable.mockResolvedValue(pnpmPath)
    const service = new VisionToolkitPluginUpdateService(host(subprocess), '0.1.0', {
      profileDir: fixture.profileDir,
      packageRoot: fixture.installedDir,
      argv: ['web'],
    })

    await expect(service.check()).resolves.toMatchObject({ latestVersion: '0.2.0' })
    expect(JSON.parse(await readFile(observedPath, 'utf8'))).toEqual([
      'view', VISION_TOOLKIT_PACKAGE, 'version', '--json',
    ])
  })

  it('installs successfully without automatic restart and reports that a manual restart is required', async () => {
    const fixture = await profileFixture()
    const subprocess = new FakeSubprocess(async (spec) => {
      if (spec.argv.includes('view')) return { stdout: '"0.2.0"\n' }
      await writeFile(join(fixture.installedDir, 'package.json'), JSON.stringify({
        name: VISION_TOOLKIT_PACKAGE,
        version: '0.2.0',
      }))
      return { stdout: 'updated\n' }
    })
    const prepareRestart = vi.fn()
    const schedule = vi.fn()
    const service = new VisionToolkitPluginUpdateService(host(subprocess), '0.1.0', {
      profileDir: fixture.profileDir,
      packageRoot: fixture.installedDir,
      argv: ['web'],
      prepareRestart,
      schedule,
    })

    await expect(service.installAndRestart('0.2.0')).resolves.toEqual({
      fromVersion: '0.1.0',
      toVersion: '0.2.0',
      profile: 'web',
      restarting: false,
      manualRestartRequired: true,
    })
    expect(prepareRestart).not.toHaveBeenCalled()
    expect(schedule).not.toHaveBeenCalled()
  })

  it.each([false, true])('rejects repeat installs before a manual restart (lockfile: %s)', async hadLockfile => {
    const fixture = await profileFixture()
    const manifestPath = join(fixture.profileDir, 'package.json')
    const lockfilePath = join(fixture.profileDir, 'pnpm-lock.yaml')
    if (hadLockfile) await writeFile(lockfilePath, 'original-lockfile\n')
    let latestVersion = '0.2.0'
    const subprocess = new FakeSubprocess(async spec => {
      if (spec.argv.includes('view')) return { stdout: JSON.stringify(latestVersion) }
      if (latestVersion !== '0.2.0') throw new Error('repeat install must not run')
      await writeFile(manifestPath, JSON.stringify({ dependencies: { [VISION_TOOLKIT_PACKAGE]: latestVersion } }))
      await writeFile(lockfilePath, 'updated-lockfile\n')
      await writeFile(join(fixture.installedDir, 'package.json'), JSON.stringify({ version: latestVersion }))
      return { stdout: 'updated\n' }
    })
    const service = new VisionToolkitPluginUpdateService(host(subprocess), '0.1.0', {
      profileDir: fixture.profileDir,
      packageRoot: fixture.installedDir,
      argv: ['web'],
    })

    await expect(service.installAndRestart('0.2.0')).resolves.toMatchObject({ manualRestartRequired: true })
    latestVersion = '0.3.0'
    await expect(service.check()).resolves.toMatchObject({ currentVersion: '0.1.0', latestVersion: '0.3.0' })
    const spawnCount = subprocess.spawns.length
    const manifest = await readFile(manifestPath)
    const lockfile = await readFile(lockfilePath)
    for (const version of ['0.2.0', '0.3.0']) {
      await expect(service.installAndRestart(version)).rejects.toMatchObject({ code: 'restart-required' })
    }
    expect(subprocess.spawns).toHaveLength(spawnCount)
    expect(await readFile(manifestPath)).toEqual(manifest)
    expect(await readFile(lockfilePath)).toEqual(lockfile)
    await expect(readFile(join(fixture.installedDir, 'package.json'), 'utf8')).resolves.toContain('0.2.0')
    expect((await readdir(fixture.profileDir)).filter(name => name.startsWith('.dsh-vision-toolkit-update'))).toEqual([])
  })

  it('checks the configured registry through pnpm without mutating the profile', async () => {
    const fixture = await profileFixture()
    const subprocess = new FakeSubprocess(async () => ({ stdout: '"0.2.0"\n' }))
    const service = new VisionToolkitPluginUpdateService(host(subprocess), '0.1.0', {
      profileDir: fixture.profileDir,
      packageRoot: fixture.installedDir,
      argv: ['web'],
      allowDetachedRestart: true,
      now: () => new Date('2026-08-16T12:00:00.000Z'),
    })

    await expect(service.check()).resolves.toMatchObject({
      supported: true,
      profile: 'web',
      currentVersion: '0.1.0',
      latestVersion: '0.2.0',
      updateAvailable: true,
      checkedAt: '2026-08-16T12:00:00.000Z',
    })
    expect(subprocess.spawns[0]?.argv).toEqual([
      '/usr/local/bin/pnpm', 'view', VISION_TOOLKIT_PACKAGE, 'version', '--json',
    ])
  })

  it.skipIf(process.platform === 'win32')('updates only this package, verifies the installed version, and schedules a restart', async () => {
    const fixture = await profileFixture()
    const subprocess = new FakeSubprocess(async (spec) => {
      if (spec.argv.includes('view')) return { stdout: '"0.2.0"\n' }
      await writeFile(join(fixture.installedDir, 'package.json'), JSON.stringify({
        name: VISION_TOOLKIT_PACKAGE,
        version: '0.2.0',
      }))
      return { stdout: 'updated\n' }
    })
    const prepareRestart = vi.fn()
    const terminateCurrent = vi.fn()
    const schedule = vi.fn((callback: () => void) => { callback() })
    const service = new VisionToolkitPluginUpdateService(host(subprocess), '0.1.0', {
      profileDir: fixture.profileDir,
      packageRoot: fixture.installedDir,
      argv: ['web'],
      allowDetachedRestart: true,
      prepareRestart,
      terminateCurrent,
      schedule,
    })

    await expect(service.installAndRestart('0.2.0')).resolves.toMatchObject({
      fromVersion: '0.1.0',
      toVersion: '0.2.0',
      profile: 'web',
      restarting: true,
    })
    expect(subprocess.spawns[1]?.argv).toEqual([
      '/usr/local/bin/pnpm',
      'add',
      `${VISION_TOOLKIT_PACKAGE}@0.2.0`,
      '--save-exact',
      '--yes',
      '--reporter=append-only',
    ])
    expect(prepareRestart).toHaveBeenCalledTimes(1)
    expect(schedule).toHaveBeenCalledTimes(1)
    expect(terminateCurrent).toHaveBeenCalledTimes(1)
    await expect(service.installAndRestart('0.2.0')).rejects.toMatchObject({ code: 'update-in-progress' })
    expect(subprocess.spawns).toHaveLength(2)
  })

  it('rejects a stale confirmation instead of installing an unexpected release', async () => {
    const fixture = await profileFixture()
    const subprocess = new FakeSubprocess(async () => ({ stdout: '"0.2.1"\n' }))
    const service = new VisionToolkitPluginUpdateService(host(subprocess), '0.1.0', {
      profileDir: fixture.profileDir,
      packageRoot: fixture.installedDir,
      argv: ['web'],
      allowDetachedRestart: true,
    })

    await expect(service.installAndRestart('0.2.0')).rejects.toMatchObject({ code: 'update-stale' })
    await expect(service.installAndRestart('0.2.0')).rejects.toMatchObject({ code: 'update-stale' })
    expect(subprocess.spawns).toHaveLength(2)
  })

  it('rechecks the profile source instead of overwriting a link introduced after an earlier check', async () => {
    const fixture = await profileFixture()
    const subprocess = new FakeSubprocess(async () => ({ stdout: '"0.2.0"\n' }))
    const service = new VisionToolkitPluginUpdateService(host(subprocess), '0.1.0', {
      profileDir: fixture.profileDir,
      packageRoot: fixture.installedDir,
      argv: ['web'],
      allowDetachedRestart: true,
    })

    await expect(service.check()).resolves.toMatchObject({ supported: true, latestVersion: '0.2.0' })
    await writeFile(join(fixture.profileDir, 'package.json'), JSON.stringify({
      name: 'dsh-profile-web',
      private: true,
      dependencies: { [VISION_TOOLKIT_PACKAGE]: 'link:/workspace/dsh-vision-toolkit' },
    }))

    await expect(service.installAndRestart('0.2.0')).rejects.toMatchObject({ code: 'update-unavailable' })
    expect(subprocess.spawns).toHaveLength(1)
  })

  it('uses a profile lock to reject a concurrent updater in another service instance', async () => {
    const fixture = await profileFixture()
    let releaseView!: () => void
    const viewGate = new Promise<void>((resolve) => { releaseView = resolve })
    const firstSubprocess = new FakeSubprocess(async (spec) => {
      if (spec.argv.includes('view')) {
        await viewGate
        return { stdout: '"0.2.0"\n' }
      }
      await writeFile(join(fixture.installedDir, 'package.json'), JSON.stringify({
        name: VISION_TOOLKIT_PACKAGE,
        version: '0.2.0',
      }))
      return { stdout: 'updated\n' }
    })
    const first = new VisionToolkitPluginUpdateService(host(firstSubprocess), '0.1.0', {
      profileDir: fixture.profileDir,
      packageRoot: fixture.installedDir,
      argv: ['web'],
      allowDetachedRestart: true,
      prepareRestart: vi.fn(),
      terminateCurrent: vi.fn(),
      schedule: vi.fn(),
    })
    const running = first.installAndRestart('0.2.0')
    await vi.waitFor(() => { expect(firstSubprocess.spawns).toHaveLength(1) })

    const secondSubprocess = new FakeSubprocess(async () => ({ stdout: '"0.2.0"\n' }))
    const second = new VisionToolkitPluginUpdateService(host(secondSubprocess), '0.1.0', {
      profileDir: fixture.profileDir,
      packageRoot: fixture.installedDir,
      argv: ['web'],
      allowDetachedRestart: true,
    })
    await expect(second.installAndRestart('0.2.0')).rejects.toMatchObject({ code: 'update-in-progress' })
    expect(secondSubprocess.spawns).toHaveLength(0)

    releaseView()
    await expect(running).resolves.toMatchObject({ toVersion: '0.2.0' })
  })

  it('redacts registry credentials from command failures returned to Settings', async () => {
    const fixture = await profileFixture()
    const subprocess = new FakeSubprocess(async () => ({
      exitCode: 1,
      stderr: 'GET https://alice:secret@registry.example/?token=query-secret failed '
        + 'https://single-secret@registry.example/ npm_supersecret _authToken=token-value _auth=base64-secret',
    }))
    const service = new VisionToolkitPluginUpdateService(host(subprocess), '0.1.0', {
      profileDir: fixture.profileDir,
      packageRoot: fixture.installedDir,
      argv: ['web'],
      allowDetachedRestart: true,
    })

    const failure = await service.check().catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(Error)
    const message = (failure as Error).message
    expect(message).not.toContain('alice')
    expect(message).not.toContain('secret')
    expect(message).not.toContain('supersecret')
    expect(message).not.toContain('token-value')
    expect(message).not.toContain('query-secret')
    expect(message).not.toContain('single-secret')
    expect(message).not.toContain('base64-secret')
    expect(message).toContain('***')
  })

  it('restores the original manifest and lockfile after pnpm partially changes the profile then fails', async () => {
    const fixture = await profileFixture('^0.1.0')
    const manifestPath = join(fixture.profileDir, 'package.json')
    const lockfilePath = join(fixture.profileDir, 'pnpm-lock.yaml')
    const originalManifest = await readFile(manifestPath)
    const originalLockfile = Buffer.from('lockfileVersion: 9\noriginal: true\n')
    await writeFile(lockfilePath, originalLockfile)
    let addCalls = 0
    const subprocess = new FakeSubprocess(async (spec) => {
      if (spec.argv.includes('view')) return { stdout: '"0.2.0"\n' }
      addCalls += 1
      if (addCalls === 1) {
        await writeFile(manifestPath, JSON.stringify({ dependencies: { [VISION_TOOLKIT_PACKAGE]: '0.2.0' } }))
        await writeFile(lockfilePath, 'partially-updated: true\n')
        await writeFile(join(fixture.installedDir, 'package.json'), JSON.stringify({
          name: VISION_TOOLKIT_PACKAGE,
          version: '0.2.0',
        }))
        return { exitCode: 1, stderr: 'late lifecycle failure' }
      }
      await writeFile(join(fixture.installedDir, 'package.json'), JSON.stringify({
        name: VISION_TOOLKIT_PACKAGE,
        version: '0.1.0',
      }))
      return { stdout: 'restored\n' }
    })
    const service = new VisionToolkitPluginUpdateService(host(subprocess), '0.1.0', {
      profileDir: fixture.profileDir,
      packageRoot: fixture.installedDir,
      argv: ['web'],
      allowDetachedRestart: true,
      healthUrl: 'http://127.0.0.1:3080/_dsh/vision-toolkit/settings',
    })

    await expect(service.installAndRestart('0.2.0')).rejects.toMatchObject({ code: 'update-failed' })
    expect(addCalls).toBe(2)
    expect(await readFile(manifestPath)).toEqual(originalManifest)
    expect(await readFile(lockfilePath)).toEqual(originalLockfile)
    expect(subprocess.spawns.at(-1)?.argv).toEqual([
      '/usr/local/bin/pnpm', 'install', '--frozen-lockfile', '--reporter=append-only',
    ])
    await expect(readFile(join(fixture.installedDir, 'package.json'), 'utf8')).resolves.toContain('0.1.0')
    await expect(readFile(join(fixture.profileDir, '.dsh-vision-toolkit-update.lock')))
      .rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('preserves the recovery backup and lock when rollback cannot restore the installed package', async () => {
    const fixture = await profileFixture('^0.1.0')
    let addCalls = 0
    const subprocess = new FakeSubprocess(async (spec) => {
      if (spec.argv.includes('view')) return { stdout: '"0.2.0"\n' }
      addCalls += 1
      await writeFile(join(fixture.installedDir, 'package.json'), JSON.stringify({
        name: VISION_TOOLKIT_PACKAGE,
        version: '0.2.0',
      }))
      return addCalls === 1
        ? { exitCode: 1, stderr: 'install failed after mutation' }
        : { exitCode: 1, stderr: 'rollback failed' }
    })
    const service = new VisionToolkitPluginUpdateService(host(subprocess), '0.1.0', {
      profileDir: fixture.profileDir,
      packageRoot: fixture.installedDir,
      argv: ['web', '--port', '3080'],
      allowDetachedRestart: true,
    })

    const failure = await service.installAndRestart('0.2.0').catch((error: unknown) => error)
    expect(failure).toMatchObject({ code: 'update-rollback-failed' })
    expect((failure as Error).message).toContain('recovery files preserved at')
    const lock = JSON.parse(await readFile(join(fixture.profileDir, '.dsh-vision-toolkit-update.lock'), 'utf8')) as {
      token: string
    }
    await expect(readFile(join(
      fixture.profileDir,
      `.dsh-vision-toolkit-update-backup-${lock.token}`,
      'package.json',
    ))).resolves.toBeInstanceOf(Buffer)
  })

  it('refuses to restart when pnpm did not install the exact confirmed version', async () => {
    const fixture = await profileFixture()
    const subprocess = new FakeSubprocess(async (spec) => {
      if (spec.argv.includes('view')) return { stdout: '"0.2.0"\n' }
      const target = spec.argv.find(value => value.startsWith(`${VISION_TOOLKIT_PACKAGE}@`))
      await writeFile(join(fixture.installedDir, 'package.json'), JSON.stringify({
        name: VISION_TOOLKIT_PACKAGE,
        version: target?.endsWith('@0.1.0') === true ? '0.1.0' : '0.3.0',
      }))
      return { stdout: 'updated\n' }
    })
    const prepareRestart = vi.fn()
    const service = new VisionToolkitPluginUpdateService(host(subprocess), '0.1.0', {
      profileDir: fixture.profileDir,
      packageRoot: fixture.installedDir,
      argv: ['web'],
      allowDetachedRestart: true,
      prepareRestart,
    })

    await expect(service.installAndRestart('0.2.0')).rejects.toMatchObject({ code: 'update-verify-failed' })
    expect(prepareRestart).not.toHaveBeenCalled()
  })

  it.skipIf(process.platform === 'win32')('keeps the current Web process running when the restart helper does not acknowledge handoff', async () => {
    const fixture = await profileFixture('^0.1.0')
    let addCalls = 0
    const subprocess = new FakeSubprocess(async (spec) => {
      if (spec.argv.includes('view')) return { stdout: '"0.2.0"\n' }
      addCalls += 1
      const version = addCalls === 1 ? '0.2.0' : '0.1.0'
      await writeFile(join(fixture.installedDir, 'package.json'), JSON.stringify({
        name: VISION_TOOLKIT_PACKAGE,
        version,
      }))
      return { stdout: `${version}\n` }
    })
    const terminateCurrent = vi.fn()
    const schedule = vi.fn()
    const service = new VisionToolkitPluginUpdateService(host(subprocess), '0.1.0', {
      profileDir: fixture.profileDir,
      packageRoot: fixture.installedDir,
      argv: ['web', '--port', '3080'],
      allowDetachedRestart: true,
      prepareRestart: async () => { throw new Error('handoff failed') },
      terminateCurrent,
      schedule,
    })

    await expect(service.installAndRestart('0.2.0')).rejects.toMatchObject({ code: 'restart-failed' })
    expect(addCalls).toBe(2)
    expect(schedule).not.toHaveBeenCalled()
    expect(terminateCurrent).not.toHaveBeenCalled()
    await expect(readFile(join(fixture.profileDir, '.dsh-vision-toolkit-update.lock')))
      .rejects.toMatchObject({ code: 'ENOENT' })
  })
})

describe('plugin restart helper', () => {
  it.skipIf(process.platform === 'win32')('rolls back and restores service when the replacement exits before becoming ready', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dvt-restart-helper-'))
    roots.push(root)
    const statePath = join(root, 'version.txt')
    const pidPath = join(root, 'server.pid')
    const lockPath = join(root, '.update.lock')
    const lockToken = 'restart-helper-token'
    const backupDir = join(root, '.update-backup')
    const appPath = join(root, 'fake-dsh.cjs')
    const pnpmPath = join(root, 'fake-pnpm.cjs')
    const installedPackagePath = join(root, 'node_modules', '@gofman5', 'dsh-vision-toolkit', 'package.json')
    await writeFile(statePath, '0.2.0')
    await mkdir(dirname(installedPackagePath), { recursive: true })
    await writeFile(installedPackagePath, JSON.stringify({ name: VISION_TOOLKIT_PACKAGE, version: '0.2.0' }))
    await writeFile(lockPath, JSON.stringify({ pid: process.pid, token: lockToken }))
    await mkdir(backupDir)
    await writeFile(join(backupDir, 'package.json'), JSON.stringify({
      name: 'dsh-profile-web',
      dependencies: { [VISION_TOOLKIT_PACKAGE]: '0.1.0' },
    }))
    await writeFile(join(backupDir, 'metadata.json'), JSON.stringify({ hadLockfile: false, manifestMode: 0o644 }))
    await writeFile(appPath, `
const { readFileSync, writeFileSync } = require('node:fs')
const { createServer } = require('node:http')
const statePath = process.argv[2]
const port = Number(process.argv[3])
const pidPath = process.argv[4]
const version = readFileSync(statePath, 'utf8').trim()
const server = createServer((_req, res) => {
  const body = JSON.stringify({ ok: true, value: { release: { pluginVersion: version }, runtime: { ready: version !== '0.2.0' } } })
  res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': String(Buffer.byteLength(body)) })
  res.end(body)
})
server.listen(port, '127.0.0.1', () => { writeFileSync(pidPath, String(process.pid)) })
process.on('SIGTERM', () => { server.close(() => process.exit(0)) })
`)
    await writeFile(pnpmPath, `#!/usr/bin/env node
const { writeFileSync } = require('node:fs')
const target = process.argv.find(value => value.startsWith('@gofman5/dsh-vision-toolkit@'))
if (!target) process.exit(1)
const version = target.slice(target.lastIndexOf('@') + 1)
writeFileSync(process.env.DVT_RESTART_STATE, version)
writeFileSync(process.env.DVT_INSTALLED_PACKAGE, JSON.stringify({ name: '@gofman5/dsh-vision-toolkit', version }))
`)
    await chmod(pnpmPath, 0o755)

    const probe = createServer()
    await new Promise<void>((resolve, reject) => {
      probe.once('error', reject)
      probe.listen(0, '127.0.0.1', resolve)
    })
    const address = probe.address()
    if (address === null || typeof address === 'string') throw new Error('probe did not bind')
    const port = address.port
    await new Promise<void>(resolve => { probe.close(() => { resolve() }) })

    const payload = Buffer.from(JSON.stringify({
      pid: 999_999,
      execPath: process.execPath,
      args: [appPath, statePath, String(port), pidPath],
      cwd: root,
      logPath: join(root, 'restart.log'),
      lockPath,
      lockToken,
      backupDir,
      handoffPath: join(backupDir, 'handoff.json'),
      profileDir: root,
      pnpmPath,
      packageName: VISION_TOOLKIT_PACKAGE,
      fromVersion: '0.1.0',
      toVersion: '0.2.0',
      healthUrl: `http://127.0.0.1:${port}/_dsh/vision-toolkit/settings`,
      baselineRuntimeReady: true,
      rollbackTimeoutMs: 5_000,
      processKillGraceMs: 100,
      readinessTimeoutMs: 1_500,
      oldProcessExitTimeoutMs: 1_000,
    })).toString('base64url')
    const helper = spawn(process.execPath, ['-e', PLUGIN_RESTART_HELPER_SOURCE, payload], {
      cwd: root,
      env: { ...process.env, DVT_RESTART_STATE: statePath, DVT_INSTALLED_PACKAGE: installedPackagePath },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stderr = ''
    helper.stderr?.on('data', chunk => { stderr += String(chunk) })
    const [code] = await once(helper, 'exit') as [number | null]
    expect(code, stderr).toBe(2)
    expect(await readFile(statePath, 'utf8')).toBe('0.1.0')
    await vi.waitFor(async () => {
      expect(Number(await readFile(pidPath, 'utf8'))).toBeGreaterThan(0)
    })
    const restored = await fetch(`http://127.0.0.1:${port}/_dsh/vision-toolkit/settings`)
    await expect(restored.json()).resolves.toMatchObject({
      ok: true,
      value: { release: { pluginVersion: '0.1.0' } },
    })
    const restoredPid = Number(await readFile(pidPath, 'utf8'))
    process.kill(restoredPid, 'SIGTERM')
    await vi.waitFor(async () => {
      await expect(readFile(lockPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    })
    await expect(readFile(join(backupDir, 'metadata.json'))).rejects.toMatchObject({ code: 'ENOENT' })
  }, 15_000)

  it.skipIf(process.platform === 'win32')('keeps the helper-owned profile lock and times out a hung rollback pnpm process', async () => {
    const fixture = await profileFixture()
    const root = dirname(dirname(fixture.profileDir))
    const statePath = join(root, 'version.txt')
    const lockPath = join(fixture.profileDir, '.dsh-vision-toolkit-update.lock')
    const lockToken = 'handoff-token'
    const backupDir = join(fixture.profileDir, '.update-backup')
    const appPath = join(root, 'exit-immediately.cjs')
    const pnpmPath = join(root, 'hung-pnpm.cjs')
    const originalManifest = await readFile(join(fixture.profileDir, 'package.json'))
    await writeFile(statePath, '0.2.0')
    await writeFile(lockPath, JSON.stringify({ pid: 999_999, token: lockToken }))
    await mkdir(backupDir)
    await writeFile(join(backupDir, 'package.json'), originalManifest)
    await writeFile(join(backupDir, 'metadata.json'), JSON.stringify({ hadLockfile: false, manifestMode: 0o644 }))
    await writeFile(appPath, 'process.exit(1)\n')
    await writeFile(pnpmPath, `#!/bin/sh
trap '' TERM
while :; do sleep 1; done
`)
    await chmod(pnpmPath, 0o755)

    const payload = Buffer.from(JSON.stringify({
      pid: 999_999,
      execPath: process.execPath,
      args: [appPath],
      cwd: root,
      logPath: join(root, 'restart.log'),
      lockPath,
      lockToken,
      backupDir,
      handoffPath: join(backupDir, 'handoff.json'),
      profileDir: fixture.profileDir,
      pnpmPath,
      packageName: VISION_TOOLKIT_PACKAGE,
      fromVersion: '0.1.0',
      toVersion: '0.2.0',
      healthUrl: 'http://127.0.0.1:1/_dsh/vision-toolkit/settings',
      rollbackTimeoutMs: 100,
      processKillGraceMs: 50,
      readinessTimeoutMs: 100,
      oldProcessExitTimeoutMs: 100,
    })).toString('base64url')
    const helper = spawn(process.execPath, ['-e', PLUGIN_RESTART_HELPER_SOURCE, payload], {
      cwd: root,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stderr = ''
    helper.stderr?.on('data', chunk => { stderr += String(chunk) })

    await vi.waitFor(async () => {
      const owner = JSON.parse(await readFile(lockPath, 'utf8')) as { pid: number; token: string }
      expect(owner).toMatchObject({ pid: helper.pid, token: lockToken })
    })
    const secondSubprocess = new FakeSubprocess(async () => ({ stdout: '"0.2.0"\n' }))
    const second = new VisionToolkitPluginUpdateService(host(secondSubprocess), '0.1.0', {
      profileDir: fixture.profileDir,
      packageRoot: fixture.installedDir,
      argv: ['web'],
      allowDetachedRestart: true,
      healthUrl: 'http://127.0.0.1:3080/_dsh/vision-toolkit/settings',
    })
    await expect(second.installAndRestart('0.2.0')).rejects.toMatchObject({ code: 'update-in-progress' })
    expect(secondSubprocess.spawns).toHaveLength(0)

    const [code] = await once(helper, 'exit') as [number | null]
    expect(code, stderr).toBe(1)
    expect(stderr).toContain('rollback pnpm timed out')
    expect(await readFile(join(fixture.profileDir, 'package.json'))).toEqual(originalManifest)
    await expect(readFile(lockPath, 'utf8')).resolves.toContain(lockToken)
    await expect(readFile(join(backupDir, 'package.json'))).resolves.toEqual(originalManifest)
  })
})
