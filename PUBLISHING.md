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

- `gh auth status` shows SSH as the git protocol and the token scopes
  `admin:public_key, gist, read:org, repo`. That is enough for normal pushes.
- Pushing anything under `.github/workflows/` additionally needs the `workflow`
  scope: `gh auth refresh -s workflow`.
- Releases: `gh release create ui-tweaks@1.4.1 --notes "..."`.

## Automating it (optional)

npm supports **Trusted Publishing**: on the package's settings page you bind a
GitHub repository and a workflow filename; the workflow then publishes with a
short-lived OIDC token instead of a stored `NPM_TOKEN`, and npm attaches a
provenance attestation automatically.

```yaml
permissions:
  contents: read
  id-token: write        # required for OIDC
steps:
  - uses: actions/checkout@v4
  - uses: actions/setup-node@v4
    with:
      node-version: 22
      registry-url: https://registry.npmjs.org
  - run: npm run check
  - run: npm publish --provenance --access public
    working-directory: packages/ui-tweaks
```

The older route — a granular access token restricted to this scope, stored as
`NPM_TOKEN` — still works and is simpler to start with.

## Checklist

- [ ] `npm whoami` prints the scope owner
- [ ] `npm run check` passes
- [ ] `npm run pack:dry` shows only intended files
- [ ] `engines.dsh` still matches the Harness version this was verified against
- [ ] version bumped, `CHANGELOG`/release note written
- [ ] published, then installed into a **clean** profile by package spec
- [ ] README's "verified against" line still true
