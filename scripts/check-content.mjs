/**
 * check-content.mjs
 *
 * Checks the generated content/ tree for broken links. Zero dependencies.
 *
 *   node scripts/check-content.mjs [--content <dir>] [--coqui <snapshot-dir>]
 *
 * Fails (exit 1) when:
 *   - an internal link (`/guides/api`, `/features#x`) points at a page that
 *     does not exist, or at a heading anchor that page does not have;
 *   - a link into the Coqui GitHub repo points at a doc that the site
 *     publishes itself (it should be an internal route);
 *   - with --coqui, a link into the Coqui GitHub repo points at a path that
 *     does not exist in that core snapshot (a guaranteed 404).
 *
 * Links inside fenced code blocks and inline code are ignored: they are
 * illustrative, not navigation.
 */

import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, '..')
const coquiRepoUrl = (process.env.COQUI_REPO_URL || 'https://github.com/carmelosantana/coqui').replace(/\/$/, '')

/** Removes fenced code blocks and inline code spans, keeping line count. */
export function stripCode(markdown) {
  const out = []
  let fence = null
  for (const line of markdown.split('\n')) {
    const marker = line.trim().match(/^(`{3,}|~{3,})/)
    if (fence) {
      if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length && line.trim() === marker[1]) {
        fence = null
      }
      out.push('')
      continue
    }
    if (marker) {
      fence = marker[1]
      out.push('')
      continue
    }
    out.push(line.replace(/`[^`\n]*`/g, ''))
  }
  return out.join('\n')
}

/** github-slugger compatible slug for a heading's rendered text. */
export function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}\p{Pc}\- ]/gu, '')
    .replace(/ /g, '-')
}

/** Rendered text of a Markdown heading (links, code, emphasis, tags stripped). */
export function headingText(raw) {
  return raw
    .replace(/<[^>]+>/g, '')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/(\*\*|__|\*|_)(\S[\s\S]*?\S|\S)\1/g, '$2')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .trim()
}

export function anchorsFor(markdown) {
  const anchors = new Set()
  const seen = new Map()
  let fence = null
  for (const line of markdown.split('\n')) {
    const marker = line.trim().match(/^(`{3,}|~{3,})/)
    if (fence) {
      if (marker && marker[1][0] === fence[0] && line.trim() === marker[1]) {
        fence = null
      }
      continue
    }
    if (marker) {
      fence = marker[1]
      continue
    }
    const heading = line.match(/^#{1,6}\s+(.+?)\s*#*\s*$/)
    if (!heading) {
      continue
    }
    // Nextra custom heading id: `## Title [#id]`.
    const custom = heading[1].match(/\[#([^\]\s]+)\]$/)
    if (custom) {
      anchors.add(custom[1])
      continue
    }
    const base = slugify(headingText(heading[1]))
    const count = seen.get(base) ?? 0
    seen.set(base, count + 1)
    anchors.add(count === 0 ? base : `${base}-${count}`)
  }
  return anchors
}

function listPages(contentDir) {
  const pages = new Map()
  const walk = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(full)
      } else if (entry.name.endsWith('.mdx')) {
        const rel = path.relative(contentDir, full).replace(/\\/g, '/').replace(/\.mdx$/, '')
        const route = `/${rel}`.replace(/\/index$/, '') || '/'
        pages.set(route, full)
      }
    }
  }
  walk(contentDir)
  return pages
}

export function checkContent({ contentDir, coquiSnapshot = null, publishedSources = [] }) {
  const pages = listPages(contentDir)
  const anchorCache = new Map()
  const anchorsOf = route => {
    if (!anchorCache.has(route)) {
      anchorCache.set(route, anchorsFor(fs.readFileSync(pages.get(route), 'utf8')))
    }
    return anchorCache.get(route)
  }
  const published = new Set(publishedSources.map(p => p.replace(/\\/g, '/')))
  const repoLink = new RegExp(`^${coquiRepoUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/(?:blob|tree)/[^/]+/([^#?]*)`)
  const problems = []

  for (const [route, file] of pages) {
    const body = stripCode(fs.readFileSync(file, 'utf8'))
    const lines = body.split('\n')
    lines.forEach((line, index) => {
      for (const match of line.matchAll(/\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g)) {
        const target = match[1]
        const where = `${path.relative(projectRoot, file)}:${index + 1}`

        if (target.startsWith('/') && !target.startsWith('//')) {
          const [pathPart, anchor] = target.split('#')
          const linkRoute = pathPart.replace(/\/$/, '') || '/'
          if (linkRoute.startsWith('/_pagefind') || /\.[a-z0-9]+$/i.test(linkRoute)) {
            continue
          }
          if (!pages.has(linkRoute)) {
            problems.push(`${where}: link to missing page ${target}`)
            continue
          }
          if (anchor && !anchorsOf(linkRoute).has(anchor)) {
            problems.push(`${where}: link to missing anchor ${target}`)
          }
          continue
        }

        if (target.startsWith('#')) {
          if (!anchorsOf(route).has(target.slice(1))) {
            problems.push(`${where}: link to missing anchor ${target}`)
          }
          continue
        }

        const repo = target.match(repoLink)
        if (repo) {
          const repoPath = decodeURIComponent(repo[1]).replace(/\/$/, '')
          if (published.has(repoPath)) {
            problems.push(`${where}: GitHub link to ${repoPath}, which this site publishes; use the internal route`)
          } else if (coquiSnapshot && repoPath !== '' && !fs.existsSync(path.join(coquiSnapshot, repoPath))) {
            problems.push(`${where}: GitHub link to ${repoPath}, which does not exist in core (404)`)
          }
        }
      }
    })
  }

  return problems
}

function parseArgs(argv) {
  const args = { content: path.join(projectRoot, 'content'), coqui: null, published: [] }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--content') args.content = path.resolve(argv[++i])
    else if (argv[i] === '--coqui') args.coqui = path.resolve(argv[++i])
    else if (argv[i] === '--published') args.published = argv[++i].split(',').filter(Boolean)
  }
  return args
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const args = parseArgs(process.argv.slice(2))
  let published = args.published
  if (published.length === 0) {
    const { publishedSourcePaths } = await import('./sync-docs.mjs')
    published = publishedSourcePaths()
  }
  const problems = checkContent({ contentDir: args.content, coquiSnapshot: args.coqui, publishedSources: published })
  if (problems.length > 0) {
    console.error(`Found ${problems.length} broken or misrouted link(s):\n`)
    for (const problem of problems) {
      console.error(`  ✗ ${problem}`)
    }
    process.exit(1)
  }
  console.log('All internal links resolve.')
}
