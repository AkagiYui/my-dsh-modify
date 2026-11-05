#!/usr/bin/env node
/**
 * Show exactly what each package would upload, without publishing anything.
 *
 * `npm pack --dry-run` is the only reliable view of the tarball: `files` is a
 * whitelist, but package.json, README and LICENSE are always added, and a stray
 * `.DS_Store` or `.npmrc` would still slip in if it were not ignored.
 *
 * Run with `npm run pack:dry`.
 */
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PACKAGES = path.join(ROOT, 'packages')
const SUSPICIOUS = [/(^|\/)node_modules\//, /(^|\/)\.git\//, /(^|\/)\.DS_Store$/, /(^|\/)\.npmrc$/, /(^|\/)\.env/, /\.log$/]
const SIZE_LIMIT = 1024 * 1024

const rows = []
const warnings = []

for (const entry of fs.readdirSync(PACKAGES, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue
  const dirPath = path.join(PACKAGES, entry.name)

  let report
  try {
    const stdout = execFileSync('npm', ['pack', '--dry-run', '--json'], {
      cwd: dirPath,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    report = JSON.parse(stdout)[0]
  } catch (error) {
    warnings.push(`packages/${entry.name}: npm pack failed — ${String(error.stderr ?? error.message).trim().split('\n')[0]}`)
    continue
  }

  const paths = report.files.map((file) => file.path)
  for (const filePath of paths) {
    for (const pattern of SUSPICIOUS) {
      if (pattern.test(filePath)) warnings.push(`packages/${entry.name}: tarball contains ${filePath}`)
    }
  }
  if (report.size > SIZE_LIMIT) {
    warnings.push(`packages/${entry.name}: tarball is ${(report.size / 1024).toFixed(0)} KiB, unusually large`)
  }

  rows.push({
    package: `${report.name}@${report.version}`,
    files: report.entryCount,
    packed: `${(report.size / 1024).toFixed(1)} KiB`,
    unpacked: `${(report.unpackedSize / 1024).toFixed(1)} KiB`,
    contents: paths.join(' '),
  })
}

const width = Math.max(...rows.map((row) => row.package.length), 7)
process.stdout.write(`${'PACKAGE'.padEnd(width)}  FILES  PACKED    UNPACKED\n`)
for (const row of rows) {
  process.stdout.write(
    `${row.package.padEnd(width)}  ${String(row.files).padStart(5)}  ${row.packed.padEnd(8)}  ${row.unpacked}\n`,
  )
}

process.stdout.write('\nTarball contents\n')
for (const row of rows) process.stdout.write(`  ${row.package}: ${row.contents}\n`)

if (warnings.length > 0) {
  process.stdout.write('\nWarnings\n')
  for (const warning of warnings) process.stdout.write(`  ${warning}\n`)
  process.exit(1)
}

process.stdout.write('\nNo unexpected files in any tarball.\n')
