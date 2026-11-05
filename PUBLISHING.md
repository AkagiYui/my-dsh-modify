# Publishing

These packages are published to npm one at a time. DSH installs a bundle from a
package spec, so npm is the distribution channel; GitHub is where the source,
issues and release notes live.

## Before the first publish

### 1. Own the scope

Every package is named `@akagiyui/<name>`, which means the npm account **must**
be `akagiyui` (or an organization you belong to). Check:

```bash
npm login
npm whoami        # must print akagiyui
```

If your npm username is different, rename the scope everywhere first. The scope
appears in the manifest, the bundle patch, and the client factory id — all three
must agree, which is exactly what `npm run check` verifies:

```bash
# macOS
grep -rl '@akagiyui/' . --exclude-dir=.git | xargs sed -i '' 's|@akagiyui/|@yourname/|g'
# GNU/Linux
grep -rl '@akagiyui/' . --exclude-dir=.git | xargs sed -i 's|@akagiyui/|@yourname/|g'

npm run check
```

### 2. Turn on 2FA

npm requires it for publishing and it protects the name you are about to claim.
Expect an OTP prompt on every publish.

### 3. Confirm the names are free

```bash
npm view @akagiyui/ui-tweaks version    # 404 (non-zero exit) means free
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
npm view @akagiyui/ui-tweaks version dist.tarball
```

And verify that it **installs**: use a throwaway DSH profile and install by spec
(`plugin_manager` → `install_bundle` → `@akagiyui/ui-tweaks`). Installing into
the profile you use every day does not prove that a clean profile works.

## Versions

Published versions are immutable. Never reuse one.

```bash
# bump the file, commit, tag, publish
cd packages/ui-tweaks
npm version patch --no-git-tag-version
git commit -am "ui-tweaks: 1.4.1"
git tag ui-tweaks@1.4.1
git push origin main --tags
npm publish
```

`npm version` without `--no-git-tag-version` also creates a `v1.4.1` tag, which
collides across packages in a monorepo. Use the `<package>@<version>` form above.

### If you publish something wrong

- **Missing files, wrong metadata, still usable:** publish a patch version. Do
  not unpublish.
- **Broken for everyone:** `npm deprecate @akagiyui/ui-tweaks@1.4.1 "Broken, use 1.4.2"`,
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
- Releases: `gh release create ui-tweaks@1.4.1 --notes "..."`.

## CI and automated publishing

Two workflows live in `.github/workflows/`:

| File | Trigger | Does |
| --- | --- | --- |
| `ci.yml` | push to `main`, any pull request, manual | `npm run check`, `npm run pack:dry`, and a check that `client.js` still matches `src/`, on Node 20/22/24 |
| `publish.yml` | a tag shaped `<package>@<version>` | publishes exactly that package, after re-running the checks |

`ci.yml` needs no `npm ci`: the packages have no dependencies and the checks are
plain node scripts, so a run takes seconds.

`publish.yml` uses **Trusted Publishing**, so there is no stored token:

1. On npmjs.com, open the package → Settings → Trusted publishing, and bind
   repository `AkagiYui/my-dsh-modify` with workflow filename `publish.yml`.
   Repeat per package, once, before the first tag push.
2. npm then accepts the OIDC token that GitHub mints for the job
   (`permissions: id-token: write`) and attaches a provenance attestation.
3. Release with a tag, and the workflow picks the package out of the tag name:

```bash
git tag ui-tweaks@1.4.1
git push origin ui-tweaks@1.4.1
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
