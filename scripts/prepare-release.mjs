import { execFile } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

const execFileAsync = promisify(execFile)
const packagePath = fileURLToPath(new URL('../package.json', import.meta.url))
const defaultRegistry = 'https://registry.npmjs.org'

function parseStableVersion(version) {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(version)
  if (!match) throw new Error(`Expected a stable semantic version, received ${JSON.stringify(version)}`)

  const parts = match.slice(1).map(Number)
  if (parts.some(part => !Number.isSafeInteger(part))) {
    throw new Error(`Version exceeds JavaScript's safe integer range: ${version}`)
  }
  return parts
}

function compareVersions(left, right) {
  const a = parseStableVersion(left)
  const b = parseStableVersion(right)
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index]
  }
  return 0
}

export function selectReleaseVersion(declaredVersion, publishedVersion) {
  parseStableVersion(declaredVersion)
  if (publishedVersion == null) return declaredVersion

  const [major, minor, patch] = parseStableVersion(publishedVersion)
  if (compareVersions(declaredVersion, publishedVersion) > 0) return declaredVersion
  if (patch === Number.MAX_SAFE_INTEGER) throw new Error(`Cannot increment patch version ${publishedVersion}`)
  return `${major}.${minor}.${patch + 1}`
}

async function readPublishedVersion(name, registry) {
  try {
    const { stdout } = await execFileAsync(
      'npm',
      ['view', name, 'version', '--json', `--registry=${registry}`],
      { encoding: 'utf8' },
    )
    const version = JSON.parse(stdout)
    if (typeof version !== 'string') throw new Error(`Registry returned an invalid version for ${name}`)
    return version
  } catch (error) {
    const stderr = typeof error?.stderr === 'string' ? error.stderr : ''
    if (stderr.includes('E404') || stderr.includes('404 Not Found')) return undefined
    throw error
  }
}

async function main() {
  const packageData = JSON.parse(await readFile(packagePath, 'utf8'))
  const registry = process.env.NPM_CONFIG_REGISTRY || defaultRegistry
  const publishedVersion = await readPublishedVersion(packageData.name, registry)
  const releaseVersion = selectReleaseVersion(packageData.version, publishedVersion)

  if (releaseVersion !== packageData.version) {
    packageData.version = releaseVersion
    await writeFile(packagePath, `${JSON.stringify(packageData, null, 2)}\n`)
  }

  process.stdout.write(releaseVersion)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === fileURLToPath(new URL(`file://${process.argv[1]}`))) {
  await main()
}
