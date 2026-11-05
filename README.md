# my-dsh-modify

DeepSeek Harness (DSH) Web UI plugins, kept in one repository.

Every package here is a **Cordis bundle**: a package whose `package.json`
declares `dsh.bundle.patch` (a YAML patch that inserts the plugin rows) and, for
UI features, a `dsh.client` half whose factory registers into the browser's
`window.__ModuleLoader__` under an id equal to the package name.

## Packages

| Package | What it does |
| --- | --- |
| [`@akagiyui/ui-tweaks`](packages/ui-tweaks/README.md) | Five switches in one: content width, sidebar account label, hide feedback, hide the sidebar More row, skip the Full access dialog |
| [`@akagiyui/balance-chip`](packages/balance-chip/README.md) | Balance, today's spend and peak/off-peak window in the composer, plus per-turn cost |
| [`@akagiyui/copy-reply-image`](packages/copy-reply-image/README.md) | Renders a finalized reply as a PNG card and copies it |

`ui-tweaks` absorbs what used to be four separate single-purpose bundles
(content width, sidebar account label, hide feedback, hide the More row). They
are switches inside it now, not packages, so there is nothing to install twice.

## Install

DSH installs a bundle by package spec. Ask the agent, or call the tool directly:

```text
plugin_manager   action: install_bundle   target: "@akagiyui/ui-tweaks"
```

Each package declares `engines.dsh`, so a Harness version the package was not
built against is refused instead of half-loaded.

## Compatibility

All packages are built and verified against **DeepSeek Harness 0.2.1-rc.5** and
declare `engines.dsh: >=0.2.1-rc.5`.

Most of these features exist because the shell renders something itself, with no
slot to unregister, so they work on the rendered markup: `data-*` attributes,
CSS custom properties, slot selectors and, where a row is data-driven, a
`MutationObserver` over localized labels. That is the honest trade-off of an
extension API that does not cover every surface: an update that renames a hook or
adds a translation can stop a switch from applying, and it will do so quietly —
the switch simply stops having an effect. Each package README says which hooks it
depends on.

## Layout

```text
packages/<name>/
  package.json        manifest: name, dsh.bundle, dsh.client, files, engines
  cordis.patch.yml    the bundle patch: inserts one row named after the package
  index.js            Host half (empty apply for UI-only bundles)
  client.js           Client half: window.__ModuleLoader__.load({ id, factory })
  locale/{en,zh}.json meta.title / meta.description shown by the plugin manager
  icon.svg            plugin row artwork (<= 256 KiB)
copy-reply-image additionally keeps src/ and build.mjs: its client.js is generated.
```

## Why one repository

The three packages share one patch dialect, one locale convention, one display
checklist and one compatibility target. Keeping them together means a Harness API
change is one commit across all of them, and the consistency check below runs
over all of them at once. They stay separate packages rather than one, because
you may want the balance chip without the interface tweaks. Publishing is still
per package, and each manifest carries `repository.directory`, so npm links
straight to the subfolder.

## Development

```bash
npm run check      # manifests, patch rows, client factory ids, locales, icons, exports, syntax
npm run build      # regenerate packages/copy-reply-image/client.js from src/
npm run pack:dry   # the exact tarball each package would upload
```

`npm run check` is the important one. The failures it catches are silent ones:
a package rename that misses `cordis.patch.yml` still installs but inserts a row
naming a package that does not exist, and a rename that misses the client factory
`id` still loads but never registers, because DSH resolves the browser half by
package name.

GitHub Actions runs the same commands on every push and pull request
([`ci.yml`](.github/workflows/ci.yml)), plus a check that the generated
`client.js` still matches `src/`. Pushing a tag named `<package>@<version>`
publishes that one package ([`publish.yml`](.github/workflows/publish.yml)).

## Publishing

See [PUBLISHING.md](PUBLISHING.md). Short version: `npm login`, then from a
package directory `npm publish` (scoped packages need `--access public`, which
`publishConfig` already sets).

## License

MIT — see [LICENSE](LICENSE).
