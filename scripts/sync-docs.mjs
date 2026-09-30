/**
 * sync-docs.mjs
 *
 * Syncs Coqui documentation and curated examples into the Nextra content/
 * tree and regenerates sidebar metadata.
 *
 * Sources (read from a git ref of the core repo, default origin/main):
 *   - docs/*.md
 *   - examples/**
 *   - README.md for landing pages
 *
 * Environment:
 *   COQUI_REPO_ROOT    core git checkout (default ../../Core/coqui)
 *   COQUI_REF          git ref to publish (default origin/main). Run
 *                      `git -C <core> fetch` first. COQUI_REF=WORKTREE reads the
 *                      working tree instead; never commit content/ made that way.
 *   COQUI_CONTENT_DIR  output directory (default ./content)
 *   COQUI_REPO_URL     GitHub URL for links to unpublished repo files
 *
 * --watch always reads the working tree, for live-editing core docs.
 *
 * Rules:
 *   - Sync only explicitly mapped Markdown docs from coqui/docs
 *   - Sync only explicitly curated examples from coqui/examples
 *   - Exclude php-agents, Postman collections, and other non-curated assets
 *   - Take page title/description from the source doc's frontmatter, overriding
 *     locally only where the site needs different copy from the repo
 *   - Strip source frontmatter and generate Nextra frontmatter locally
 *   - Rewrite internal source links to local routes when a page exists
 *   - Rewrite other repository-relative links to GitHub URLs
 *   - Leave links inside code blocks and inline code untouched
 *   - Turn raw heading anchor tags (which break Nextra TOC hydration) into
 *     Nextra custom heading ids, so `#anchor` links keep working
 *   - Delete anything in content/ this run did not generate, so pages whose
 *     source was removed from core do not linger
 */

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { anchorsFor } from './markdown.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, '..')
const contentDir = path.resolve(process.env.COQUI_CONTENT_DIR || path.join(projectRoot, 'content'))
const defaultCoquiRepo = path.resolve(projectRoot, '..', '..', 'Core', 'coqui')
const coquiRepo = path.resolve(process.env.COQUI_REPO_ROOT || defaultCoquiRepo)
const coquiRef = process.env.COQUI_REF || 'origin/main'
const coquiRepoUrl = (process.env.COQUI_REPO_URL || 'https://github.com/carmelosantana/coqui').replace(/\/$/, '')

// The core tree being published: a snapshot of COQUI_REF, or the working tree.
// Set by main() before any sync; everything below resolves against it.
let coquiRoot = coquiRepo
const coquiDocs = () => path.join(coquiRoot, 'docs')
const coquiExamples = () => path.join(coquiRoot, 'examples')
const coquiReadme = () => path.join(coquiRoot, 'README.md')

const isVercel = process.env.VERCEL === '1'
const forceSync = process.env.COQUI_SYNC_DOCS === '1'
const watchMode = process.argv.includes('--watch')
const skipInitial = process.argv.includes('--skip-initial')

// Docs in coqui/docs that are deliberately not published, with the reason.
// Anything here that is not excluded must be routed in DOC_ROUTES, or
// validateSourceDocs throws — that is what keeps this table from rotting.
const EXCLUDED_DOC_FILES = new Map([
  ['AGENTS.md', 'agent instructions for the core repo, not user-facing docs'],
  ['CLAUDE.md', 'agent instructions for the core repo, not user-facing docs'],
])
const WATCHABLE_EXTENSIONS = new Set(['.md', '.json', '.php'])
const SECTION_DIRS = [
  '',
  'features',
  'guides',
  'development',
  'examples',
  'examples/toolkit',
  'examples/preferences',
  'examples/personas',
  'examples/skills',
]

// Route tables hold paths relative to the core repo root, so they do not
// depend on where the core tree was materialized.
function repoPath(...parts) {
  return parts.join('/')
}

function examplePath(...parts) {
  return ['examples', ...parts].join('/')
}

function abs(relativePath, root = coquiRoot) {
  return path.join(root, relativePath)
}

// Routing decisions only. Page title and description come from the source
// doc's own frontmatter (see resolveRouteMetadata); set titleOverride or
// descriptionOverride only where the site needs different copy from the repo.
const DOC_ROUTES = [
  {
    sourcePath: repoPath('docs', 'FEATURES.md'),
    dest: 'features/index.mdx',
    // Frontmatter says "Coqui Features"; the "Coqui" prefix is redundant in-site.
    titleOverride: 'Features',
    section: 'features',
    render: 'markdown',
  },
  {
    sourcePath: repoPath('docs', 'ARTIFACTS.md'),
    dest: 'features/artifacts.mdx',
    section: 'features',
    render: 'markdown',
  },
  {
    sourcePath: repoPath('docs', 'CHAT.md'),
    dest: 'features/chat.mdx',
    section: 'features',
    render: 'markdown',
  },
  {
    sourcePath: repoPath('docs', 'DATA_FLOW.md'),
    dest: 'features/data-flow.mdx',
    section: 'features',
    render: 'markdown',
  },
  {
    sourcePath: repoPath('docs', 'LOOPS.md'),
    dest: 'features/loops.mdx',
    section: 'features',
    render: 'markdown',
  },
  {
    sourcePath: repoPath('docs', 'QUESTIONS.md'),
    dest: 'features/questions.mdx',
    section: 'features',
    render: 'markdown',
  },
  {
    sourcePath: repoPath('docs', 'PROJECTS.md'),
    dest: 'features/projects.mdx',
    section: 'features',
    render: 'markdown',
  },
  {
    sourcePath: repoPath('docs', 'ROLES.md'),
    dest: 'features/roles.mdx',
    // Frontmatter says "Roles Reference"; the sidebar reads better unsuffixed.
    titleOverride: 'Roles',
    section: 'features',
    render: 'markdown',
  },
  {
    sourcePath: repoPath('docs', 'PERSONAS.md'),
    dest: 'features/personas.mdx',
    section: 'features',
    render: 'markdown',
  },
  {
    sourcePath: repoPath('docs', 'COMMANDS.md'),
    dest: 'guides/commands.mdx',
    // Frontmatter says "Commands Reference"; the sidebar reads better unsuffixed.
    titleOverride: 'Commands',
    section: 'guides',
    render: 'markdown',
  },
  {
    sourcePath: repoPath('docs', 'CONFIGURATION.md'),
    dest: 'guides/configuration.mdx',
    section: 'guides',
    render: 'markdown',
  },
  {
    sourcePath: repoPath('docs', 'API.md'),
    dest: 'guides/api.mdx',
    // Frontmatter says "Coqui HTTP API"; the "Coqui" prefix is redundant in-site.
    titleOverride: 'HTTP API',
    section: 'guides',
    render: 'markdown',
  },
  {
    sourcePath: repoPath('docs', 'BACKGROUND-TASKS.md'),
    dest: 'guides/background-tasks.mdx',
    section: 'guides',
    render: 'markdown',
  },
  {
    sourcePath: repoPath('docs', 'SKILLS.md'),
    dest: 'guides/skills.mdx',
    // Frontmatter says "Coqui Skills"; the "Coqui" prefix is redundant in-site.
    titleOverride: 'Skills',
    section: 'guides',
    render: 'markdown',
  },
  {
    sourcePath: repoPath('docs', 'TOOLKITS.md'),
    dest: 'guides/extending.mdx',
    // Frontmatter says "Coqui Toolkits"; this guide is about building them.
    titleOverride: 'Creating Toolkits',
    section: 'guides',
    render: 'markdown',
  },
  {
    sourcePath: repoPath('docs', 'TESTING.md'),
    dest: 'development/testing.mdx',
    section: 'development',
    render: 'markdown',
  },
  {
    sourcePath: repoPath('docs', 'TOOLKIT-EXTENSIBILITY.md'),
    dest: 'development/toolkit-extensibility.mdx',
    section: 'development',
    render: 'markdown',
  },
  {
    sourcePath: repoPath('docs', 'GITHUB-ACTIONS.md'),
    dest: 'development/ci.mdx',
    section: 'development',
    render: 'markdown',
  },
]

const EXAMPLE_ROUTES = [
  {
    sourcePath: examplePath('hello-toolkit', 'README.md'),
    aliases: [
      examplePath('hello-toolkit'),
      examplePath('hello-toolkit', 'src'),
      examplePath('hello-toolkit', 'composer.json'),
      examplePath('hello-toolkit', 'src', 'HelloToolkit.php'),
    ],
    dest: 'examples/toolkit/hello-toolkit.mdx',
    title: 'Hello Toolkit',
    description: 'Minimal reference toolkit example with the key source files inline.',
    section: 'examples/toolkit',
    render: 'toolkit-example',
  },
  {
    sourcePath: examplePath('preferences', 'README.md'),
    aliases: [examplePath('preferences')],
    dest: 'examples/preferences/index.mdx',
    title: 'Preferences Overview',
    description: 'Copy-ready preference and security examples.',
    section: 'examples/preferences',
    render: 'markdown',
    stripFirstHeading: true,
  },
  {
    sourcePath: examplePath('preferences', 'commercial-operator.json'),
    dest: 'examples/preferences/commercial-operator.mdx',
    title: 'Commercial Operator',
    description: 'High-autonomy preferences example.',
    section: 'examples/preferences',
    render: 'code-example',
    language: 'json',
    lead: 'Copy this file into `personas/your-persona/preferences.json` when you want an outcome-first operator.',
  },
  {
    sourcePath: examplePath('preferences', 'deliberate-operator.json'),
    dest: 'examples/preferences/deliberate-operator.mdx',
    title: 'Deliberate Operator Preferences',
    description: 'Measured, planning-heavy preferences example.',
    section: 'examples/preferences',
    render: 'code-example',
    language: 'json',
    lead: 'Copy this file into `personas/your-persona/preferences.json` when you want a deliberate operator persona.',
  },
  {
    sourcePath: examplePath('preferences', 'review-heavy.json'),
    dest: 'examples/preferences/review-heavy.mdx',
    title: 'Review Heavy',
    description: 'Lean review-focused preferences example.',
    section: 'examples/preferences',
    render: 'code-example',
    language: 'json',
    lead: 'Copy this file into `personas/your-persona/preferences.json` for a terse, review-focused operator.',
  },
  {
    sourcePath: examplePath('preferences', 'security-cautious.md'),
    dest: 'examples/preferences/security-cautious.mdx',
    title: 'Security Cautious',
    description: 'Strong-guardrail security override example.',
    section: 'examples/preferences',
    render: 'code-example',
    language: 'md',
    lead: 'Use this as `personas/your-persona/security.md` when you want tighter approval boundaries.',
  },
  {
    sourcePath: examplePath('preferences', 'security-high-autonomy.md'),
    dest: 'examples/preferences/security-high-autonomy.mdx',
    title: 'Security High Autonomy',
    description: 'Fast-execution security override example.',
    section: 'examples/preferences',
    render: 'code-example',
    language: 'md',
    lead: 'Use this as `personas/your-persona/security.md` when you want faster execution with explicit risk boundaries.',
  },
  {
    sourcePath: examplePath('personas', 'deliberate-operator', 'soul.md'),
    aliases: [
      examplePath('personas', 'deliberate-operator'),
      examplePath('personas', 'deliberate-operator', 'backstory.md'),
      examplePath('personas', 'deliberate-operator', 'preferences.json'),
      examplePath('personas', 'deliberate-operator', 'security.md'),
      examplePath('personas', 'deliberate-operator', 'samples'),
      examplePath('personas', 'deliberate-operator', 'samples', 'responses', 'status-update.md'),
    ],
    dest: 'examples/personas/deliberate-operator.mdx',
    title: 'Deliberate Operator',
    description: 'Complete persona example with soul, backstory, preferences, security, and sample response.',
    section: 'examples/personas',
    render: 'persona-example',
  },
  {
    sourcePath: examplePath('say-hello', 'SKILL.md'),
    aliases: [examplePath('say-hello')],
    dest: 'examples/skills/say-hello.mdx',
    title: 'Say Hello',
    description: 'Minimal skill example that teaches a greeting workflow.',
    section: 'examples/skills',
    render: 'code-example',
    language: 'md',
    lead: 'Copy this file into a skill directory to create a simple greeting skill.',
  },
]

const routesBySection = new Map([
  ['features', DOC_ROUTES.filter(route => route.section === 'features')],
  ['guides', DOC_ROUTES.filter(route => route.section === 'guides')],
  ['development', DOC_ROUTES.filter(route => route.section === 'development')],
])

const exampleRoutesBySection = new Map([
  ['examples/toolkit', EXAMPLE_ROUTES.filter(route => route.section === 'examples/toolkit')],
  ['examples/preferences', EXAMPLE_ROUTES.filter(route => route.section === 'examples/preferences')],
  ['examples/personas', EXAMPLE_ROUTES.filter(route => route.section === 'examples/personas')],
  ['examples/skills', EXAMPLE_ROUTES.filter(route => route.section === 'examples/skills')],
])

const allRoutes = [...DOC_ROUTES, ...EXAMPLE_ROUTES]
const README_ROUTE = '/'
const routePathBySourcePath = new Map([
  ['README.md', README_ROUTE],
  ...allRoutes.flatMap(route => collectRouteSources(route).map(source => [source, routePath(route.dest)])),
])

/**
 * Core-relative paths of the docs the site publishes as pages. A GitHub link
 * to one of these is a missed internal route. (Example pages deliberately
 * link their raw source files on GitHub, so examples are not listed.)
 */
export function publishedSourcePaths() {
  return ['README.md', ...DOC_ROUTES.map(route => route.sourcePath)]
}

function collectRouteSources(route) {
  return [route.sourcePath, ...(route.aliases || [])]
}

function routePath(dest) {
  const withoutExt = dest.replace(/\.mdx$/, '')
  return `/${withoutExt.replace(/\/index$/, '')}`
}

function repoUrlForPath(absPath, root = coquiRoot) {
  const relative = path.relative(root, absPath).replace(/\\/g, '/')
  const exists = fs.existsSync(absPath)
  const isDir = exists ? fs.statSync(absPath).isDirectory() : false
  const base = isDir ? 'tree' : 'blob'
  return `${coquiRepoUrl}/${base}/main/${relative}`
}

function yamlString(value) {
  return JSON.stringify(value)
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true })
  }
}

function readText(filePath) {
  return fs.readFileSync(filePath, 'utf8')
}

function stripFrontmatter(content) {
  return content.replace(/^---\n[\s\S]*?\n---\n*/u, '')
}

function unquoteYamlScalar(raw) {
  const value = raw.trim()
  if (value.length < 2) {
    return value
  }

  if (value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1).replace(/\\(["\\])/g, '$1')
  }

  if (value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1).replace(/''/g, "'")
  }

  return value
}

/**
 * Reads the top-level scalar keys of a source doc's YAML frontmatter.
 * Deliberately minimal: the docs only carry flat `key: value` pairs, so this
 * avoids a YAML dependency. Values may be quoted and may contain colons.
 */
function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---/u)
  if (!match) {
    return {}
  }

  const fields = {}
  for (const line of match[1].split('\n')) {
    const field = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/)
    if (field) {
      fields[field[1]] = unquoteYamlScalar(field[2])
    }
  }

  return fields
}

function stripLeadingH1(content) {
  return content.replace(/^# .+\n+/, '')
}

/**
 * `## <a id="x"></a> Title` breaks Nextra's TOC hydration, but other pages
 * link to `#x`. Nextra's custom heading id syntax (`## Title [#x]`) keeps the
 * anchor without the raw tag.
 */
export function convertHeadingAnchorTags(content) {
  return content.replace(/^(#{1,6})[ \t]+<a id=(['"])(.*?)\2><\/a>[ \t]*(.*?)[ \t]*$/gm, '$1 $4 [#$3]')
}

function stripHtmlComments(content) {
  return content.replace(/<!--([\s\S]*?)-->/g, '')
}

function processReadme(content) {
  let cleaned = stripHtmlComments(content)
  cleaned = cleaned.replace(/^<p align="center">\s*\n\s*<picture>[\s\S]*?<\/picture>\s*\n\s*<\/p>\s*\n*/m, '')
  cleaned = cleaned.replace(/^<p align="center">[\s\S]*?<\/p>\s*\n*/gm, '')
  cleaned = cleaned.replace(/^# .+\n+/, '')
  cleaned = cleaned.replace(/^> \*\*Book a 1:1 call\*\*[\s\S]*?\n\n/m, '')
  return cleaned
}

function normalizeInlineCodeAngles(value) {
  return value.replace(/</g, '‹').replace(/>/g, '›')
}

function escapeMdxUnsafeAngles(content) {
  return content
    .split(/(```[\s\S]*?```)/g)
    .map(segment => {
      if (segment.startsWith('```')) {
        return segment
      }

      return segment
        .split(/(`[^`\n]*`)/g)
        .map(part => {
          if (part.startsWith('`')) {
            return part.includes('<') || part.includes('>')
              ? `\`${normalizeInlineCodeAngles(part.slice(1, -1))}\``
              : part
          }

          return part
            .replace(/<([A-Za-z0-9][A-Za-z0-9_|,.:@/-]*)>/g, (_match, value) => `&lt;${value}&gt;`)
            .replace(/<\/([A-Za-z0-9][A-Za-z0-9_|,.:@/-]*)>/g, (_match, value) => `&lt;/${value}&gt;`)
        })
        .join('')
    })
    .join('')
}

function convertGitHubAlerts(content) {
  let needsImport = false

  const alertTypeMap = {
    NOTE: 'info',
    TIP: 'info',
    IMPORTANT: 'warning',
    WARNING: 'warning',
    CAUTION: 'error',
  }

  const alertRegex = /^> \[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*\n((?:>.*\n?)*)/gm

  const replaced = content.replace(alertRegex, (_match, type, body) => {
    needsImport = true
    const cleanBody = body
      .split('\n')
      .map(line => line.replace(/^>\s?/, ''))
      .join('\n')
      .trim()

    return `<Callout type="${alertTypeMap[type] || 'info'}">\n${cleanBody}\n</Callout>\n`
  })

  if (!needsImport || /import\s+\{\s*Callout\s*\}\s+from\s+'nextra\/components'/.test(replaced)) {
    return replaced
  }

  return `import { Callout } from 'nextra/components'\n\n${replaced}`
}

/**
 * Applies fn to every part of a Markdown document that is not code: fenced
 * blocks and inline code spans are passed through untouched, because links
 * there are illustrative text, not navigation.
 */
function mapOutsideCode(content, fn) {
  let fence = null
  return content
    .split('\n')
    .map(line => {
      const marker = line.trim().match(/^(`{3,}|~{3,})/)
      if (fence) {
        if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length && line.trim() === marker[1]) {
          fence = null
        }
        return line
      }
      if (marker) {
        fence = marker[1]
        return line
      }
      return line
        .split(/(`[^`\n]*`)/g)
        .map(part => (part.startsWith('`') ? part : fn(part)))
        .join('')
    })
    .join('\n')
}

export function rewriteSourceLinks(content, sourcePath, root = coquiRoot) {
  return mapOutsideCode(content, text => text.replace(/\]\(([^)\s#]+)(#[^)\s]+)?\)/g, (match, target, anchor = '') => {
    if (/^(https?:|mailto:|tel:|\/)/.test(target)) {
      return match
    }

    const resolved = path.resolve(path.dirname(sourcePath), target.replace(/\/$/, ''))
    const relative = path.relative(root, resolved).replace(/\\/g, '/')
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      return match
    }

    const internalRoute = routePathBySourcePath.get(relative)
    if (internalRoute) {
      return `](${internalRoute}${anchor})`
    }

    return `](${repoUrlForPath(resolved, root)}${anchor})`
  }))
}

function processMarkdown(content, sourcePath, options = {}) {
  let processed = stripFrontmatter(content)
  if (options.stripFirstHeading) {
    processed = stripLeadingH1(processed)
  }
  processed = stripHtmlComments(processed)
  processed = convertHeadingAnchorTags(processed)
  processed = escapeMdxUnsafeAngles(processed)
  processed = convertGitHubAlerts(processed)
  processed = rewriteSourceLinks(processed, sourcePath)
  return processed.trim()
}

function extractTopLevelSection(content, headingPattern) {
  const lines = content.split('\n')
  const headingRegex = new RegExp(`^## (?:${headingPattern})\\s*$`)
  let insideFence = false
  let startIndex = -1

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]
    const trimmed = line.trim()

    if (/^`{3,}/.test(trimmed)) {
      insideFence = !insideFence
    }

    if (!insideFence && headingRegex.test(line)) {
      startIndex = index + 1
      break
    }
  }

  if (startIndex === -1) {
    return null
  }

  const sectionLines = []
  for (let index = startIndex; index < lines.length; index++) {
    const line = lines[index]
    const trimmed = line.trim()

    if (/^`{3,}/.test(trimmed)) {
      insideFence = !insideFence
      sectionLines.push(line)
      continue
    }

    if (!insideFence && /^(##|#)\s+/.test(line)) {
      break
    }

    sectionLines.push(line)
  }

  return sectionLines.join('\n').trim()
}

function buildFrontmatter(route) {
  const lines = ['---', `title: ${yamlString(route.title)}`]
  if (route.description) {
    lines.push(`description: ${yamlString(route.description)}`)
  }
  lines.push('---', '', '')
  return lines.join('\n')
}

function fenceFor(content) {
  return content.includes('```') ? '````' : '```'
}

function codeFence(content, language = '') {
  const fence = fenceFor(content)
  return `${fence}${language}\n${content.trimEnd()}\n${fence}`
}

function markdownSourceLink(absPath, label) {
  return `[${label}](${repoUrlForPath(absPath)})`
}

function buildMarkdownPage(route) {
  const raw = readText(abs(route.sourcePath))
  return `${buildFrontmatter(route)}${processMarkdown(raw, abs(route.sourcePath), { stripFirstHeading: route.stripFirstHeading })}\n`
}

function buildCodeExamplePage(route) {
  const raw = readText(abs(route.sourcePath))
  const lines = [
    buildFrontmatter(route),
    route.lead,
    '',
    `Source: ${markdownSourceLink(abs(route.sourcePath), route.sourcePath)}`,
    '',
    codeFence(raw, route.language),
    '',
  ]
  return lines.join('\n')
}

function buildToolkitExamplePage(route) {
  const sourcePath = abs(route.sourcePath)
  const readme = processMarkdown(readText(sourcePath), sourcePath, { stripFirstHeading: true })
  const composerPath = abs(examplePath('hello-toolkit', 'composer.json'))
  const toolkitPath = abs(examplePath('hello-toolkit', 'src', 'HelloToolkit.php'))
  const rootPath = abs(examplePath('hello-toolkit'))
  const srcPath = abs(examplePath('hello-toolkit', 'src'))

  const lines = [
    buildFrontmatter(route),
    readme,
    '',
    '## Source Files',
    '',
    `- ${markdownSourceLink(rootPath, 'examples/hello-toolkit/')}`,
    `- ${markdownSourceLink(srcPath, 'examples/hello-toolkit/src/')}`,
    `- ${markdownSourceLink(composerPath, 'examples/hello-toolkit/composer.json')}`,
    `- ${markdownSourceLink(sourcePath, 'examples/hello-toolkit/README.md')}`,
    `- ${markdownSourceLink(toolkitPath, 'examples/hello-toolkit/src/HelloToolkit.php')}`,
    '',
    '## composer.json',
    '',
    codeFence(readText(composerPath), 'json'),
    '',
    '## HelloToolkit.php',
    '',
    codeFence(readText(toolkitPath), 'php'),
    '',
  ]

  return lines.join('\n')
}

function buildPersonaExamplePage(route) {
  const soulPath = abs(route.sourcePath)
  const personaDir = abs(examplePath('personas', 'deliberate-operator'))
  const sampleDir = abs(examplePath('personas', 'deliberate-operator', 'samples'))
  const backstoryPath = abs(examplePath('personas', 'deliberate-operator', 'backstory.md'))
  const preferencesPath = abs(examplePath('personas', 'deliberate-operator', 'preferences.json'))
  const securityPath = abs(examplePath('personas', 'deliberate-operator', 'security.md'))
  const sampleResponsePath = abs(examplePath('personas', 'deliberate-operator', 'samples', 'responses', 'status-update.md'))

  const lines = [
    buildFrontmatter(route),
    'This example persona bundles a soul, backstory, preferences, security guidance, and one sample response so you can see how a complete persona hangs together.',
    '',
    '## Source Files',
    '',
    `- ${markdownSourceLink(personaDir, 'examples/personas/deliberate-operator/')}`,
    `- ${markdownSourceLink(sampleDir, 'examples/personas/deliberate-operator/samples/')}`,
    `- ${markdownSourceLink(soulPath, 'examples/personas/deliberate-operator/soul.md')}`,
    `- ${markdownSourceLink(backstoryPath, 'examples/personas/deliberate-operator/backstory.md')}`,
    `- ${markdownSourceLink(preferencesPath, 'examples/personas/deliberate-operator/preferences.json')}`,
    `- ${markdownSourceLink(securityPath, 'examples/personas/deliberate-operator/security.md')}`,
    `- ${markdownSourceLink(sampleResponsePath, 'examples/personas/deliberate-operator/samples/responses/status-update.md')}`,
    '',
    '## soul.md',
    '',
    codeFence(readText(soulPath), 'md'),
    '',
    '## backstory.md',
    '',
    codeFence(readText(backstoryPath), 'md'),
    '',
    '## preferences.json',
    '',
    codeFence(readText(preferencesPath), 'json'),
    '',
    '## security.md',
    '',
    codeFence(readText(securityPath), 'md'),
    '',
    '## Sample Response',
    '',
    processMarkdown(readText(sampleResponsePath), sampleResponsePath, { stripFirstHeading: true }),
    '',
  ]

  return lines.join('\n')
}

function buildPage(route) {
  switch (route.render) {
    case 'toolkit-example':
      return buildToolkitExamplePage(route)
    case 'persona-example':
      return buildPersonaExamplePage(route)
    case 'code-example':
      return buildCodeExamplePage(route)
    case 'markdown':
      return buildMarkdownPage(route)
    default:
      throw new Error(`Unsupported route renderer: ${route.render}`)
  }
}

// Every file this run writes into content/, so pruneStaleOutputs can remove
// everything else.
const writtenFiles = new Set()

function writeContentFile(relativePath, text) {
  const destPath = path.join(contentDir, relativePath)
  ensureDir(path.dirname(destPath))
  fs.writeFileSync(destPath, text, 'utf8')
  writtenFiles.add(path.resolve(destPath))
}

function writeRoute(route) {
  writeContentFile(route.dest, buildPage(route))
  console.log(`  ✓ ${route.sourcePath} -> ${route.dest}`)
}

/**
 * Getting Started is a section extracted from the README, so `#anchor` links
 * to other README sections have no target on that page. Point them at the
 * landing page, which carries the whole README.
 */
export function pointAnchorsAtLandingPage(section) {
  const local = anchorsFor(section)
  return mapOutsideCode(section, text => text.replace(/\]\(#([^)\s]+)\)/g, (match, anchor) => (
    local.has(anchor) ? match : `](${README_ROUTE}#${anchor})`
  )))
}

function syncLandingPages() {
  if (!fs.existsSync(coquiReadme())) {
    return 0
  }

  let readmeContent = processReadme(readText(coquiReadme()))
  readmeContent = processMarkdown(readmeContent, coquiReadme())

  const indexContent = `---\ntitle: ${yamlString('Coqui Docs')}\n---\n\n${readmeContent}\n`
  writeContentFile('index.mdx', indexContent)
  console.log('  ✓ README.md -> index.mdx')

  const gettingStartedSection = extractTopLevelSection(readmeContent, 'Quick Start|Installation|Getting Started')
  const gettingStarted = gettingStartedSection
    ? pointAnchorsAtLandingPage(gettingStartedSection)
    : 'See the [Introduction](/) for installation and quick start instructions.'

  const gettingStartedContent = `---\ntitle: ${yamlString('Getting Started')}\n---\n\n# Getting Started\n\n${gettingStarted}\n`
  writeContentFile('getting-started.mdx', gettingStartedContent)
  console.log('  ✓ README.md -> getting-started.mdx')

  return 2
}

function writeMetaFile(relativePath, entries) {
  const lines = ['export default {']
  for (const [key, value] of entries) {
    lines.push(`  ${JSON.stringify(key)}: ${JSON.stringify(value)},`)
  }
  lines.push('}')

  writeContentFile(relativePath, `${lines.join('\n')}\n`)
}

function slugForRoute(route) {
  return path.basename(route.dest, '.mdx')
}

function writeMetaFiles() {
  const rootEntries = []

  if (fs.existsSync(path.join(contentDir, 'index.mdx'))) {
    rootEntries.push(['index', 'Introduction'])
  }

  if (fs.existsSync(path.join(contentDir, 'getting-started.mdx'))) {
    rootEntries.push(['getting-started', 'Getting Started'])
  }

  rootEntries.push(['features', 'Features'])
  rootEntries.push(['guides', 'Guides'])
  rootEntries.push(['development', 'Development'])
  rootEntries.push(['examples', 'Examples'])

  writeMetaFile('_meta.js', rootEntries)
  writeMetaFile('features/_meta.js', routesBySection.get('features').map(route => [slugForRoute(route), route.dest.endsWith('/index.mdx') ? 'Overview' : route.title]))
  writeMetaFile('guides/_meta.js', routesBySection.get('guides').map(route => [slugForRoute(route), route.title]))
  writeMetaFile('development/_meta.js', routesBySection.get('development').map(route => [slugForRoute(route), route.title]))
  writeMetaFile('examples/_meta.js', [
    ['toolkit', 'Toolkit'],
    ['personas', 'Personas'],
    ['preferences', 'Preferences'],
    ['skills', 'Skills'],
  ])
  writeMetaFile('examples/toolkit/_meta.js', [['hello-toolkit', 'Hello Toolkit']])
  writeMetaFile('examples/personas/_meta.js', [['deliberate-operator', 'Deliberate Operator']])
  writeMetaFile('examples/preferences/_meta.js', exampleRoutesBySection.get('examples/preferences').map(route => [slugForRoute(route), route.dest.endsWith('/index.mdx') ? 'Overview' : route.title]))
  writeMetaFile('examples/skills/_meta.js', [['say-hello', 'Say Hello']])
}

function validateSourceDocs() {
  if (!fs.existsSync(coquiDocs())) {
    throw new Error(`Coqui docs directory not found at ${coquiDocs()}`)
  }

  const docsInRoot = fs.readdirSync(coquiDocs(), { withFileTypes: true })
    .filter(entry => entry.isFile())
    .map(entry => entry.name)
    .filter(name => name.endsWith('.md'))
    .filter(name => !EXCLUDED_DOC_FILES.has(name))
    .sort()

  const mappedFiles = DOC_ROUTES.map(route => path.basename(route.sourcePath)).sort()
  const missingMappings = docsInRoot.filter(name => !mappedFiles.includes(name))
  const missingSources = DOC_ROUTES.filter(route => !fs.existsSync(abs(route.sourcePath))).map(route => route.sourcePath)
  const missingExampleSources = EXAMPLE_ROUTES.filter(route => !fs.existsSync(abs(route.sourcePath))).map(route => route.sourcePath)

  if (missingMappings.length > 0) {
    throw new Error(`New docs require route mappings: ${missingMappings.join(', ')}`)
  }

  if (missingSources.length > 0) {
    throw new Error(`Mapped docs missing from source: ${missingSources.join(', ')}`)
  }

  if (missingExampleSources.length > 0) {
    throw new Error(`Curated example sources missing: ${missingExampleSources.join(', ')}`)
  }
}

/**
 * Resolves each doc route's title/description from the source doc's own
 * frontmatter, so the same metadata is not restated here and left to drift.
 * A route may set titleOverride/descriptionOverride where the site needs
 * different copy from the repo (sidebar labels, mainly). Runs after
 * validateSourceDocs so a missing source reports as a mapping error first.
 */
function resolveRouteMetadata() {
  for (const route of DOC_ROUTES) {
    const relative = route.sourcePath
    const front = parseFrontmatter(readText(abs(route.sourcePath)))
    const title = route.titleOverride ?? front.title
    const description = route.descriptionOverride ?? front.description

    if (!title) {
      throw new Error(`${relative} has no frontmatter title; add one or set titleOverride`)
    }

    if (!description) {
      throw new Error(`${relative} has no frontmatter description; add one or set descriptionOverride`)
    }

    route.title = title
    route.description = description
  }
}

/**
 * content/ is entirely generated, so anything this run did not write is a
 * page whose source is gone from core (or a route that was renamed).
 */
function pruneStaleOutputs(dir = contentDir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      pruneStaleOutputs(fullPath)
      if (fs.readdirSync(fullPath).length === 0) {
        fs.rmdirSync(fullPath)
      }
      continue
    }

    if (!writtenFiles.has(path.resolve(fullPath))) {
      fs.rmSync(fullPath, { force: true })
      console.log(`  ⊘ removed stale ${path.relative(contentDir, fullPath).replace(/\\/g, '/')}`)
    }
  }
}

function syncDocsOnce() {
  console.log('Syncing Coqui docs and examples to Nextra content/...\n')

  validateSourceDocs()
  resolveRouteMetadata()

  for (const dir of SECTION_DIRS) {
    ensureDir(path.join(contentDir, dir))
  }

  writtenFiles.clear()
  let syncedCount = syncLandingPages()

  for (const route of DOC_ROUTES) {
    writeRoute(route)
    syncedCount += 1
  }

  for (const route of EXAMPLE_ROUTES) {
    writeRoute(route)
    syncedCount += 1
  }

  writeMetaFiles()
  pruneStaleOutputs()

  console.log(`\nDone. Synced ${syncedCount} pages.`)
}

function collectDirectories(rootDir) {
  const dirs = [rootDir]
  if (!fs.existsSync(rootDir)) {
    return dirs
  }

  for (const entry of fs.readdirSync(rootDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue
    }
    dirs.push(...collectDirectories(path.join(rootDir, entry.name)))
  }

  return dirs
}

function startWatchMode() {
  let debounceTimer = null
  const watchers = []

  const queueSync = reason => {
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer)
    }

    debounceTimer = setTimeout(() => {
      debounceTimer = null
      console.log(`\nDetected source change (${reason}). Re-syncing...\n`)
      try {
        syncDocsOnce()
      } catch (error) {
        console.error(`\nDocs sync failed: ${error.message}`)
      }
    }, 150)
  }

  const watchDirs = [
    ...collectDirectories(coquiDocs()),
    ...collectDirectories(coquiExamples()),
  ]

  for (const dir of watchDirs) {
    const watcher = fs.watch(dir, { persistent: true }, (eventType, filename) => {
      if (!filename) {
        queueSync(`${eventType}:${path.basename(dir)}`)
        return
      }

      const extension = path.extname(filename).toLowerCase()
      if (!WATCHABLE_EXTENSIONS.has(extension)) {
        return
      }

      queueSync(`${eventType}:${filename}`)
    })
    watchers.push(watcher)
  }

  const readmeWatcher = fs.watch(coquiReadme(), { persistent: true }, eventType => {
    queueSync(`${eventType}:README.md`)
  })
  watchers.push(readmeWatcher)

  console.log(`Watching ${coquiDocs()}, ${coquiExamples()}, and README.md for source changes...`)

  const stopWatching = () => {
    for (const watcher of watchers) {
      watcher.close()
    }
  }

  process.on('SIGINT', stopWatching)
  process.on('SIGTERM', stopWatching)
}

/**
 * Materializes the core tree at `ref` into a temp directory (index + checkout,
 * so `export-ignore` attributes do not drop files the way `git archive` would).
 */
function snapshotCoqui(repo, ref) {
  const git = (...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  let sha
  try {
    sha = git('rev-parse', '--verify', `${ref}^{commit}`)
  } catch {
    throw new Error(`Cannot resolve core ref "${ref}" in ${repo}. Run \`git -C ${repo} fetch\`, or set COQUI_REF.`)
  }

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coqui-docs-src-'))
  const tree = path.join(dir, 'tree')
  const env = { ...process.env, GIT_INDEX_FILE: path.join(dir, 'index') }
  execFileSync('git', ['-C', repo, 'read-tree', sha], { env })
  execFileSync('git', ['-C', repo, 'checkout-index', '--all', `--prefix=${tree}${path.sep}`], { env })
  return { dir, tree, sha }
}

function main() {
  if (isVercel && !forceSync) {
    console.log('Skipping docs sync on Vercel (using committed content/ files).')
    console.log('Set COQUI_SYNC_DOCS=1 to force sync in this environment.')
    return
  }

  const useWorkingTree = watchMode || coquiRef === 'WORKTREE'
  let snapshot = null

  if (useWorkingTree) {
    coquiRoot = coquiRepo
    console.log(`Reading core from the working tree at ${coquiRepo}. Do not commit content/ generated this way.\n`)
  } else {
    snapshot = snapshotCoqui(coquiRepo, coquiRef)
    coquiRoot = snapshot.tree
    process.on('exit', () => fs.rmSync(snapshot.dir, { recursive: true, force: true }))
    console.log(`Reading core from ${coquiRef} (${snapshot.sha.slice(0, 7)}) in ${coquiRepo}\n`)
  }

  if (!skipInitial) {
    syncDocsOnce()
  }

  if (watchMode) {
    startWatchMode()
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    main()
  } catch (error) {
    console.error(`ERROR: ${error.message}`)
    process.exit(1)
  }
}
