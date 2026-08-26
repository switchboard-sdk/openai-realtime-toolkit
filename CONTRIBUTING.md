# Contributing

## Development

```sh
npm run build       # tsc → dist/ (JS + .d.ts); also runs on publish via prepare
npm run typecheck   # tsc --noEmit
npm run lint        # ESLint (src)
npm run format      # Prettier
```

`main`/`types` resolve to the built `dist/`; `react-native`/`source` resolve to
`src/` so Metro uses the TypeScript directly (no prebuild needed in dev).

### Running the example app

See [`example/README.md`](example/README.md) for the full setup. Note that it needs
**Ruby 3.1+** — `example/Gemfile.lock` is resolved with Ruby 3.4 / Bundler 2.6.9, and
the Ruby that ships with macOS is 2.6.

### Testing against a real consumer app

[`example/`](example) depends on the checkout directly (`file:..`), so it picks up
`src/` changes with no extra step. To test a *separate* app the way a user would
install the package, pack a tarball:

```sh
npm install     # must come first: `npm pack` runs `prepare` → `tsc`, so without the
                # devDependencies it fails with "tsc: command not found" (npm code 127)
npm pack        # → synervoz-openai-realtime-toolkit-0.1.0.tgz

cd /path/to/that-app
npm install /path/to/openai-realtime-toolkit/synervoz-openai-realtime-toolkit-0.1.0.tgz
```

Install the tarball, not `file:../openai-realtime-toolkit` — a symlinked package
breaks Metro resolution and duplicates React. The tarball is a snapshot, so re-pack
and re-install after every change, or the app keeps building against the old API.

## Tests

Run the unit suite with:

```sh
npm test
```

`npm run test:cov` runs the same suite and enforces the coverage thresholds in
`jest.config.js` — this is what CI runs (see
[`.github/workflows/ci.yml`](.github/workflows/ci.yml)).

## Release

Releases are published to npm automatically when a version tag is pushed.
Versions follow [Semantic Versioning](https://semver.org/): `MAJOR.MINOR.PATCH` —
increment `MAJOR` for breaking changes, `MINOR` for new features, `PATCH` for
bug fixes.

1. Update [`CHANGELOG.md`](CHANGELOG.md): move the `[Unreleased]` entries under a
   new version heading with the release date.

2. Bump the version with npm (this also creates the git tag):

```sh
npm version patch   # or minor / major
```

3. Push the commit and tag:

```sh
git push && git push --tags
```

The [release workflow](.github/workflows/publish.yml) builds the package and
publishes it to npm under the `@synervoz` scope.

> **Prerequisite:** the workflow authenticates with an `NPM_TOKEN` repository
> secret (a token with publish rights to the `@synervoz` scope). The package is
> MIT-licensed and publishes publicly with provenance
> (`publishConfig: { access: "public", provenance: true }`).
