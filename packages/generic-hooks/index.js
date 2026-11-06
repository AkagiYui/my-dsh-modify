/**
 * Generic lifecycle hooks for the DeepSeek Harness.
 *
 * One hook is one command bound to one lifecycle event. Nothing is translated
 * from another harness: the event names are DSH's own, the payload is a small
 * JSON object on stdin, and the result is mapped straight onto the event's
 * typed decision:
 *
 *     exit 2                        block the action; stderr is the reason
 *     stdout {"decision":"deny"}    same, with an explicit reason
 *     stdout {"decision":"ask"}     request approval instead (tool events)
 *     anything else                 the command ran and does not decide
 *
 * The list lives in `$DSH_HOME/generic-hooks/hooks.json`, is re-read after
 * every write, and every listener consults the live list, so adding or
 * disabling a hook takes effect without a restart. Commands run in the
 * Session's working directory through `ctx.shell`, so they see the same
 * executor, timeout and cancellation rules as any other shell work.
 *
 * Observation events (SessionStart, Stop, SubagentStart/End, AgentError,
 * SessionCreated) run detached: the command sees what happened and never
 * holds the agent back.
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

const DSH_HOME = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
const DATA_DIR = path.join(DSH_HOME, 'generic-hooks')
const DATA_FILE = path.join(DATA_DIR, 'hooks.json')
const ROUTE_PATH = '/generic-hooks/state'
const DEFAULT_TIMEOUT_SEC = 60
const MAX_HOOKS = 100
const MAX_BODY_BYTES = 512 * 1024
const MAX_REASON_CHARS = 2000

/**
 * The events this plugin exposes. `decision` says what a blocking exit means:
 * `deny-ask` for tool dispatch, `block` for a tool result, `reject` for a
 * prompt, `observe` for events that cannot veto anything.
 */
const EVENTS = [
  { event: 'tools/pre-execute', label: 'PreToolUse', tool: true, decision: 'deny-ask' },
  { event: 'tools/post-execute', label: 'PostToolUse', tool: true, decision: 'block' },
  { event: 'agent/pre-step', label: 'UserPromptSubmit', tool: false, decision: 'reject' },
  { event: 'agent/created', label: 'SessionStart', tool: false, decision: 'observe' },
  { event: 'agent/turn-stopping', label: 'Stop', tool: false, decision: 'observe' },
  { event: 'subagent/start', label: 'SubagentStart', tool: false, decision: 'observe' },
  { event: 'subagent/end', label: 'SubagentEnd', tool: false, decision: 'observe' },
  { event: 'agent/error', label: 'AgentError', tool: false, decision: 'observe' },
  { event: 'session/created', label: 'SessionCreated', tool: false, decision: 'observe' },
]
const EVENT_NAMES = new Set(EVENTS.map((entry) => entry.event))

/** Parse a persisted file into a hook list, tolerating a missing or torn file. */
function readHooks() {
  let parsed
  try {
    parsed = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'))
  } catch (_absentOrUnreadable) {
    return []
  }
  const list = Array.isArray(parsed) ? parsed : parsed && Array.isArray(parsed.hooks) ? parsed.hooks : []
  return normalizeList(list)
}

/** Write the list atomically, then adopt it as the live list. */
function writeHooks(list) {
  fs.mkdirSync(DATA_DIR, { recursive: true })
  const temporary = DATA_FILE + '.tmp'
  fs.writeFileSync(temporary, JSON.stringify({ version: 1, hooks: list }, null, 2))
  fs.renameSync(temporary, DATA_FILE)
}

/** Keep only well-formed hooks, giving every accepted one a stable id. */
function normalizeList(raw) {
  const seen = new Set()
  const list = []
  for (const entry of Array.isArray(raw) ? raw : []) {
    const hook = normalizeHook(entry, seen)
    if (hook !== null) list.push(hook)
    if (list.length >= MAX_HOOKS) break
  }
  return list
}

function normalizeHook(raw, seen) {
  if (!raw || typeof raw !== 'object') return null
  const event = String(raw.event ?? '')
  if (!EVENT_NAMES.has(event)) return null
  const command = String(raw.command ?? '').trim()
  if (command === '') return null
  const timeout = Number(raw.timeoutSec)
  const matcher = typeof raw.matcher === 'string' ? raw.matcher.trim() : ''
  const runner = raw.runner === 'process' ? 'process' : 'shell'
  const args = runner === 'process' && Array.isArray(raw.args)
    ? raw.args.map((value) => String(value).trim()).filter((value) => value !== '').slice(0, 32)
    : []
  let id = typeof raw.id === 'string' && raw.id !== '' ? raw.id : randomUUID()
  while (seen.has(id)) id = randomUUID()
  seen.add(id)
  return {
    id,
    event,
    matcher,
    runner,
    command,
    args,
    timeoutSec: Number.isFinite(timeout) ? Math.min(Math.max(Math.round(timeout), 1), 600) : DEFAULT_TIMEOUT_SEC,
    enabled: raw.enabled !== false,
  }
}

/**
 * `*`/empty matches everything and `a|b` lists alternatives. A part matches the
 * tool name literally, and is only compiled as a regex when it contains regex
 * syntax, so `edit` cannot quietly match `str_replace_editor`.
 */
const REGEX_SYNTAX = /[\\^$.*+?()[\]{}]/

function matchesSelector(selector, subject) {
  const text = String(selector ?? '').trim()
  if (text === '' || text === '*') return true
  for (const part of text.split('|').map((value) => value.trim()).filter((value) => value !== '')) {
    if (part === subject) return true
    if (!REGEX_SYNTAX.test(part)) continue
    try {
      if (new RegExp(part).test(subject)) return true
    } catch (_invalidPattern) {
      // A part that looks like a regex but does not compile never matches.
    }
  }
  return false
}

/** Flatten text blocks of a message list for the prompt payload. */
function promptText(messages) {
  const parts = []
  for (const message of Array.isArray(messages) ? messages : []) {
    for (const block of Array.isArray(message?.content) ? message.content : []) {
      if (block && block.type === 'text' && typeof block.text === 'string') parts.push(block.text)
    }
  }
  return parts.join('\n')
}

/** Flatten a tool result's content blocks into text. */
function contentText(content) {
  const parts = []
  for (const block of Array.isArray(content) ? content : []) {
    if (block && block.type === 'text' && typeof block.text === 'string') parts.push(block.text)
  }
  return parts.join('\n')
}

/** Keep payload values JSON-safe without ever throwing on a circular argument. */
function jsonSafe(value) {
  try {
    return JSON.parse(JSON.stringify(value))
  } catch (_circularOrUnserializable) {
    return String(value)
  }
}

function parseJson(text) {
  try {
    const value = JSON.parse(String(text ?? '').trim())
    return value && typeof value === 'object' ? value : null
  } catch (_notJson) {
    return null
  }
}

export function apply(ctx) {
  let hooks = readHooks()
  const runs = new Map()
  const controller = new AbortController()

  ctx.effect(() => () => controller.abort(), 'generic-hooks: abort in-flight hooks')

  const warn = (message) => {
    if (typeof ctx.logger?.warn === 'function') ctx.logger.warn(message)
    else console.warn(message)
  }

  const directoryOf = (agent) => {
    if (!agent || !agent.session) return undefined
    try {
      const workingDirectory = ctx.get('workingDirectory')
      const cwd = workingDirectory && typeof workingDirectory.get === 'function'
        ? workingDirectory.get(agent.session)
        : agent.session.header?.cwd
      return typeof cwd === 'string' && cwd !== '' ? cwd : undefined
    } catch (_serviceUnavailable) {
      return undefined
    }
  }

  const matching = (event, subject) => hooks.filter((hook) =>
    hook.enabled && hook.event === event && (subject === undefined || matchesSelector(hook.matcher, subject)))

  const payloadOf = (event, agent, extra) => {
    const cwd = directoryOf(agent)
    return {
      hook_event: event,
      ...(agent && agent.id ? { session_id: String(agent.id) } : {}),
      ...(cwd === undefined ? {} : { cwd }),
      ...extra,
    }
  }

  const record = (hook, outcome) => {
    runs.set(hook.id, { at: Date.now(), ...outcome })
    while (runs.size > MAX_HOOKS) runs.delete(runs.keys().next().value)
  }

  /** Shell runner: one command line, handed to the session shell. */
  const runShell = async (hook, payload, combined, started) => {
    const shell = ctx.get('shell')
    if (!shell) return { error: 'the shell service is unavailable', durationMs: Date.now() - started }
    const cwd = typeof payload.cwd === 'string' ? payload.cwd : undefined
    const spec = shell.resolve({
      command: hook.command,
      timeoutMs: hook.timeoutSec * 1000,
      stdin: JSON.stringify(payload) + '\n',
      signal: combined,
      ...(cwd === undefined ? {} : { workdir: cwd }),
    })
    const result = await (await shell.execute(spec)).result()
    return {
      exitCode: result.exitCode,
      timedOut: result.timedOut === true,
      durationMs: Date.now() - started,
      stdout: result.stdout.text,
      stderr: result.stderr.text,
    }
  }

  /** Process runner: program plus argv, no shell, so the exit code survives intact. */
  const runProcess = async (hook, payload, combined, started) => {
    const subprocess = ctx.get('subprocess')
    if (!subprocess) return { error: 'the subprocess service is unavailable', durationMs: Date.now() - started }
    const cwd = typeof payload.cwd === 'string' ? payload.cwd : process.cwd()
    const executable = await subprocess.resolveExecutable(hook.command, undefined, combined)
    const handle = subprocess.spawn({
      argv: [executable, ...hook.args],
      cwd,
      stdio: {
        stdin: { data: JSON.stringify(payload) + '\n' },
        stdout: { maxBytes: 64 * 1024 },
        stderr: { maxBytes: 64 * 1024 },
      },
      graceMs: 2000,
      signal: combined,
    })
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      handle.terminate()
    }, hook.timeoutSec * 1000)
    let outcome
    try {
      outcome = await handle.done
    } finally {
      clearTimeout(timer)
    }
    return {
      exitCode: outcome.exitCode,
      timedOut,
      durationMs: Date.now() - started,
      stdout: handle.collected.stdout?.readFrom(0).text ?? '',
      stderr: handle.collected.stderr?.readFrom(0).text ?? '',
    }
  }

  /** Run one hook; never throws and always records what happened. */
  const runHook = async (hook, payload, signal) => {
    const started = Date.now()
    const combined = signal === undefined || typeof AbortSignal.any !== 'function'
      ? controller.signal
      : AbortSignal.any([signal, controller.signal])
    try {
      const outcome = hook.runner === 'process'
        ? await runProcess(hook, payload, combined, started)
        : await runShell(hook, payload, combined, started)
      const decision = decide(outcome)
      record(hook, {
        exitCode: outcome.exitCode,
        timedOut: outcome.timedOut === true,
        durationMs: outcome.durationMs,
        decision: decision.kind,
        ...(decision.reason ? { reason: decision.reason.slice(0, 300) } : {}),
      })
      return outcome
    } catch (error) {
      const outcome = { error: String((error && error.message) || error), durationMs: Date.now() - started }
      record(hook, outcome)
      return outcome
    }
  }

  /** The one place where a process result becomes a decision kind. */
  function decide(outcome) {
    if (outcome.error !== undefined) return { kind: 'error', reason: outcome.error }
    if (outcome.timedOut) return { kind: 'error', reason: 'the hook timed out' }
    const stdout = String(outcome.stdout ?? '')
    const stderr = String(outcome.stderr ?? '')
    const json = parseJson(stdout)
    if (json) {
      const decision = typeof json.decision === 'string' ? json.decision : ''
      if (decision === 'deny' || decision === 'block' || decision === 'reject') {
        return { kind: 'block', reason: String(json.reason ?? '').trim() }
      }
      if (decision === 'ask') return { kind: 'ask', reason: String(json.reason ?? '').trim() }
    }
    if (outcome.exitCode === 2) {
      return { kind: 'block', reason: (stderr.trim() || stdout.trim()).slice(0, MAX_REASON_CHARS) }
    }
    if (typeof outcome.exitCode === 'number' && outcome.exitCode !== 0) {
      return { kind: 'error', reason: (stderr.trim() || `exit ${outcome.exitCode}`).slice(0, MAX_REASON_CHARS) }
    }
    return { kind: 'pass' }
  }

  /** Observation events: run every match, in order, without holding the caller. */
  const observe = (event, payload, signal) => {
    const matched = matching(event)
    if (matched.length === 0) return
    void (async () => {
      for (const hook of matched) await runHook(hook, payload, signal)
    })().catch((error) => warn(`generic-hooks: ${event} dispatch failed: ${String(error)}`))
  }

  ctx.on('tools/pre-execute', async (exec, next) => {
    const matched = matching('tools/pre-execute', exec.name)
    if (matched.length === 0) return next()
    const payload = payloadOf('PreToolUse', exec.agent, {
      tool_name: exec.name,
      tool_input: jsonSafe(exec.arguments),
    })
    let ask
    for (const hook of matched) {
      const outcome = await runHook(hook, payload, exec.signal)
      const decision = decide(outcome)
      if (decision.kind === 'ask') {
        ask = decision.reason
        continue
      }
      if (decision.kind !== 'block') continue
      return { kind: 'deny', reason: decision.reason || `blocked by hook ${hook.id}` }
    }
    if (ask !== undefined) return ask === '' ? { kind: 'ask' } : { kind: 'ask', reason: ask }
    return next()
  })

  ctx.on('tools/post-execute', async (exec, result, next) => {
    const matched = matching('tools/post-execute', exec.name)
    if (matched.length === 0) return next()
    const payload = payloadOf('PostToolUse', exec.agent, {
      tool_name: exec.name,
      tool_input: jsonSafe(exec.arguments),
      tool_response: contentText(result.content).slice(0, 100_000),
      is_error: result.isError === true,
    })
    for (const hook of matched) {
      const outcome = await runHook(hook, payload, exec.signal)
      const decision = decide(outcome)
      if (decision.kind !== 'block') continue
      return {
        kind: 'block',
        feedback: [{ type: 'text', text: decision.reason || `blocked by hook ${hook.id}` }],
      }
    }
    return next()
  })

  ctx.on('agent/pre-step', async (payload, next) => {
    const matched = matching('agent/pre-step')
    if (matched.length === 0) return next()
    const { agent, messages, turn, signal } = payload
    const body = payloadOf('UserPromptSubmit', agent, {
      turn,
      prompt: promptText(messages).slice(0, 100_000),
    })
    for (const hook of matched) {
      const outcome = await runHook(hook, body, signal)
      if (decide(outcome).kind === 'block') return { kind: 'reject' }
    }
    return next()
  })

  ctx.on('agent/created', ({ agent, source, signal }) => {
    observe('agent/created', payloadOf('SessionStart', agent, { source }), signal)
  })

  ctx.on('agent/turn-stopping', ({ agent, turn, signal }) => {
    observe('agent/turn-stopping', payloadOf('Stop', agent, { turn }), signal)
  })

  ctx.on('subagent/start', (info) => {
    const child = ctx.get('agents')?.get(info.id)
    observe('subagent/start', {
      hook_event: 'SubagentStart',
      session_id: String(info.id),
      run_id: String(info.runId),
      provider: info.provider,
      local: info.local === true,
      ...(directoryOf(child) === undefined ? {} : { cwd: directoryOf(child) }),
    })
  })

  ctx.on('subagent/end', (info) => {
    const child = ctx.get('agents')?.get(info.id)
    observe('subagent/end', {
      hook_event: 'SubagentEnd',
      session_id: String(info.id),
      run_id: String(info.runId),
      provider: info.provider,
      stop_reason: typeof info.stopReason === 'string' ? info.stopReason : undefined,
      ...(directoryOf(child) === undefined ? {} : { cwd: directoryOf(child) }),
    })
  })

  ctx.on('agent/error', ({ agent, turn, step, error }) => {
    observe('agent/error', payloadOf('AgentError', agent, {
      turn,
      step,
      error: String((error && error.message) || error),
    }))
  })

  ctx.on('session/created', (session) => {
    observe('session/created', {
      hook_event: 'SessionCreated',
      session_id: String(session.id),
      ...(session.header?.cwd ? { cwd: String(session.header.cwd) } : {}),
    })
  })

  const stateOf = () => ({
    ok: true,
    hooks,
    events: EVENTS,
    runs: Object.fromEntries(runs),
  })

  ctx.inject(['webServer'], (scoped) => {
    const reject = (req) => {
      const connection = typeof scoped.get === 'function' ? scoped.get('connection') : null
      if (!connection || typeof connection.requestRejection !== 'function') return null
      try {
        const code = connection.requestRejection(req)
        return code === undefined || code === null || code === false ? null : (typeof code === 'number' ? code : 403)
      } catch (_fenceUnavailable) {
        return null
      }
    }

    const send = (res, status, body) => {
      const text = JSON.stringify(body)
      res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'Content-Length': Buffer.byteLength(text),
      })
      res.end(text)
    }

    scoped.effect(() => scoped.webServer.register({
      kind: 'exact',
      path: ROUTE_PATH,
      handler: async (req, res) => {
        const rejected = reject(req)
        if (rejected !== null) {
          send(res, rejected, { ok: false, error: 'forbidden' })
          return
        }

        if (req.method === 'GET' || req.method === 'HEAD') {
          send(res, 200, stateOf())
          return
        }

        if (req.method !== 'POST') {
          send(res, 405, { ok: false, error: 'method not allowed' })
          return
        }

        try {
          const chunks = []
          let size = 0
          for await (const chunk of req) {
            size += chunk.length
            if (size > MAX_BODY_BYTES) throw new Error('request body is too large')
            chunks.push(chunk)
          }
          const text = Buffer.concat(chunks).toString('utf8')
          const body = text === '' ? {} : JSON.parse(text)
          if (!Array.isArray(body?.hooks)) throw new Error('hooks must be an array')
          const next = normalizeList(body.hooks)
          writeHooks(next)
          hooks = next
          send(res, 200, stateOf())
        } catch (error) {
          send(res, 400, { ok: false, error: String((error && error.message) || error) })
        }
      },
    }), 'generic-hooks: state route')
  })
}
