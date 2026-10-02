import { rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Whether this process may create symbolic links. Windows grants that only
 * to elevated tokens or Developer Mode, so symlink-security tests skip on
 * hosts without the privilege instead of failing — they still run everywhere
 * the filesystem actually allows the attack they model.
 */
export async function probeSymlinkSupport(): Promise<boolean> {
  const target = join(tmpdir(), `dvt-symlink-probe-${process.pid}-${Date.now()}.txt`)
  const link = `${target}.link`
  try {
    await writeFile(target, 'probe')
    await symlink(target, link)
    return true
  } catch {
    return false
  } finally {
    await rm(link, { force: true }).catch(() => {})
    await rm(target, { force: true }).catch(() => {})
  }
}
