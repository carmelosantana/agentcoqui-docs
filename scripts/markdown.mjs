/**
 * Markdown helpers shared by sync-docs.mjs and check-content.mjs.
 * Zero dependencies.
 */

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
