#!/usr/bin/env node
/**
 * Boot every Client half outside the Harness.
 *
 * `node --check` proves a file parses; it does not prove the module can run.
 * A client factory that throws on load fails silently in the browser — DSH
 * resolves the half by package name, so the UI simply never registers and no
 * error reaches the user. This script evaluates each `client.js` in a vm with a
 * stubbed `window.__ModuleLoader__`, DOM and storage, then calls its factory and
 * `apply`, which is where registration mistakes surface.
 *
 * The stubs are the maintenance cost: when a plugin starts using a browser API
 * that is not listed in `sandbox()`, add it there. A missing global shows up as
 * a failed boot, not as a false pass, so the failure mode is loud.
 *
 * Run with `npm run smoke` (also part of `npm run check`).
 */
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PACKAGES = path.join(ROOT, 'packages')

const noop = () => {}

/** Storage states a returning user can present. Every read must survive them. */
const STORAGE_CASES = {
  empty: () => null,
  'malformed JSON': () => '{not json',
  'wrong types': () => '42',
  'foreign keys': (key) => (key.includes('ui-tweaks') ? JSON.stringify({ width: 9, account: null }) : null),
}

function sandbox(storage) {
  const style = () => ({ setProperty: noop, removeProperty: noop, getPropertyValue: () => '' })
  const element = () => ({
    style: style(), dataset: {}, classList: { add: noop, remove: noop, contains: () => false },
    setAttribute: noop, removeAttribute: noop, appendChild: noop, remove: noop,
    addEventListener: noop, removeEventListener: noop, querySelector: () => null, querySelectorAll: () => [],
  })
  const context = {
    console, JSON, Math, Date, Promise, Map, Set, WeakMap, Symbol, Object, Array, String, Number, Boolean, Error, RegExp, Intl,
    setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask,
    URL, URLSearchParams, TextEncoder, TextDecoder, AbortController, AbortSignal, structuredClone,
    performance: { now: () => Date.now() },
    fetch: async () => ({ ok: false, status: 503, json: async () => ({}), text: async () => '' }),
    window: {
      __ModuleLoader__: { load: (entry) => { context.__entry = entry } },
      addEventListener: noop, removeEventListener: noop, matchMedia: () => ({ matches: false, addEventListener: noop }),
    },
    document: {
      querySelector: () => null, querySelectorAll: () => [], createElement: element,
      documentElement: element(), head: element(), body: element(),
      addEventListener: noop, removeEventListener: noop,
    },
    localStorage: {
      getItem: (key) => storage(key),
      setItem: noop, removeItem: noop, clear: noop,
    },
    MutationObserver: class { observe() {} disconnect() {} takeRecords() { return [] } },
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    navigator: { language: 'zh-CN', languages: ['zh-CN'] },
    requestAnimationFrame: (fn) => setTimeout(fn, 0),
    cancelAnimationFrame: clearTimeout,
    __entry: null,
  }
  context.globalThis = context
  context.self = context.window
  context.window.document = context.document
  return context
}

/** A recording ctx: enough of the Client surface to let `apply` register. */
function fakeContext(record) {
  const ctx = {
    effect(fn) {
      const dispose = fn()
      if (typeof dispose === 'function') record.disposers.push(dispose)
      return dispose
    },
    on(event) { record.events.push(event); return () => {} },
    get() { return undefined },
    inject(deps, fn) { record.injects.push(...[].concat(deps)); return fn(ctx) },
    slots: {
      inject(name, fn) { record.slots.push(name); return fn(ctx) },
      register(options) {
        record.registrations.push(options?.id ?? '(no id)')
        return () => {}
      },
    },
    locale: {
      t: (key) => String(key),
      // bind(ns) returns the translator a plugin calls with its own keys.
      bind: () => (key) => String(key),
      register: noop,
      language: 'zh-CN',
    },
  }
  return ctx
}

function boot(file, storage) {
  const source = fs.readFileSync(file, 'utf8')
  const context = sandbox(storage)
  vm.createContext(context)
  vm.runInContext(source, context, { filename: file })
  const entry = context.__entry
  if (!entry) throw new Error('never called window.__ModuleLoader__.load')
  if (typeof entry.factory !== 'function') throw new Error('entry has no factory')
  return entry
}

const failures = []
const rows = []

for (const dir of fs.readdirSync(PACKAGES).sort()) {
  const manifestPath = path.join(PACKAGES, dir, 'package.json')
  if (!fs.existsSync(manifestPath)) continue
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  const clientRelative = manifest.exports?.['./client']
  if (!manifest.dsh?.client || typeof clientRelative !== 'string') continue

  const file = path.join(PACKAGES, dir, clientRelative)
  for (const [label, storage] of Object.entries(STORAGE_CASES)) {
    const where = `${manifest.name} [${label}]`
    try {
      const entry = boot(file, storage)
      if (entry.id !== manifest.name) throw new Error(`factory id "${entry.id}" != package name`)

      const record = { slots: [], events: [], injects: [], registrations: [], disposers: [] }
      const plugin = entry.factory((name) => ({ createElement: () => null, default: {}, [name]: {} }))
      if (!plugin || typeof plugin.apply !== 'function') throw new Error('factory returned no apply()')

      plugin.apply(fakeContext(record), {})
      rows.push({ where, slots: record.slots.length, regs: record.registrations.length, events: record.events.length })
    } catch (error) {
      failures.push(`${where}: ${error.message}`)
    }
  }
}

if (failures.length > 0) {
  for (const failure of failures) process.stdout.write(`  FAIL ${failure}\n`)
  process.stdout.write(`\nsmoke: ${failures.length} boot(s) failed\n`)
  process.exit(1)
}

const byPackage = new Map()
for (const row of rows) {
  const key = row.where.replace(/ \[.*$/, '')
  const current = byPackage.get(key) ?? { cases: 0, slots: 0, regs: 0 }
  byPackage.set(key, { cases: current.cases + 1, slots: row.slots, regs: row.regs })
}
for (const [name, stat] of byPackage) {
  process.stdout.write(`  ok ${name}: booted ${stat.cases}x, ${stat.regs} slot registration(s), ${stat.slots} slot(s) injected\n`)
}
process.stdout.write(`\nsmoke: all ${rows.length} boots passed\n`)
