import * as baileys from '@whiskeysockets/baileys'
import chalk from 'chalk'
import fs from 'fs'
import path from 'path'
import pino from 'pino'
import { start as startManager, handleMessage } from './manager.js'
import groupWelcome from './biblioteca/welcome.js'
import groupAvisos from './biblioteca/avisos.js'
import { applyModeration } from './biblioteca/moderation.js'
import config from './config.js'
import { getCommandPrefix } from './biblioteca/settings.js'

const SUBBOT_DIR = 'Sessions/SubBotTemp'
const INFO_FILENAME = 'info.json'
const DEFAULT_BANNER = 'https://files.catbox.moe/0gog3y'

const subbots = new Map()

const MAX_RECONNECT_TRIES = 4
const reconnectTries = new Map()
const reconnectTimers = new Map()

const HANDLER_FLAG = '__MEOW_MANAGER_ATTACHED__'

function getPrefixForSocket(sock) {
  const fallback = globalThis?.prefijo || config?.prefijo || config?.PREFIX || '.'
  const subbotId = sock?.isSubBot ? String(sock?.subbotId || '').trim() : ''
  const stored = getCommandPrefix(subbotId)
  return stored || fallback
}

try { startManager() } catch {}


const now = () => new Date().toISOString().replace('T', ' ').replace('Z', '')
const botTag = () => chalk.magentaBright('「✿」')

function oneLineLog(level, main, fields = {}, color = 'whiteBright') {
  const parts = []
  for (const [k, v] of Object.entries(fields || {})) {
    if (v === undefined || v === null || v === '') continue
    parts.push(`${k}=${String(v)}`)
  }
  const suffix = parts.length ? chalk.gray(' | ') + chalk.gray(parts.join(chalk.gray(' | '))) : ''
  console.log(`${botTag()} ${chalk[color](`[${level}]`)} ${chalk[color](main)}${suffix}`)
}

const logOk = (main, fields = {}) => oneLineLog('OK', main, fields, 'greenBright')
const logInfo = (main, fields = {}) => oneLineLog('INFO', main, fields, 'cyanBright')
const logWarn = (main, fields = {}) => oneLineLog('WARN', main, fields, 'yellowBright')
const logErr = (main, fields = {}) => oneLineLog('ERR', main, fields, 'redBright')

function ensureBaseDir() {
  if (!fs.existsSync(SUBBOT_DIR)) fs.mkdirSync(SUBBOT_DIR, { recursive: true })
}

function clearSession(sessionPath) {
  try {
    if (sessionPath && fs.existsSync(sessionPath)) {
      fs.rmSync(sessionPath, { recursive: true, force: true })
    }
  } catch {}
}

function sanitizeId(jid = '') {
  const cleaned = String(jid || '').replace(/[^0-9]/g, '')
  return cleaned || `subbot_${Date.now()}`
}

function safeGetNumberFromJid(jid = '') {
  const s = String(jid || '')
  if (!s) return ''
  return s.split('@')[0].replace(/\D/g, '')
}

function ensureGlobalConns() {
  if (!(global.conns instanceof Array)) global.conns = []
}

function ensureGlobalSessions() {
  if (!global.__SUBBOT_SESSIONS__) global.__SUBBOT_SESSIONS__ = new Map()
}

function isWsOpen(sock) {
  const rs1 = sock?.ws?.socket?.readyState
  const rs2 = sock?.ws?.readyState
  return rs1 === 1 || rs2 === 1
}

function syncGlobalConnsFromSessions() {
  ensureGlobalConns()
  ensureGlobalSessions()

  const keepMain = (global.conns || []).filter((s) => s && s.user && s.ws && !s.isSubBot)

  const subs = Array.from(global.__SUBBOT_SESSIONS__.values()).filter(
    (s) => s && s.isSubBot && s.user && s.ws && isWsOpen(s)
  )

  const uniq = new Map()
  for (const s of [...keepMain, ...subs]) {
    const jid = String(s?.user?.jid || '')
    const key = jid ? jid.split('@')[0] : `x_${Math.random()}`
    if (!uniq.has(key)) uniq.set(key, s)
  }

  global.conns = Array.from(uniq.values())
  return global.conns.length
}

function isConnectedInGlobalConnsByJid(jid = '') {
  ensureGlobalConns()
  const n = safeGetNumberFromJid(jid)
  if (!n) return false
  return global.conns.some((s) => safeGetNumberFromJid(s?.user?.jid || '') === n)
}

function addToGlobalConns(sock) {
  ensureGlobalConns()
  const jid = sock?.user?.jid || ''
  if (!jid) return false
  if (isConnectedInGlobalConnsByJid(jid)) return false
  global.conns.push(sock)
  return true
}

function removeFromGlobalConns(sock) {
  ensureGlobalConns()
  const idx = global.conns.indexOf(sock)
  if (idx >= 0) global.conns.splice(idx, 1)
}

function readInfo(sessionPath, id) {
  const infoPath = path.join(sessionPath, INFO_FILENAME)
  const fallback = {
    id,
    owner: '',
    name: `${config.nombrebot}`,
    banner: DEFAULT_BANNER
  }

  if (!fs.existsSync(infoPath)) return fallback

  try {
    const raw = fs.readFileSync(infoPath, 'utf-8')
    const parsed = JSON.parse(raw)
    return {
      id,
      owner: parsed.owner || '',
      name: parsed.name || `${config.nombrebot}`,
      banner: parsed.banner || DEFAULT_BANNER
    }
  } catch (err) {
    logErr('Error leyendo info.json', {
      id,
      file: infoPath,
      time: now(),
      err: String(err?.message || err || 'desconocido')
    })
    return fallback
  }
}

function saveInfo(sessionPath, info) {
  const infoPath = path.join(sessionPath, INFO_FILENAME)
  try {
    fs.writeFileSync(infoPath, JSON.stringify(info, null, 2))
  } catch (e) {
    logErr('No se pudo guardar info.json', {
      file: infoPath,
      time: now(),
      err: String(e?.message || e || 'desconocido')
    })
  }
}

function ensureEntryForConn(conn) {
  if (!conn?.isSubBot) return null

  const id = conn.subbotId || sanitizeId(conn.user?.jid)
  if (!id) return null

  const existing = subbots.get(id)
  if (existing) return existing

  const sessionPath = conn.subbotSessionPath || path.join(SUBBOT_DIR, id)
  ensureBaseDir()
  if (!fs.existsSync(sessionPath)) fs.mkdirSync(sessionPath, { recursive: true })

  const info = readInfo(sessionPath, id)
  const owner = conn.subbotOwner || conn.user?.jid || info.owner || ''
  if (owner && info.owner !== owner) {
    info.owner = owner
    saveInfo(sessionPath, info)
  }

  const entry = { socket: conn, info, sessionPath, saveCreds: null, status: 'open' }
  subbots.set(id, entry)
  return entry
}

function markStatus(id, status) {
  const entry = subbots.get(id)
  if (!entry) return
  subbots.set(id, { ...entry, status })
}

function clearReconnectTimer(id) {
  const t = reconnectTimers.get(id)
  if (t) {
    try {
      clearTimeout(t)
    } catch {}
    reconnectTimers.delete(id)
  }
}

function resetReconnectTries(id) {
  reconnectTries.set(id, 0)
}

function bumpReconnectTries(id) {
  const n = (reconnectTries.get(id) || 0) + 1
  reconnectTries.set(id, n)
  return n
}

function summarizeDisconnectCode(code) {
  const map = {
    [baileys.DisconnectReason.badSession]: 'badSession',
    [baileys.DisconnectReason.connectionClosed]: 'connectionClosed',
    [baileys.DisconnectReason.connectionLost]: 'connectionLost',
    [baileys.DisconnectReason.connectionReplaced]: 'connectionReplaced',
    [baileys.DisconnectReason.loggedOut]: 'loggedOut',
    [baileys.DisconnectReason.restartRequired]: 'restartRequired',
    [baileys.DisconnectReason.timedOut]: 'timedOut'
  }
  return map?.[code] || 'unknown'
}

function waitForOpenOrClose(sock, timeoutMs = 20000) {
  return new Promise((resolve) => {
    let done = false
    const finish = (v) => {
      if (done) return
      done = true
      try {
        sock?.ev?.off?.('connection.update', onUpdate)
      } catch {}
      clearTimeout(t)
      resolve(v)
    }

    const onUpdate = ({ connection, lastDisconnect }) => {
      if (connection === 'open') return finish({ ok: true })
      if (connection === 'close') {
        const code =
          lastDisconnect?.error?.output?.statusCode ||
          lastDisconnect?.error?.output?.payload?.statusCode ||
          lastDisconnect?.error?.statusCode ||
          null
        return finish({ ok: false, code })
      }
    }

    const t = setTimeout(() => finish({ ok: false, code: 'timeout' }), timeoutMs)
    sock.ev.on('connection.update', onUpdate)
  })
}

function promotePairedSocket({ socket, id, sessionPath, ownerJid, saveCreds }) {
  if (!socket) throw new Error('socket requerido')
  if (!id) throw new Error('id requerido')
  if (!sessionPath) throw new Error('sessionPath requerido')

  ensureBaseDir()
  ensureGlobalConns()
  ensureGlobalSessions()

  const existing = subbots.get(id)
  if (existing?.socket && isWsOpen(existing.socket)) {
    try {
      if (!existing.socket[HANDLER_FLAG]) {
        try {
          groupWelcome(existing.socket)
          groupAvisos(existing.socket)
        } catch {}

        existing.socket.ev.on('messages.upsert', async ({ messages, type }) => {
          if (type !== 'notify') return
          const usedPrefix = getPrefixForSocket(existing.socket)
          for (const msg of messages || []) {
            if (!msg?.message) continue
            try {
              const texto =
                msg.message?.conversation ||
                msg.message?.extendedTextMessage?.text ||
                msg.message?.imageMessage?.caption ||
                msg.message?.videoMessage?.caption ||
                ''

              const isCommand = String(texto || '').trim().startsWith(String(usedPrefix || '.'))

              if (!isCommand) {
                void applyModeration(existing.socket, msg, texto).catch(() => {})
                continue
              }

              void handleMessage(existing.socket, msg).catch(() => {})
            } catch {}
          }
        })

        existing.socket[HANDLER_FLAG] = true
      }
    } catch {}

    markStatus(id, isWsOpen(existing.socket) ? 'open' : (existing.status || 'connecting'))
    syncGlobalConnsFromSessions()
    return { id, entry: existing, reused: true }
  }

  socket.isSubBot = true
  socket.subbotId = id
  socket.subbotOwner = ownerJid || socket.subbotOwner || ''
  socket.subbotSessionPath = sessionPath

  if (!fs.existsSync(sessionPath)) fs.mkdirSync(sessionPath, { recursive: true })
  let info = readInfo(sessionPath, id)
  if (ownerJid && info.owner !== ownerJid) {
    info.owner = ownerJid
    saveInfo(sessionPath, info)
  }

  global.__SUBBOT_SESSIONS__.set(id, socket)
  subbots.set(id, {
    socket,
    info,
    sessionPath,
    saveCreds: typeof saveCreds === 'function' ? saveCreds : null,
    status: 'connecting'
  })

  if (typeof saveCreds === 'function') {
    socket.ev.on('creds.update', () => {
      try {
        Promise.resolve(saveCreds()).catch(() => {})
      } catch {}
    })
  }

  try {
    groupWelcome(socket)
    groupAvisos(socket)
  } catch {}

  socket.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return

    const usedPrefix = getPrefixForSocket(socket)

    for (const msg of messages || []) {
      if (!msg?.message) continue
      try {
        const texto =
          msg.message?.conversation ||
          msg.message?.extendedTextMessage?.text ||
          msg.message?.imageMessage?.caption ||
          msg.message?.videoMessage?.caption ||
          ''

        const isCommand = String(texto || '').trim().startsWith(String(usedPrefix || '.'))

        // ⚡ En grupos grandes: no llames handleMessage si no es comando.
        if (!isCommand) {
          void applyModeration(socket, msg, texto).catch(() => {})
          continue
        }

        void handleMessage(socket, msg).catch(() => {})
      } catch (e) {
        const from = msg?.key?.remoteJid || '—'
        logErr('Error en handleMessage Subbot', {
          id,
          chat: from,
          time: now(),
          err: String(e?.message || e || 'desconocido')
        })
      }
    }
  })

  socket[HANDLER_FLAG] = true

  try {
    if (isWsOpen(socket)) {
      const added = addToGlobalConns(socket)
      const synced = syncGlobalConnsFromSessions()
      resetReconnectTries(id)
      markStatus(id, 'open')
      logOk('Subbot promovido ya conectado (web)', {
        id,
        owner: info?.owner || '—',
        globalConns: added ? 'added' : 'exists',
        conns: synced,
        time: now()
      })
    }
  } catch {}

  socket.ev.on('connection.update', ({ connection, lastDisconnect }) => {
    const code =
      lastDisconnect?.error?.output?.statusCode ||
      lastDisconnect?.error?.output?.payload?.statusCode ||
      lastDisconnect?.error?.statusCode ||
      null
    const reason = summarizeDisconnectCode(code)

    if (connection === 'open') {
      const added = addToGlobalConns(socket)
      const synced = syncGlobalConnsFromSessions()
      resetReconnectTries(id)
      markStatus(id, 'open')
      logOk('Subbot conectado (promoted)', {
        id,
        owner: info?.owner || '—',
        globalConns: added ? 'added' : 'exists',
        conns: synced,
        time: now()
      })
      return
    }

    if (connection === 'close') {
      removeFromGlobalConns(socket)
      syncGlobalConnsFromSessions()

      const shouldReconnect = code !== baileys.DisconnectReason.loggedOut && String(code) !== '401'
      logErr('Subbot desconectado (promoted)', {
        id,
        code: code ?? '—',
        reason,
        reconnect: shouldReconnect ? 'yes' : 'no',
        time: now()
      })
      if (!shouldReconnect) {
        markStatus(id, 'closed')
        try {
          global.__SUBBOT_SESSIONS__.delete(id)
        } catch {}
        return
      }

      const tries = bumpReconnectTries(id)
      if (tries > MAX_RECONNECT_TRIES) {
        markStatus(id, 'closed')
        clearSession(sessionPath)
        subbots.delete(id)
        try {
          global.__SUBBOT_SESSIONS__.delete(id)
        } catch {}
        syncGlobalConnsFromSessions()
        return
      }

      markStatus(id, 'reconnecting')
      clearReconnectTimer(id)
      const timer = setTimeout(() => {
        startSubbot(id, sessionPath, info, { pairingOnly: false, waitOpen: false }).catch(() => {})
      }, 800)
      reconnectTimers.set(id, timer)
    }
  })

  markStatus(id, isWsOpen(socket) ? 'open' : 'connecting')
  syncGlobalConnsFromSessions()

  return { id, entry: subbots.get(id), reused: false }
}

async function startSubbot(id, sessionPath, info, opts = {}) {
  const pairingOnly = !!opts.pairingOnly
  const waitOpen = !!opts.waitOpen
  const waitMs = Number(opts.waitMs || 20000)

  ensureGlobalConns()
  ensureGlobalSessions()

  clearReconnectTimer(id)

  logInfo(pairingOnly ? 'Iniciando emparejamiento Subbot' : 'Iniciando conexión Subbot', {
    id,
    path: sessionPath,
    owner: info?.owner || '—',
    mode: pairingOnly ? 'pairingOnly' : 'full',
    time: now()
  })

  const { state, saveCreds } = await baileys.useMultiFileAuthState(sessionPath)
  const { version } = await baileys.fetchLatestBaileysVersion()

  const socket = baileys.makeWASocket({
    version,
    printQRInTerminal: false,
    auth: {
      creds: state.creds,
      keys: baileys.makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' }))
    },
    browser: ['Ubuntu', 'Chrome', '108.0.5359.125'],
    logger: pino({ level: 'silent' }),
    syncFullHistory: false,
    markOnlineOnConnect: false,
    emitOwnEvents: false,

    // ⚡ Rendimiento en grupos grandes (BLY)
    enableParallelMessageProcessing: true,
    // Subbots comparten la misma máquina: 6 evita saturar CPU si hay varios subbots
    maxParallelMessageThreads: 6
  })

  socket.isSubBot = true
  socket.subbotId = id
  socket.subbotOwner = info.owner || ''
  socket.subbotSessionPath = sessionPath

  global.__SUBBOT_SESSIONS__.set(id, socket)

  subbots.set(id, {
    socket,
    info,
    sessionPath,
    saveCreds,
    status: pairingOnly ? 'pairing' : 'connecting'
  })

  socket.ev.on('creds.update', () => {
    try {
      saveCreds()
      markStatus(id, subbots.get(id)?.status || (pairingOnly ? 'pairing' : 'connecting'))
    } catch {}
  })

  markStatus(id, pairingOnly ? 'pairing' : 'connecting')

  socket.ev.on('connection.update', ({ connection, lastDisconnect }) => {
    const code =
      lastDisconnect?.error?.output?.statusCode ||
      lastDisconnect?.error?.output?.payload?.statusCode ||
      lastDisconnect?.error?.statusCode ||
      null

    const reason = summarizeDisconnectCode(code)

    if (connection === 'open') {
      const jid = socket.user?.jid || ''
      const number = safeGetNumberFromJid(jid)

      const added = !pairingOnly ? addToGlobalConns(socket) : false
      const synced = !pairingOnly ? syncGlobalConnsFromSessions() : (global.conns?.length || 0)

      logOk(pairingOnly ? 'Subbot listo para emparejar' : 'Subbot conectado', {
        id,
        number: number || '—',
        owner: info?.owner || '—',
        globalConns: !pairingOnly ? (added ? 'added' : 'exists') : 'skip',
        conns: synced,
        time: now()
      })

      resetReconnectTries(id)
      markStatus(id, 'open')
      return
    }

    if (connection === 'close') {
      removeFromGlobalConns(socket)
      syncGlobalConnsFromSessions()

      if (pairingOnly) {
        markStatus(id, 'closed')
        logWarn('Emparejamiento cerrado Subbot', {
          id,
          code: code ?? '—',
          reason,
          time: now()
        })
        return
      }

      const shouldReconnect = code !== baileys.DisconnectReason.loggedOut && String(code) !== '401'

      logErr('Subbot desconectado', {
        id,
        code: code ?? '—',
        reason,
        reconnect: shouldReconnect ? 'yes' : 'no',
        time: now()
      })

      if (!shouldReconnect) {
        logErr('Subbot closed por loggedOut, borrando sesión', {
          id,
          path: sessionPath
        })
        markStatus(id, 'closed')
        clearReconnectTimer(id)
        reconnectTries.delete(id)
        clearSession(sessionPath)
        subbots.delete(id)
        try {
          global.__SUBBOT_SESSIONS__.delete(id)
        } catch {}
        syncGlobalConnsFromSessions()
        return
      }

      const tries = bumpReconnectTries(id)

      if (tries > MAX_RECONNECT_TRIES) {
        logErr('Máximo reconexiones alcanzado, borrando sesión', {
          id,
          tries: `${tries - 1}/${MAX_RECONNECT_TRIES}`,
          path: sessionPath
        })
        markStatus(id, 'closed')
        clearReconnectTimer(id)
        reconnectTries.delete(id)
        clearSession(sessionPath)
        subbots.delete(id)
        try {
          global.__SUBBOT_SESSIONS__.delete(id)
        } catch {}
        syncGlobalConnsFromSessions()
        return
      }

      const delayMs = 800
      logWarn('Reconectando Subbot', {
        id,
        try: `${tries}/${MAX_RECONNECT_TRIES}`,
        delayMs
      })

      markStatus(id, 'reconnecting')
      clearReconnectTimer(id)

      const timer = setTimeout(() => {
        startSubbot(id, sessionPath, info, { pairingOnly: false, waitOpen: false }).catch((e) => {
          logErr('Fallo al reconectar Subbot', {
            id,
            time: now(),
            err: String(e?.message || e || 'desconocido')
          })
        })
      }, delayMs)

      reconnectTimers.set(id, timer)
    }
  })

  if (!pairingOnly) {
    groupWelcome(socket)
    groupAvisos(socket)

    socket.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type !== 'notify') return

      const usedPrefix = getPrefixForSocket(socket)

      for (const msg of messages || []) {
        if (!msg?.message) continue
        try {
          const texto =
            msg.message?.conversation ||
            msg.message?.extendedTextMessage?.text ||
            msg.message?.imageMessage?.caption ||
            msg.message?.videoMessage?.caption ||
            ''

          const isCommand = String(texto || '').trim().startsWith(String(usedPrefix || '.'))
          // ⚡ En grupos grandes: no llames handleMessage si no es comando.
          if (!isCommand) {
            void applyModeration(socket, msg, texto).catch(() => {})
            continue
          }

          void handleMessage(socket, msg).catch(() => {})
        } catch (e) {
          const from = msg?.key?.remoteJid || '—'
          logErr('Error en handleMessage Subbot', {
            id,
            chat: from,
            time: now(),
            err: String(e?.message || e || 'desconocido')
          })
        }
      }
    })

    socket[HANDLER_FLAG] = true
  }

  if (waitOpen && !pairingOnly) {
    const res = await waitForOpenOrClose(socket, waitMs)
    if (!res?.ok) {
      throw new Error(`Subbot ${id} no abrió conexión (code=${res?.code})`)
    }
  }

  return socket
}

async function initSubbots() {
  ensureBaseDir()
  ensureGlobalConns()
  ensureGlobalSessions()

  const entries = fs
    .readdirSync(SUBBOT_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)

  if (!entries.length) {
    logInfo('No hay subbots guardados para reconectar', { path: SUBBOT_DIR })
    return
  }

  logInfo('Reconexión de subbots iniciada', {
    found: entries.length,
    path: SUBBOT_DIR,
    time: now()
  })

  for (const id of entries) {
    const sessionPath = path.join(SUBBOT_DIR, id)
    const info = readInfo(sessionPath, id)
    resetReconnectTries(id)

    startSubbot(id, sessionPath, info, { pairingOnly: false, waitOpen: false }).catch((e) => {
      logErr('No se pudo iniciar reconexión de Subbot', {
        id,
        time: now(),
        err: String(e?.message || e || 'desconocido')
      })
    })
  }

  const synced = syncGlobalConnsFromSessions()
  logInfo('Subbots en reconexión (background)', { time: now(), conns: synced })
}


async function ensureSubbot(ownerJid) {
  ensureBaseDir()
  ensureGlobalConns()
  ensureGlobalSessions()

  const safeId = sanitizeId(ownerJid)
  const sessionPath = path.join(SUBBOT_DIR, safeId)
  if (!fs.existsSync(sessionPath)) fs.mkdirSync(sessionPath, { recursive: true })

  let info = readInfo(sessionPath, safeId)
  if (!info.owner) {
    info.owner = ownerJid
    saveInfo(sessionPath, info)
  }

  const existing = subbots.get(safeId)
  if (existing?.socket) {
    const synced = syncGlobalConnsFromSessions()
    logInfo('Subbot ya existe en memoria', {
      id: safeId,
      status: existing.status || '—',
      owner: info.owner || '—',
      conns: synced
    })
    return { id: safeId, entry: existing }
  }

  resetReconnectTries(safeId)
  await startSubbot(safeId, sessionPath, info, { pairingOnly: false, waitOpen: true, waitMs: 30000 })

  const synced = syncGlobalConnsFromSessions()
  logOk('Subbot asegurado', {
    id: safeId,
    status: subbots.get(safeId)?.status || '—',
    owner: info.owner || '—',
    conns: synced
  })

  return { id: safeId, entry: subbots.get(safeId) }
}

function getBotVisual(conn) {
  if (conn?.isSubBot && conn?.subbotId) {
    const entry = subbots.get(conn.subbotId) || ensureEntryForConn(conn)
    if (entry?.info) {
      return {
        name: entry.info.name || config.nombrebot,
        banner: entry.info.banner || DEFAULT_BANNER,
        owner: entry.info.owner || '',
        id: entry.info.id || conn.subbotId,
        isSubBot: true
      }
    }
  }

  return {
    name: config.nombrebot,
    banner: DEFAULT_BANNER,
    owner: '',
    id: 'main',
    isSubBot: false
  }
}

function getSubbotInfo(conn) {
  if (!conn?.isSubBot) return null
  const existing = conn.subbotId ? subbots.get(conn.subbotId) : null
  const data = existing || ensureEntryForConn(conn)
  return data?.info || null
}

function updateInfo(id, updater) {
  const entry = subbots.get(id)
  if (!entry) return null
  const updated = { ...entry.info, ...updater }
  saveInfo(entry.sessionPath, updated)
  subbots.set(id, { ...entry, info: updated })
  return updated
}

async function setSubbotName(conn, name) {
  if (!conn?.isSubBot) throw new Error('No es un subbot')
  const entry = conn.subbotId ? subbots.get(conn.subbotId) : null
  const target = entry || ensureEntryForConn(conn)
  if (!target) throw new Error('Subbot no encontrado')

  const trimmed = String(name || '').trim()
  if (!trimmed) throw new Error('Nombre vacío')

  await conn.updateProfileName(trimmed)

  logOk('Nombre actualizado en Subbot', {
    id: target.info.id,
    newName: trimmed,
    time: now()
  })

  return updateInfo(target.info.id, { name: trimmed })
}

async function setSubbotBanner(conn, buffer) {
  if (!conn?.isSubBot) throw new Error('No es un subbot')
  const entry = conn.subbotId ? subbots.get(conn.subbotId) : null
  const target = entry || ensureEntryForConn(conn)
  if (!target) throw new Error('Subbot no encontrado')
  if (!buffer || !Buffer.isBuffer(buffer)) throw new Error('Imagen inválida')

  const bannerPath = path.join(target.sessionPath, 'banner.jpg')
  await fs.promises.writeFile(bannerPath, buffer)

  logOk('Banner guardado para Subbot', {
    id: target.info.id,
    path: bannerPath,
    time: now()
  })

  return updateInfo(target.info.id, { banner: bannerPath })
}

export {
  DEFAULT_BANNER,
  getBotVisual,
  getSubbotInfo,
  initSubbots,
  ensureSubbot,
  promotePairedSocket,
  setSubbotBanner,
  setSubbotName
}
