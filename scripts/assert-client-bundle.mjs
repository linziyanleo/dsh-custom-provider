import { readFileSync } from 'node:fs'

/** Smoke-check the built client bundle's module-loader wrapper shape. */
const bundle = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
const needles = ['__ModuleLoader__.load', '"@linziyanleo/dsh-custom-provider"', 'exports.apply', 'exports.inject']
const missing = needles.filter(needle => !bundle.includes(needle))
if (missing.length > 0) {
  console.error(`client bundle is missing: ${missing.join(', ')}`)
  process.exit(1)
}
console.log('client bundle wrapper ok')
