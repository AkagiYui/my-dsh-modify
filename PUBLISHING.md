# Publishing

These packages are published to npm one at a time. DSH installs a bundle from a
package spec, so npm is the distribution channel; GitHub is where the source,
issues and release notes live.

## Before the first publish

### 1. Own the names

The three packages are named:

| Directory | npm name | Why |
| --- | --- | --- |
| `packages/ui-tweaks` | `@akagiyui/dsh-ui-tweaks` | `dsh-ui-tweaks` without a scope was already taken on npm |
| `packages/balance-chip` | `dsh-balance-chip` | unscoped name was free |
| `packages/copy-reply-image` | `dsh-copy-reply-image` | unscoped name was free |

Only the scoped one depends on the npm account being `akagiyui` (or an
organization you belong to):

```bash
npm login
npm whoami        # must print akagiyui
```

The package name appears in three places — the manifest, the bundle patch, and
the client factory id — and all three must agree. `npm run check` verifies
exactly that, so rename with confidence:

```bash
# change a name, then:
npm run check
```

### 2. Turn on 2FA

npm requires it for publishing and it protects the names you are about to claim.
Expect an OTP prompt on every publish.

### 3. Confirm the names are free

```bash
npm view @akagiyui/dsh-ui-tweaks version   # 404 (non-zero exit) means free
npm view dsh-balance-chip version
npm view dsh-copy-reply-image version
```

## Pre-flight, every time

```bash
npm run check      # manifests, patch rows, client ids, locales, icons, syntax
npm run pack:dry   # the exact tarball, listed file by file
```

`npm run check` is not decoration. It catches the two silent failures of this
repo: a `cordis.patch.yml` still naming the old package, and a `client.js` whose
factory id does not equal the package name. Both install cleanly and then do
nothing.

`npm run pack:dry` shows what actually uploads — `files` is a whitelist, but
`package.json`, `README.md` and `LICENSE` are always added, and a stray file you
forgot to ignore would show up here.

## Publish one package

```bash
cd packages/ui-tweaks
npm publish
```

`publishConfig.access: "public"` in the manifest already makes a scoped package
public; `--access public` on the command line does the same thing. Without one of
them a scoped publish is private and rejected unless you pay for a private scope.

Then verify the registry, not your terminal:

```bash
npm view @akagiyui/dsh-ui-tweaks version dist.tarball
```

And verify that it **installs**: use a throwaway DSH profile and install by spec
(`plugin_manager` → `install_bundle` → `@akagiyui/dsh-ui-tweaks`). Installing into
the profile you use every day does not prove that a clean profile works.

## Versions

Published versions are immutable. Never reuse one.

```bash
# bump the file, commit, tag, publish
cd packages/ui-tweaks
npm version patch --no-git-tag-version
git commit -am "ui-tweaks: 0.1.1"
git tag ui-tweaks@0.1.1
git push origin main --tags
npm publish
```

`npm version` without `--no-git-tag-version` also creates a `v0.1.1` tag, which
collides across packages in a monorepo. Use the `<package>@<version>` form above.

The tag carries the **directory** name, not the npm name: `ui-tweaks@0.1.1`
publishes `@akagiyui/dsh-ui-tweaks@0.1.1`. That keeps `/` out of tags — GitHub's
tag filter `*@*` does not match across a slash — and `publish.yaml` maps the
directory to whatever name its manifest declares.

### If you publish something wrong

- **Missing files, wrong metadata, still usable:** publish a patch version. Do
  not unpublish.
- **Broken for everyone:** `npm deprecate @akagiyui/dsh-ui-tweaks@0.1.1 "Broken, use 0.1.2"`,
  then publish the fix.
- **Unpublish** only works within 72 hours, only if nothing depends on the
  version, and the version number is burned afterwards.

## GitHub

```bash
git remote add origin git@github.com:AkagiYui/my-dsh-modify.git
git push -u origin main
```

Notes for this account:

- `gh auth status` shows SSH as the git protocol. SSH pushes are not limited by
  token scopes, so `.github/workflows/` files push fine over SSH. A **HTTPS**
  push with this token would be refused until you add the `workflow` scope
  (`gh auth refresh -s workflow`), because that scope governs workflow files
  specifically.
- A workflow only appears under the Actions tab after it has been pushed; there
  is nothing to see on GitHub before the first push.
- Releases: `gh release create ui-tweaks@0.1.1 --notes "..."`.

## CI and automated publishing

Two workflows live in `.github/workflows/`:

| File | Trigger | Does |
| --- | --- | --- |
| `ci.yaml` | push to `main`, any pull request, manual | `npm run check`, `npm run pack:dry`, and a check that `client.js` still matches `src/`, on Node 20/22/24 |
| `publish.yaml` | a tag shaped `<package>@<version>` | publishes exactly that package, after re-running the checks |

`ci.yaml` needs no `npm ci`: the packages have no dependencies and the checks are
plain node scripts, so a run takes seconds.

`publish.yaml` uses **Trusted Publishing**, so there is no stored token:

1. On npmjs.com, open the package → Settings → Trusted publishing, and bind
   repository `AkagiYui/my-dsh-modify` with workflow filename `publish.yaml`.
   Repeat per package, once, before the first tag push.
2. npm then accepts the OIDC token that GitHub mints for the job
   (`permissions: id-token: write`) and attaches a provenance attestation.
3. Release with a tag, and the workflow picks the package out of the tag name:

```bash
git tag ui-tweaks@0.1.1
git push origin ui-tweaks@0.1.1
```

The job refuses a tag whose version does not match `package.json`, and refuses a
tag naming a directory that does not exist, so a typo fails the run instead of
publishing the wrong thing.

Two footnotes:

- Trusted Publishing needs npm >= 11.5.1; Node 22 ships npm 10, which is why the
  workflow upgrades npm first.
- The older route still works and needs no npm-side setup: create a **granular
  access token** restricted to this scope, store it as `NPM_TOKEN`, and add
  `registry-url: https://registry.npmjs.org` plus
  `NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}` to the publish step.

## Checklist

- [ ] `npm whoami` prints the scope owner
- [ ] `npm run check` passes
- [ ] `npm run pack:dry` shows only intended files
- [ ] `engines.dsh` still matches the Harness version this was verified against
- [ ] version bumped, `CHANGELOG`/release note written
- [ ] published, then installed into a **clean** profile by package spec
- [ ] README's "verified against" line still true
