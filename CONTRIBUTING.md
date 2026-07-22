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
