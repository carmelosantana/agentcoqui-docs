// Run: node --test scripts/*.test.mjs  (or: pnpm test)
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

import { anchorsFor, checkContent } from './check-content.mjs'
import { convertHeadingAnchorTags, publishedSourcePaths, rewriteSourceLinks } from './sync-docs.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, '..')
const coquiRepo = path.resolve(process.env.COQUI_REPO_ROOT || path.join(projectRoot, '..', '..', 'Core', 'coqui'))
const fakeRoot = path.join(os.tmpdir(), 'coqui-fake-root')
const readmeSource = path.join(fakeRoot, 'README.md')

function tmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix))
}

describe('rewriteSourceLinks', () => {
  it('routes an anchored link to a published doc internally', () => {
    const out = rewriteSourceLinks('See [x](docs/FEATURES.md#skills-system).', readmeSource, fakeRoot)
    assert.equal(out, 'See [x](/features#skills-system).')
  })

  it('routes an unanchored link to a published doc internally', () => {
    const out = rewriteSourceLinks('See [x](API.md).', path.join(fakeRoot, 'docs', 'FEATURES.md'), fakeRoot)
    assert.equal(out, 'See [x](/guides/api).')
  })

  it('leaves links inside fenced code and inline code alone', () => {
    const src = [
      '```markdown',
      'See [the API reference](references/api-spec.md) for details.',
      '```',
      'Write `[x](references/php-checklist.md)` in your skill.',
    ].join('\n')
    assert.equal(rewriteSourceLinks(src, path.join(fakeRoot, 'docs', 'SKILLS.md'), fakeRoot), src)
  })

  it('sends unpublished repo files to GitHub', () => {
    const out = rewriteSourceLinks('[a](../AGENTS.md)', path.join(fakeRoot, 'docs', 'FEATURES.md'), fakeRoot)
    assert.equal(out, '[a](https://github.com/carmelosantana/coqui/blob/main/AGENTS.md)')
  })
})

describe('convertHeadingAnchorTags', () => {
  it('keeps an explicit <a id> as a Nextra custom heading id', () => {
    const out = convertHeadingAnchorTags('## <a id="skills-system"></a> 📋 Skills System\n')
    assert.equal(out, '## 📋 Skills System [#skills-system]\n')
    assert.ok(anchorsFor(out).has('skills-system'))
  })
})

describe('publishedSourcePaths', () => {
  it('lists the core docs the site publishes, relative to core', () => {
    const paths = publishedSourcePaths()
    assert.ok(paths.includes('docs/FEATURES.md'))
    assert.ok(paths.includes('README.md'))
    assert.ok(!paths.includes('docs/AGENTS.md'))
  })
})

describe('checkContent', () => {
  it('flags missing pages, missing anchors and GitHub links to published docs', () => {
    const dir = tmpDir('coqui-check-')
    fs.mkdirSync(path.join(dir, 'features'))
    fs.writeFileSync(path.join(dir, 'features', 'index.mdx'), '# Features\n\n## Skills System [#skills]\n')
    fs.writeFileSync(path.join(dir, 'index.mdx'), [
      '[ok](/features#skills)',
      '[bad page](/nope)',
      '[bad anchor](/features#missing)',
      '[github](https://github.com/carmelosantana/coqui/blob/main/docs/FEATURES.md#x)',
      '```',
      '[ignored](/also-nope)',
      '```',
    ].join('\n'))

    const problems = checkContent({ contentDir: dir, publishedSources: ['docs/FEATURES.md'] })
    assert.equal(problems.length, 3, problems.join('\n'))
    assert.match(problems.join('\n'), /missing page \/nope/)
    assert.match(problems.join('\n'), /missing anchor \/features#missing/)
    assert.match(problems.join('\n'), /publishes; use the internal route/)
  })
})

describe('sync-docs end to end', { skip: !fs.existsSync(path.join(coquiRepo, '.git')) && 'core checkout not found' }, () => {
  it('reads core from the git ref, not the working tree, and prunes orphaned pages', () => {
    const clone = tmpDir('coqui-core-')
    execFileSync('git', ['clone', '--quiet', '--shared', coquiRepo, clone])
    const ref = execFileSync('git', ['-C', clone, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
    fs.appendFileSync(path.join(clone, 'README.md'), '\nUNCOMMITTED-WORKING-TREE-EDIT\n')

    const content = tmpDir('coqui-content-')
    fs.mkdirSync(path.join(content, 'features'))
    fs.writeFileSync(path.join(content, 'features', 'channels.mdx'), '---\ntitle: Channels\n---\n')

    execFileSync(process.execPath, [path.join(__dirname, 'sync-docs.mjs')], {
      env: { ...process.env, VERCEL: '', COQUI_REPO_ROOT: clone, COQUI_REF: ref, COQUI_CONTENT_DIR: content },
      stdio: 'pipe',
    })

    const index = fs.readFileSync(path.join(content, 'index.mdx'), 'utf8')
    assert.ok(!index.includes('UNCOMMITTED-WORKING-TREE-EDIT'), 'working-tree edit leaked into output')
    assert.ok(fs.existsSync(path.join(content, 'features', 'personas.mdx')))
    assert.ok(!fs.existsSync(path.join(content, 'features', 'channels.mdx')), 'orphaned page was not pruned')
    assert.equal(execFileSync('git', ['-C', clone, 'status', '--porcelain', '--', 'README.md'], { encoding: 'utf8' }).trim(), 'M README.md')
  })
})
