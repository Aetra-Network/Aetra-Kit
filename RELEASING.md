# Releasing @aetra-network/kit

`@aetra-network/kit` sits at the top of the package family: it peer-depends on
`@aetra-network/sdk`, `@aetra-network/connect`, and `@aetra-network/connect-react`.
That constraint drives both the publish order and why kit has no standalone CI.

## Publish order

Publish the family in dependency order — a package can only be published after
everything it depends on already exists on the registry:

1. `@aetra-network/sdk` — no internal deps
2. `@aetra-network/connect` — depends on sdk
3. `@aetra-network/connect-react` — depends on sdk + connect
4. `@aetra-network/kit` — depends on all three (publish last)

kit's `peerDependencies` on the three siblings resolve for **external** installs
only after those siblings have each been published to GitHub Packages at least
once. Publishing kit before them leaves consumers unable to install it.

## Why kit has no standalone CI workflow

In this monorepo kit links its siblings via `file:../…` devDependencies
(`@aetra-network/sdk` → `file:../sdk`, and likewise for connect / connect-react).
Those paths point **outside** the kit repo, so a standalone checkout — which is
what CI gets — cannot `npm install`: the `file:` links dangle and every later
step fails to resolve the imports.

The publish workflow (`.github/workflows/publish.yml`) works around this only at
release time, by rewriting the three `file:../…` links to the registry ranges
already declared in `peerDependencies` before `npm install`. That rewrite
depends on sdk / connect / connect-react having already been published (the
bootstrapping case above), so it can't stand in for ordinary push/PR CI.

Because of that, kit is **not** validated by a push/pull_request CI workflow
(unlike `@aetra-network/sdk`, which is self-contained and has one). Instead,
validate kit locally inside the monorepo, where the `file:../…` links resolve
against the real sibling checkouts:

```bash
npm run check   # typecheck && test && build
```

Run that before tagging a kit release.
