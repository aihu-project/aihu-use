import { readFile } from 'node:fs/promises'

const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url)))
const encoded = manifest.name.startsWith('@') ? manifest.name.replace('/', '%2f') : manifest.name
const response = await fetch(`https://registry.npmjs.org/${encoded}/${manifest.version}`, { headers: { accept: 'application/json' } })
if (response.status === 404) {
  console.log(`${manifest.name}@${manifest.version}: confirmed registry E404 (unpublished)`)
  process.exit(0)
}
const body = (await response.text()).slice(0, 240)
throw new Error(`expected registry E404 for ${manifest.name}@${manifest.version}, received HTTP ${response.status}: ${body}`)
