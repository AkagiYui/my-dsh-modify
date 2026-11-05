#!/usr/bin/env node
/**
 * Validate every workspace package before it is packed or published.
 *
 * These checks exist because the failures they catch are silent. A rename that
 * misses `cordis.patch.yml` still installs, but the inserted row points at a
 * package name that does not resolve. A rename that misses the client factory
 * `id` still loads, but DSH resolves the browser half by package name, so the
 * UI never registers. Neither failure produces an error the user would see.
 *
 * Run with `npm run check`.
 */
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PACKAGES = path.join(ROOT, 'packages')
const ICON_LIMIT = 256 * 1024
const ICON_EXTENSIONS = new Set(['.svg', '.png', '.jpg', '.jpeg', '.webp'])
const NAME_RE = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/
const VERSION_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/

const problems = []
const fail = (label, message) => problems.push(`${label}: ${message}`)

/** Every file below `dir`, relative and forward-slashed. */
function walk(dir, prefix = '') {
  const out = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const relative = prefix === '' ? entry.name : `${prefix}/${entry.name}`
    if (entry.isDirectory()) out.push(...walk(path.join(dir, entry.name), relative))
    else if (entry.isFile()) out.push(relative)
  }
  return out
}

function globToRegExp(glob) {
  let source = ''
  for (let index = 0; index < glob.length; index += 1) {
    const character = glob[index]
    if (character === '*') {
      if (glob[index + 1] === '*') {
        source += '.*'
        index += 1
      } else {
        source += '[^/]*'
      }
    } else if ('\\^$.|?+()[]{}'.includes(character)) {
      source += `\\${character}`
    } else {
      source += character
    }
  }
  return new RegExp(`^${source}$`)
}

const rowIds = new Map()

for (const dir of fs.readdirSync(PACKAGES, { withFileTypes: true }).filter((e) => e.isDirectory())) {
  const name = dir.name
  const dirPath = path.join(PACKAGES, name)
  const label = `packages/${name}`
  const files = walk(dirPath)

  let manifest
  try {
    manifest = JSON.parse(fs.readFileSync(path.join(dirPath, 'package.json'), 'utf8'))
  } catch (error) {
    fail(label, `package.json is not valid JSON: ${error.message}`)
    continue
  }

  // Identity: lowercase, optionally scoped, published under a name the author owns.
  if (!NAME_RE.test(manifest.name ?? '')) fail(label, `name "${manifest.name}" is not a lowercase npm name`)
  if (manifest.private === true) fail(label, '"private": true blocks publishing')
  if (!VERSION_RE.test(manifest.version ?? '')) fail(label, `version "${manifest.version}" is not semver`)
  if (!manifest.description) fail(label, 'description is missing')
  if (manifest.license !== 'MIT') fail(label, 'license must be MIT (the LICENSE file in this repo is MIT)')
  if (!manifest.author) fail(label, 'author is missing')

  // Discoverability and provenance on the npm page.
  if (!Array.isArray(manifest.keywords) || manifest.keywords.length === 0) fail(label, 'keywords are missing')
  if (manifest.repository?.directory !== `packages/${name}`) {
    fail(label, `repository.directory must be "packages/${name}" so npm links to this folder`)
  }
  if (!manifest.repository?.url) fail(label, 'repository.url is missing')
  if (!manifest.homepage) fail(label, 'homepage is missing')
  if (!manifest.bugs?.url) fail(label, 'bugs.url is missing')

  // The harness refuses to install a bundle whose engines.dsh is unmet.
  if (!manifest.engines?.dsh) fail(label, 'engines.dsh is missing, so DSH cannot guard compatibility')
  if (manifest.publishConfig?.access !== 'public') {
    fail(label, 'publishConfig.access must be "public" or a scoped publish defaults to private')
  }

  // The bundle patch must name the same package as the manifest.
  const patchRelative = manifest.dsh?.bundle?.patch
  if (!patchRelative) {
    fail(label, 'dsh.bundle.patch is missing, so this is not a bundle')
  } else {
    const patchPath = path.join(dirPath, patchRelative)
    if (!fs.existsSync(patchPath)) {
      fail(label, `dsh.bundle.patch points at a missing file: ${patchRelative}`)
    } else {
      const patch = fs.readFileSync(patchPath, 'utf8')
      const names = [...patch.matchAll(/name:\s*['"]([^'"]+)['"]/g)].map((match) => match[1])
      if (!names.includes(manifest.name)) {
        fail(label, `cordis.patch.yml does not insert "${manifest.name}" (found: ${names.join(', ') || 'none'})`)
      }
      for (const match of patch.matchAll(/^\s*-\s*id:\s*(\S+)/gm)) {
        const seen = rowIds.get(match[1])
        if (seen !== undefined && seen !== label) {
          fail(label, `patch row id "${match[1]}" is already used by ${seen}`)
        }
        rowIds.set(match[1], label)
      }
    }
  }

  // A client half is resolved by package name: the factory id must match it.
  if (manifest.dsh?.client) {
    const clientRelative = manifest.exports?.['./client']
    if (typeof clientRelative !== 'string') {
      fail(label, 'dsh.client is declared but exports["./client"] is missing')
    } else {
      const clientPath = path.join(dirPath, clientRelative)
      if (!fs.existsSync(clientPath)) {
        fail(label, `exports["./client"] points at a missing file: ${clientRelative}`)
      } else {
        const client = fs.readFileSync(clientPath, 'utf8')
        if (!client.includes(`id: '${manifest.name}'`) && !client.includes(`id: "${manifest.name}"`)) {
          fail(label, `client factory id must equal the package name "${manifest.name}"`)
        }
      }
    }
  }

  // Every export target and every `files` entry must resolve to something.
  // Package exports are written with a leading `./`; walked paths are not.
  const bare = (value) => value.replace(/^\.\//, '')
  for (const [key, target] of Object.entries(manifest.exports ?? {})) {
    if (typeof target !== 'string') continue
    if (target.includes('*')) {
      const pattern = globToRegExp(bare(target))
      if (!files.some((file) => pattern.test(file))) {
        fail(label, `exports["${key}"] pattern "${target}" matches no file`)
      }
    } else if (!fs.existsSync(path.join(dirPath, target))) {
      fail(label, `exports["${key}"] points at a missing file: ${target}`)
    }
  }
  if (!Array.isArray(manifest.files) || manifest.files.length === 0) {
    fail(label, 'files is missing, so the tarball is not filtered')
  } else {
    for (const entry of manifest.files) {
      const pattern = globToRegExp(bare(entry))
      const resolved = fs.existsSync(path.join(dirPath, entry))
      const matched = entry.includes('*') && files.some((file) => pattern.test(file))
      if (!resolved && !matched) fail(label, `files entry "${entry}" matches nothing`)
    }
  }

  // Display metadata is read from locale JSON without activating the plugin.
  for (const locale of ['en', 'zh']) {
    const localePath = path.join(dirPath, 'locale', `${locale}.json`)
    if (!fs.existsSync(localePath)) {
      fail(label, `locale/${locale}.json is missing`)
      continue
    }
    let parsed
    try {
      parsed = JSON.parse(fs.readFileSync(localePath, 'utf8'))
    } catch (error) {
      fail(label, `locale/${locale}.json is not valid JSON: ${error.message}`)
      continue
    }
    if (!parsed.meta?.title) fail(label, `locale/${locale}.json has no meta.title`)
    if (!parsed.meta?.description) fail(label, `locale/${locale}.json has no meta.description`)
  }

  // Icons must be real, small, and a format the plugin manager renders.
  const iconRelative = manifest.exports?.['./icon'] ?? manifest.icon
  if (!iconRelative) {
    fail(label, 'exports["./icon"] is missing, so the plugin row falls back to default artwork')
  } else {
    const iconPath = path.join(dirPath, iconRelative)
    if (!fs.existsSync(iconPath)) {
      fail(label, `icon points at a missing file: ${iconRelative}`)
    } else {
      const stat = fs.statSync(iconPath)
      if (!ICON_EXTENSIONS.has(path.extname(iconPath).toLowerCase())) {
        fail(label, `icon extension ${path.extname(iconPath)} is not SVG/PNG/JPEG/WebP`)
      }
      if (stat.size === 0) fail(label, 'icon is empty')
      if (stat.size > ICON_LIMIT) fail(label, `icon is ${stat.size} bytes, above the ${ICON_LIMIT} byte limit`)
    }
  }

  // Syntax. client.js is a classic script but valid under the module goal too.
  for (const relative of ['index.js', manifest.exports?.['./client']].filter(Boolean)) {
    const filePath = path.join(dirPath, relative)
    if (!fs.existsSync(filePath)) continue
    try {
      execFileSync(process.execPath, ['--check', filePath], { stdio: 'pipe' })
    } catch (error) {
      const detail = String(error.stderr ?? '').split('\n').filter(Boolean).slice(0, 2).join(' ')
      fail(label, `${relative} does not parse: ${detail}`)
    }
  }

  if (problems.every((problem) => !problem.startsWith(`${label}:`))) {
    process.stdout.write(`\u2713 ${manifest.name}@${manifest.version}\n`)
  } else {
    process.stdout.write(`\u2717 ${manifest.name ?? label}@${manifest.version ?? '?'}\n`)
  }
}

if (problems.length > 0) {
  process.stdout.write('\n')
  for (const problem of problems) process.stdout.write(`  ${problem}\n`)
  process.stdout.write(`\n${problems.length} problem(s). Nothing should be published until these are fixed.\n`)
  process.exit(1)
}

process.stdout.write(`\nAll ${fs.readdirSync(PACKAGES).length} packages passed.\n`)
