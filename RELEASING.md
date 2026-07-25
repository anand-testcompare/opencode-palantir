# Releasing

This repo publishes the OpenCode plugin package to npm:

- Package: `@openontology/opencode-palantir`
- Registry: npmjs.com

Releases are automated via **Release Please** + **GitHub Actions** + **npm Trusted Publishing (OIDC)**.

## Release channels

### Stable (`latest`)

Stable releases are created by merging the Release Please PR (example: `chore(main): release 0.1.1`).

What happens after merge:

1. The `Release` workflow runs on `main`
2. Release Please creates a git tag (e.g. `v0.1.1`) and a GitHub Release
3. The workflow dispatches `Publish Package` with `tag=latest`
4. `Publish Package` publishes to npm using OIDC (no npm token)

### Prerelease (`next`)

While a Release Please PR is open, the `Release` workflow dispatches `Publish Package` with `tag=next`.

The prerelease version is computed in `.mise/tasks/publish`:

- Base version = the version currently in `package.json` (e.g. `0.1.0`)
- Published version = `<base>-next.<N>`
- `<N>` is the number of commits since the most recent git tag

This is why `next` versions jump frequently and why they reset after a new tag is created.

## How versions are chosen (0.1.x line)

Release Please uses Conventional Commits.

We intentionally stay on a `0.1.x` stable line until we decide to go `1.0.0`.
The current policy (see `release-please-config.json`) is:

- `fix:` -> patch bump (`0.1.0` -> `0.1.1`)
- `feat:` -> patch bump while major is `0` (keeps the stable line in `0.1.x`)
- `feat!:` / `fix!:` / `BREAKING CHANGE:` -> minor bump (`0.1.x` -> `0.2.0`)

If you need a specific version, add a `Release-As: X.Y.Z` footer to a commit on `main`.

## Manual publishing (rare)

The easiest safe manual publish is to run the GitHub workflow:

- Prerelease: `Publish Package` -> input `tag=next`
- Stable: `Publish Package` -> input `tag=latest`

Avoid publishing `latest` manually unless you also intend to cut a matching git tag and GitHub Release.

## GitHub Packages

GitHub does not automatically mirror npmjs.com packages into the GitHub "Packages" UI.

If you want versions to appear under GitHub Packages, you must publish an npm package to
GitHub Packages (`npm.pkg.github.com`) as an additional registry.

Note: GitHub Packages scopes are tied to the GitHub org/user (e.g. `@anandpant/*`). If you
want the GitHub package scope to match `@openontology/*`, the repo needs to live under a GitHub org
named `openontology`.
