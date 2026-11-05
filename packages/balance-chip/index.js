/**
 * Host half of the balance chip.
 *
 * The chip itself is a browser-side strip in the composer tool row; everything
 * that needs a secret or the account session lives here:
 *
 *   GET /balance-chip/state[?refresh=1]
 *     -> { ok, balance, currency, todayUsage, phase, source, stale, error, updatedAt }
 *
 * Balance comes from the API key when one is configured and falls back to the
 * signed-in DSH account; credentials never leave this process. "Today" is an
 * observation ledger: a balance drop is spend, a balance rise is a top-up and
 * must not cancel what was already spent.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const DSH_HOME = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
const DATA_DIR = path.join(DSH_HOME, 'balance-chip')
const LEDGER_FILE = path.join(DATA_DIR, 'ledger.json')

const ROUTE_PATH = '/balance-chip/state'
const MODELS_PATH = '/balance-chip/models'
const CACHE_TTL_MS = 30_000
const FETCH_TIMEOUT_MS = 8_000
const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000

/** Peak windows are Beijing weekday mornings and afternoons; weekends are off-peak all day. */
const PEAK_WINDOWS = [[9 * 60, 12 * 60], [14 * 60, 18 * 60]]

function round6(value) {
  return Math.round(value * 1e6) / 1e6
}

function beijingParts(date) {
  const shifted = new Date(date.getTime() + BEIJING_OFFSET_MS)
  return {
    day: shifted.toISOString().slice(0, 10),
    weekday: shifted.getUTCDay(),
    minutes: shifted.getUTCHours() * 60 + shifted.getUTCMinutes(),
  }
}

function phaseOf(date) {
  const { weekday, minutes } = beijingParts(date)
  const workday = weekday >= 1 && weekday <= 5
  const peak = workday && PEAK_WINDOWS.some(([from, to]) => minutes >= from && minutes < to)
  return peak ? 'peak' : 'offpeak'
}

function readLedger() {
  try {
    const parsed = JSON.parse(fs.readFileSync(LEDGER_FILE, 'utf8'))
    if (parsed && typeof parsed === 'object' && typeof parsed.day === 'string') return parsed
  } catch (_absentOrUnreadable) {
    // A missing or unreadable ledger only costs today's figure, never the balance.
  }
  return null
}

function writeLedger(ledger) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true })
    const temporary = LEDGER_FILE + '.tmp'
    fs.writeFileSync(temporary, JSON.stringify(ledger))
    fs.renameSync(temporary, LEDGER_FILE)
  } catch (_readOnlyHome) {
    // The balance still renders; only cross-request accumulation is lost.
  }
}

/**
 * Fold one fresh observation into the day's ledger. The first observation of a
 * day sets the baseline, a drop adds to spend, and a rise is recorded apart so
 * a top-up never erases spend already observed.
 */
function observe(ledger, day, balance) {
  const next = ledger && ledger.day === day
    ? { ...ledger }
    : { day, spent: 0, last: null, adjusted: 0 }
  if (Number.isFinite(balance)) {
    if (Number.isFinite(next.last)) {
      const delta = next.last - balance
      if (delta > 0) next.spent = round6(next.spent + delta)
      else if (delta < 0) next.adjusted = round6(next.adjusted + -delta)
    }
    next.last = balance
  }
  return next
}

async function keyBalance(ctx) {
  const credentials = typeof ctx.get === 'function' ? ctx.get('credentials') : null
  if (!credentials || typeof credentials.resolve !== 'function') return null
  const credential = await credentials.resolve('DEEPSEEK_API_KEY')
  if (!credential || typeof credential.value !== 'string' || credential.value === '') return null

  const response = await fetch('https://api.deepseek.com/user/balance', {
    headers: { Authorization: 'Bearer ' + credential.value, Accept: 'application/json' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })
  if (!response.ok) throw new Error('balance endpoint answered HTTP ' + response.status)

  const payload = await response.json()
  const wallets = Array.isArray(payload && payload.balance_infos) ? payload.balance_infos : []
  const wallet = wallets.find((entry) => entry && entry.currency === 'CNY') || wallets[0]
  if (!wallet) throw new Error('balance payload carried no wallet')

  const total = Number(wallet.total_balance)
  if (!Number.isFinite(total)) throw new Error('balance was not numeric')
  return { balance: total, currency: String(wallet.currency || 'CNY').toUpperCase(), source: 'api-key' }
}

async function accountBalance(ctx) {
  const account = typeof ctx.get === 'function' ? ctx.get('deepseekAccount') : null
  if (!account || typeof account.getBalance !== 'function') return null

  const result = await account.getBalance({
    version: String(process.env.DSH_VERSION || 'unknown'),
    locale: String(process.env.DSH_LOCALE || 'zh_CN'),
    timezoneOffsetSeconds: -new Date().getTimezoneOffset() * 60,
  })
  if (!result || result.status !== 'ready') return null

  const wallets = [
    ...(Array.isArray(result.value) ? result.value : []),
    ...(Array.isArray(result.bonusWallets) ? result.bonusWallets : []),
  ].filter((wallet) => wallet && Number.isFinite(Number(wallet.balance)))
  if (wallets.length === 0) return null

  const currencyOf = (wallet) => String(wallet.currency || 'CNY').toUpperCase()
  const currency = currencyOf(wallets.find((wallet) => currencyOf(wallet) === 'CNY') || wallets[0])
  const balance = wallets
    .filter((wallet) => currencyOf(wallet) === currency)
    .reduce((sum, wallet) => sum + Number(wallet.balance), 0)

  return { balance: round6(balance), currency, source: 'account' }
}

function messageOf(error) {
  return String((error && error.message) || error || 'unknown error').slice(0, 160)
}

function createReader(ctx) {
  let cached = null
  let cachedAt = 0

  return async function readState(force) {
    const now = Date.now()
    const fresh = force || cached === null || now - cachedAt > CACHE_TTL_MS
    let failure = ''

    if (fresh) {
      let next = null
      try {
        next = await keyBalance(ctx)
      } catch (error) {
        failure = 'API key: ' + messageOf(error)
      }
      if (!next) {
        try {
          next = await accountBalance(ctx)
        } catch (error) {
          failure = (failure ? failure + '; ' : '') + 'account: ' + messageOf(error)
        }
      }
      if (next) {
        cached = next
        cachedAt = now
        if (Number.isFinite(next.balance)) {
          const { day } = beijingParts(new Date(now))
          writeLedger(observe(readLedger(), day, next.balance))
        }
      }
    }

    const ledger = readLedger()
    const { day } = beijingParts(new Date(now))
    const todayUsage = ledger && ledger.day === day && Number.isFinite(ledger.spent) ? ledger.spent : 0

    if (!cached) {
      return {
        ok: false,
        phase: phaseOf(new Date(now)),
        todayUsage,
        error: failure || 'no balance source is available',
        updatedAt: new Date(now).toISOString(),
      }
    }

    return {
      ok: true,
      balance: cached.balance,
      currency: cached.currency,
      source: cached.source,
      todayUsage,
      phase: phaseOf(new Date(now)),
      stale: cachedAt !== now && now - cachedAt > CACHE_TTL_MS,
      error: failure || undefined,
      observedAt: new Date(cachedAt).toISOString(),
      updatedAt: new Date(now).toISOString(),
    }
  }
}

/** Ask the host's trust fence about this request; a read-only route fails open if the fence itself breaks. */
function rejectionOf(ctx, req) {
  const connection = typeof ctx.get === 'function' ? ctx.get('connection') : null
  if (!connection || typeof connection.requestRejection !== 'function') return null
  try {
    const code = connection.requestRejection(req)
    if (code === undefined || code === null || code === false) return null
    return typeof code === 'number' ? code : 403
  } catch (_fenceUnavailable) {
    return null
  }
}

function sendJson(res, status, body) {
  const text = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(text),
  })
  res.end(text)
}

export function apply(ctx) {
  const readState = createReader(ctx)

  // `assistant/message` carries the model that produced the reply; the browser
  // node keeps only the usage, so the name is recorded here and served back.
  const modelsBySession = new Map()
  ctx.effect(() => ctx.on('session/event', (session, event) => {
    if (!event || event.type !== 'assistant/message') return
    const data = event.data || {}
    const message = data.message || {}
    const id = message.id
    if (typeof id !== 'string' || id === '') return
    const sessionId = String((session && session.id) || 'default')
    let models = modelsBySession.get(sessionId)
    if (models === undefined) {
      models = new Map()
      modelsBySession.set(sessionId, models)
    }
    models.set(id, String((message.source && message.source.model) || ''))
    if (models.size > 800) {
      const oldest = models.keys().next().value
      if (oldest !== undefined) models.delete(oldest)
    }
  }), 'balance-chip: model meter')

  ctx.effect(() => ctx.on('session/disposed', (session) => {
    if (session && session.id) modelsBySession.delete(String(session.id))
  }), 'balance-chip: model meter cleanup')

  ctx.inject(['webServer'], (scoped) => {
    scoped.effect(() => scoped.webServer.register({
      kind: 'exact',
      path: ROUTE_PATH,
      handler: async (req, res) => {
        const rejected = rejectionOf(scoped, req)
        if (rejected !== null) {
          sendJson(res, rejected, { ok: false, error: 'forbidden' })
          return
        }
        const force = /[?&]refresh=1(?:&|$)/.test(String(req.url || ''))
        try {
          sendJson(res, 200, await readState(force))
        } catch (error) {
          sendJson(res, 200, { ok: false, error: messageOf(error) })
        }
      },
    }))

    scoped.effect(() => scoped.webServer.register({
      kind: 'exact',
      path: MODELS_PATH,
      handler: (req, res) => {
        const rejected = rejectionOf(scoped, req)
        if (rejected !== null) {
          sendJson(res, rejected, { ok: false, error: 'forbidden' })
          return
        }
        try {
          const url = new URL(String(req.url || '/'), 'http://localhost')
          const models = modelsBySession.get(url.searchParams.get('session') || '')
          const served = {}
          if (models !== undefined) for (const [id, model] of models) served[id] = model
          sendJson(res, 200, { ok: true, models: served })
        } catch (error) {
          sendJson(res, 200, { ok: false, error: messageOf(error) })
        }
      },
    }))
  })
}
