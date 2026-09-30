# docs.agentcoqui.com

The Coqui documentation site, built with Nextra.

Nothing in `content/` is written by hand. `scripts/sync-docs.mjs` generates it from the core repo, [carmelosantana/coqui](https://github.com/carmelosantana/coqui):

- `docs/*.md` become the Features, Guides and Development pages (the routes are listed in `DOC_ROUTES`)
- curated `examples/**` files become the Examples pages (`EXAMPLE_ROUTES`)
- `README.md` becomes the landing page and Getting Started

To change what a page says, edit the doc in core, not the `.mdx` file here.

## Regenerating content

```bash
git -C ../../Core/coqui fetch
pnpm sync-docs          # reads core at origin/main
pnpm check-content      # fails on broken internal links
git add content && git commit
```

The generator reads core from a git ref, not the working tree, so a core checkout on a feature branch cannot leak into the site. Settings:

| Variable | Default | Purpose |
| --- | --- | --- |
| `COQUI_REPO_ROOT` | `../../Core/coqui` | Core git checkout |
| `COQUI_REF` | `origin/main` | Ref to publish. `WORKTREE` reads the working tree (never commit that output). |
| `COQUI_CONTENT_DIR` | `./content` | Output directory |

The generator deletes anything in `content/` it did not produce, so a page whose doc was removed from core disappears on the next sync.

`pnpm dev` syncs once from `origin/main`, then watches the core working tree so you can preview doc edits live.

## Deploying

Vercel builds from `main` and deploys the committed `content/`; the sync is skipped on Vercel (`VERCEL=1`). Publishing a core docs change therefore means: regenerate, commit `content/`, push.

## Checks

- `pnpm test` runs the generator and link-checker tests (`node --test`, no dependencies).
- `.github/workflows/docs-sync.yml` regenerates the site against core `main` on every push, pull request and weekly, fails on broken internal links, and reports when the committed `content/` is out of date with core.
