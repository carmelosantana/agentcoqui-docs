import { Footer, LastUpdated, Layout, Navbar } from 'nextra-theme-docs'
import { Head } from 'nextra/components'
import { getPageMap } from 'nextra/page-map'
import { Geist, Geist_Mono } from 'next/font/google'
import type { Metadata, Viewport } from 'next'
import { DocsSearch } from '@/components/docs-search'
import { UmamiAnalytics } from '@/components/umami-analytics'
import 'nextra-theme-docs/style.css'
import './globals.css'

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
  display: 'swap',
  preload: false,
})

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
  display: 'swap',
  preload: false,
})

export const metadata: Metadata = {
  title: {
    default: 'Coqui Docs',
    template: '%s — Coqui Docs',
  },
  description:
    'Coqui is a lightweight, hackable agent runtime that adapts to how you work. Automate workflows, persist memory across sessions, schedule recurring tasks, and extend its abilities at runtime.',
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_BASE_URL || 'https://docs.agentcoqui.com'
  ),
  alternates: {
    canonical: '/',
  },
  openGraph: {
    title: 'Coqui Docs',
    description:
      'Installation guides, feature references, and development docs for Coqui.',
    url: '/',
    siteName: 'Coqui Docs',
    locale: 'en_US',
    type: 'website',
    images: [
      {
        url: '/opengraph-image',
        width: 1200,
        height: 630,
        alt: 'Coqui Docs',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Coqui Docs',
    description:
      'Installation guides, feature references, and development docs for Coqui.',
    images: ['/opengraph-image'],
  },
  icons: {
    icon: [
      { url: '/favicon.png', type: 'image/png' },
      { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: '/apple-icon.png',
    shortcut: '/favicon.png',
  },
}

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#131816' },
  ],
}

const logo = (
  <span className="coqui-navbar-logo">
    <img
      src="/coqui-bot-512.webp"
      alt="Coqui"
      width={32}
      height={32}
      className="coqui-navbar-logo__mark"
    />
    <span className="coqui-navbar-logo__text">Coqui Docs</span>
    <span className="coqui-navbar-logo__meta">PHP 8.4+ / MIT License</span>
  </span>
)

const navbar = (
  <Navbar
    logo={logo}
    projectLink="https://github.com/carmelosantana/coqui"
    chatLink="https://discord.gg/TaCpZVqbbT"
  />
)

const footer = (
  <Footer>
    <div className="coqui-footer">
      <div className="coqui-footer__top">
        <a
          href="https://agentcoqui.com"
          target="_blank"
          rel="noopener noreferrer"
          className="coqui-footer__brand"
        >
          <img
            src="/coqui-bot-512.webp"
            alt="Coqui"
            width={36}
            height={36}
            className="coqui-footer__mark"
          />
          <span className="coqui-footer__title-group">
            <span className="coqui-footer__title">Coqui Docs</span>
            <span className="coqui-footer__tag">Personal operating system docs</span>
          </span>
        </a>

        <nav className="coqui-footer__links" aria-label="Footer">
          <a href="/getting-started" className="coqui-shell-link">
            Getting started
          </a>
          <a href="/features" className="coqui-shell-link">
            Features
          </a>
          <a
            href="https://agentcoqui.com"
            target="_blank"
            rel="noopener noreferrer"
            className="coqui-shell-link"
          >
            Website
          </a>
          <a
            href="https://github.com/carmelosantana/coqui"
            target="_blank"
            rel="noopener noreferrer"
            className="coqui-shell-link"
          >
            GitHub
          </a>
          <a
            href="https://discord.gg/TaCpZVqbbT"
            target="_blank"
            rel="noopener noreferrer"
            className="coqui-shell-link"
          >
            Discord
          </a>
        </nav>
      </div>

      <p className="coqui-footer__summary">
        Install, extend, and operate Coqui through a readable PHP runtime with
        persistent memory, background tasks, and toolkits.
      </p>

      <div className="coqui-footer__bottom">
        <span>MIT {new Date().getFullYear()} © Coqui Bot</span>
        <span>Built on php-agents.</span>
      </div>
    </div>
  </Footer>
)

const search =
  process.env.NODE_ENV === 'development'
    ? null
    : <DocsSearch placeholder="Search Coqui docs..." />

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html
      lang="en"
      dir="ltr"
      suppressHydrationWarning
    >
      <Head>
      </Head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <UmamiAnalytics />
        <Layout
          navbar={navbar}
          pageMap={await getPageMap()}
          docsRepositoryBase="https://github.com/carmelosantana/agentcoqui-docs"
          footer={footer}
          // Pages are generated from core docs by scripts/sync-docs.mjs, so there
          // is no per-page file to edit here; edits belong in carmelosantana/coqui.
          editLink={null}
          search={search}
          darkMode={true}
          lastUpdated={<LastUpdated locale="en-US">Last updated</LastUpdated>}
          feedback={{
            content: 'Question? Give us feedback →',
            labels: 'documentation',
            link: 'https://github.com/carmelosantana/coqui/issues/new',
          }}
          navigation={{ prev: true, next: true }}
          sidebar={{ defaultMenuCollapseLevel: 1, autoCollapse: true, toggleButton: true }}
          toc={{
            title: 'On This Page',
            backToTop: 'Back to top',
            float: true,
            extraContent: (
              <div className="coqui-toc-note">
                <div className="coqui-toc-note__title">Need help shipping?</div>
                <p className="coqui-toc-note__body">
                  Join the Coqui Discord community for install help, toolkit
                  questions, and release updates.
                </p>
                <a
                  href="https://discord.gg/TaCpZVqbbT"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="coqui-shell-link coqui-toc-note__link"
                >
                  Join Discord
                </a>
              </div>
            ),
          }}
        >
          {children}
        </Layout>
      </body>
    </html>
  )
}
