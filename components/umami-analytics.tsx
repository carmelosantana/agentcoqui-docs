'use client'

import Script from 'next/script'
import { usePathname } from 'next/navigation'
import { useEffect, useMemo, useRef, useState } from 'react'

declare global {
  interface Window {
    umami?: {
      track: {
        (): void
        (payload: Record<string, string | number>): void
        (event: string): void
        (event: string, properties: Record<string, string | number>): void
        (handler: (props: Record<string, unknown>) => Record<string, unknown>): void
      }
    }
  }
}

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? value.slice(0, maxLength) : value
}

function normalizeWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, ' ')
}

function trackEvent(event: string, properties: Record<string, string | number>): void {
  if (typeof window === 'undefined' || !window.umami) {
    return
  }

  window.umami.track(event, properties)
}

function getCurrentPath(): string {
  return typeof window === 'undefined' ? '/' : window.location.pathname
}

function getCodeLanguage(codeElement: Element | null): string {
  const languageClass = codeElement?.className.match(/language-([a-z0-9#+-]+)/i)?.[1]

  return languageClass ? languageClass.toLowerCase() : 'unknown'
}

function classifySnippet(snippet: string): string {
  const normalizedSnippet = snippet.toLowerCase()

  if (normalizedSnippet.includes('https://agentcoqui.com/install | bash')) {
    return 'installer-shell'
  }

  if (normalizedSnippet.includes('install.ps1 | iex')) {
    return 'installer-windows'
  }

  if (normalizedSnippet.includes('./install.sh --dev') || normalizedSnippet.includes('.\\install.ps1 -dev')) {
    return 'installer-dev'
  }

  if (
    /git clone https:\/\/github\.com\/(carmelosantana|agentcoqui)\/coqui\.git/.test(normalizedSnippet)
    && normalizedSnippet.includes('composer install')
  ) {
    return 'development-install'
  }

  if (normalizedSnippet.includes('./bin/coqui')) {
    return 'quick-start'
  }

  if (normalizedSnippet.includes('/space install')) {
    return 'toolkit-install'
  }

  return 'generic'
}

function trackCodeCopy(button: HTMLButtonElement): void {
  const container = button.parentElement?.parentElement
  const codeElement = container?.querySelector('pre code') || null
  const snippet = normalizeWhitespace(codeElement?.textContent || '')

  if (!snippet) {
    return
  }

  const snippetType = classifySnippet(snippet)
  const page = getCurrentPath()

  trackEvent('docs-code-copy', {
    page: truncate(page, 120),
    language: getCodeLanguage(codeElement),
    snippetType,
    snippetPreview: truncate(snippet, 180),
  })

  if (snippetType !== 'generic') {
    trackEvent('docs-install-command-copy', {
      page: truncate(page, 120),
      snippetType,
      snippetPreview: truncate(snippet, 180),
    })
  }
}

function isCopyPageButton(button: HTMLButtonElement): boolean {
  return button.title === 'Copy page' || normalizeWhitespace(button.textContent || '') === 'Copy page'
}

function isSearchResultLink(anchor: HTMLAnchorElement): boolean {
  return Boolean(anchor.closest('.nextra-search-results'))
}

function trackSearchResultClick(anchor: HTMLAnchorElement): void {
  const href = anchor.getAttribute('href') || ''
  const label = normalizeWhitespace(anchor.textContent || '') || 'unknown'

  trackEvent('docs-search-result-click', {
    page: truncate(getCurrentPath(), 120),
    href: truncate(href, 320),
    label: truncate(label, 160),
  })
}

function getInstallResource(href: string): string | null {
  if (href.includes('agentcoqui.com/install')) {
    return 'installer-redirect'
  }

  if (href.includes('coqui-installer/main/install.sh')) {
    return 'install-sh'
  }

  if (href.includes('coqui-installer/main/install.ps1')) {
    return 'install-ps1'
  }

  return null
}

function trackInstallLink(anchor: HTMLAnchorElement): boolean {
  const href = anchor.getAttribute('href') || ''
  const resource = getInstallResource(href)

  if (!resource) {
    return false
  }

  const label = normalizeWhitespace(anchor.textContent || '') || resource

  trackEvent('docs-install-link-click', {
    page: truncate(getCurrentPath(), 120),
    resource,
    href: truncate(href, 320),
    label: truncate(label, 120),
  })

  return true
}

function trackShellNavigation(anchor: HTMLAnchorElement): void {
  let location: 'header' | 'sidebar' | 'toc' | 'footer' | null = null

  if (anchor.closest('.nextra-navbar')) {
    location = 'header'
  } else if (anchor.closest('.nextra-sidebar')) {
    location = 'sidebar'
  } else if (anchor.closest('.nextra-toc')) {
    location = 'toc'
  } else if (anchor.closest('.coqui-footer')) {
    location = 'footer'
  }

  if (location === null) {
    return
  }

  const href = anchor.getAttribute('href') || ''
  const label = truncate(anchor.textContent?.trim() || 'unknown', 120)
  const normalizedHref = truncate(href, 320)
  const isExternal = anchor.target === '_blank' || /^https?:\/\//.test(href)

  if (isExternal) {
    trackEvent('outbound-link', { location, href: normalizedHref, label })
    return
  }

  trackEvent('docs-nav-click', { location, href: normalizedHref, label })
}

export function UmamiAnalytics() {
  const websiteId = process.env.NEXT_PUBLIC_UMAMI_WEBSITE_ID
  const scriptUrl = process.env.NEXT_PUBLIC_UMAMI_SRC_URL
    || process.env.NEXT_PUBLIC_UMAMI_URL
    || 'https://cloud.umami.is/script.js'
  const configuredHostUrl = process.env.NEXT_PUBLIC_UMAMI_HOST_URL
  const enabled = process.env.NEXT_PUBLIC_ENABLE_UMAMI !== 'false'
  const domains = process.env.NEXT_PUBLIC_UMAMI_DOMAINS
  const debug = process.env.NEXT_PUBLIC_UMAMI_DEBUG === 'true'
  const pathname = usePathname()
  const [isReady, setIsReady] = useState(false)
  const lastTrackedPath = useRef<string | null>(null)

  const pageKey = useMemo(() => pathname, [pathname])

  const hostUrl = useMemo(() => {
    if (configuredHostUrl) {
      return configuredHostUrl
    }

    return scriptUrl.replace(/\/script\.js$/, '')
  }, [configuredHostUrl, scriptUrl])

  useEffect(() => {
    if (!enabled || !isReady || typeof window === 'undefined' || !window.umami || !pageKey) {
      return
    }

    if (lastTrackedPath.current === pageKey) {
      return
    }

    if (debug) {
      console.info('[Umami Debug] tracking docs pageview:', pageKey)
    }

    window.umami.track(() => ({ url: pageKey, title: document.title }))
    lastTrackedPath.current = pageKey
  }, [debug, enabled, isReady, pageKey])

  useEffect(() => {
    if (!enabled || !isReady || typeof window === 'undefined' || !window.umami) {
      return
    }

    const handleClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null
      const button = target?.closest('button') as HTMLButtonElement | null

      if (button?.title === 'Copy code') {
        trackCodeCopy(button)
        return
      }

      if (button && isCopyPageButton(button)) {
        trackEvent('docs-copy-page', { page: truncate(getCurrentPath(), 120) })
        return
      }

      const anchor = target?.closest('a') as HTMLAnchorElement | null

      if (!anchor) {
        return
      }

      if (isSearchResultLink(anchor)) {
        trackSearchResultClick(anchor)
        return
      }

      if (trackInstallLink(anchor)) {
        return
      }

      trackShellNavigation(anchor)
    }

    document.addEventListener('click', handleClick, true)

    return () => {
      document.removeEventListener('click', handleClick, true)
    }
  }, [enabled, isReady])

  if (!websiteId || !enabled) {
    return null
  }

  return (
    <Script
      src={scriptUrl}
      data-website-id={websiteId}
      data-auto-track="false"
      data-host-url={hostUrl}
      {...(domains ? { 'data-domains': domains } : {})}
      strategy="afterInteractive"
      onLoad={() => {
        if (debug) {
          console.info('[Umami Debug] script loaded:', scriptUrl)
        }

        setIsReady(true)
      }}
      onError={() => {
        if (debug) {
          console.error('[Umami Debug] script failed to load:', scriptUrl)
        }
      }}
    />
  )
}