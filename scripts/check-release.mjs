import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url)))
const tag = process.argv[2] ?? process.env.RELEASE_TAG ?? process.env.GITHUB_REF_NAME
if (!tag) throw new Error('release tag is required')
if (!/^v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/.test(tag)) {
  throw new Error(`release tag is not an exact stable semver: ${tag}`)
}
if (tag !== `v${manifest.version}`) throw new Error(`release tag ${tag} does not equal package version v${manifest.version}`)

const taggedCommit = execFileSync('git', ['rev-parse', `${tag}^{commit}`], { encoding: 'utf8' }).trim()
const workflowCommit = process.env.GITHUB_SHA ?? execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
if (taggedCommit !== workflowCommit) throw new Error('release tag does not point at the workflow commit')

const defaultBranch = process.env.RELEASE_DEFAULT_BRANCH ?? 'main'
try {
  execFileSync('git', ['rev-parse', `origin/${defaultBranch}`], { stdio: 'ignore' })
  execFileSync('git', ['merge-base', '--is-ancestor', taggedCommit, `origin/${defaultBranch}`])
} catch {
  throw new Error(`release tag must point at a commit on the reviewed default branch ${defaultBranch}`)
}

console.log(`${manifest.name}@${manifest.version}: exact stable tag ${tag} at ${taggedCommit} on ${defaultBranch}`)
