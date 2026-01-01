import { jidNormalizedUser } from '@whiskeysockets/baileys'
import { getBotVisual } from '../subbotManager.js'

function isWsOpen(sock) {
  const rs1 = sock?.ws?.socket?.readyState
  const rs2 = sock?.ws?.readyState
  return rs1 === 1 || rs2 === 1
}

function safeNum(input = '') {
  return String(input || '').replace(/\D/g, '')
}

function prettyCount(n) {
  return Number(n || 0).toLocaleString('en-US')
}

function getChatId(m = {}) {
  return m?.chat || m?.key?.remoteJid || ''
}

function isGroup(chatId = '') {
  return String(chatId || '').endsWith('@g.us')
}

function pickSubName(sock) {
  const v = getBotVisual(sock)
  const n = String(v?.name || '').trim()
  if (n) return n
  const u = String(sock?.user?.name || '').trim()
  if (u) return u
  return 'Sub'
}

function normalizeJid(jid = '') {
  return jid ? jidNormalizedUser(jid) : ''
}

function ensureJid(v = '') {
  const s = String(v || '')
  if (!s) return ''
  if (/@(s\.whatsapp\.net|lid|g\.us)$/i.test(s)) return normalizeJid(s)
  if (/^\d+$/.test(s)) return normalizeJid(s + '@s.whatsapp.net')
  return normalizeJid(s)
}

async function getPNForLID(sock, lidJid = '') {
  const lid = normalizeJid(lidJid)
  const repo = sock?.signalRepository?.lidMapping
  if (!lid || !/@lid$/i.test(lid)) return ''
  if (!repo || typeof repo.getPNForLID !== 'function') return ''
  try {
    const pn = await repo.getPNForLID(lid)
    const pnJid = ensureJid(pn)
    if (pnJid && /@s\.whatsapp\.net$/i.test(pnJid)) return pnJid
  } catch {}
  return ''
}

async function resolveUserId(sock, raw = '', metadata = null) {
  const r = normalizeJid(raw)
  if (!r) return ''

  const decodeJid =
    typeof sock?.decodeJid === 'function'
      ? sock.decodeJid.bind(sock)
      : (jid) => normalizeJid(jid)

  const d = decodeJid(r)
  if (d) {
    if (/@lid$/i.test(d)) return (await getPNForLID(sock, d)) || d
    return d
  }

  if (/@lid$/i.test(r)) {
    const pn = await getPNForLID(sock, r)
    if (pn) return pn

    const parts = metadata?.participants || []
    for (const p of parts) {
      const jid = normalizeJid(p?.jid || p?.id || p?.participant || '')
      const lid = normalizeJid(p?.lid || p?.lId || '')
      const phone = ensureJid(p?.phoneNumber || p?.pn || '')
      if (lid === r || jid === r) {
        if (phone && /@s\.whatsapp\.net$/i.test(phone)) return phone
        if (jid && /@s\.whatsapp\.net$/i.test(jid)) return jid
        return lid || r
      }
    }

    return r
  }

  return r
}

function buildUsername(userId = '') {
  return `@${String(userId).split('@')[0]}`
}

function getBestRawJid(sock) {
  const jid = sock?.user?.jid || sock?.user?.id || ''
  if (jid) return jid
  const v = getBotVisual(sock)
  return v?.jid || v?.id || ''
}

async function getSubIdentity(sock, groupMeta = null) {
  const raw = getBestRawJid(sock)
  const jid = await resolveUserId(sock, raw, groupMeta)
  const n = safeNum(String(jid).split('@')[0] || '')
  return { jid, num: n }
}

function uniqSubsByJid(items = []) {
  const map = new Map()
  for (const s of items) {
    if (!s?.isSubBot) continue
    if (!s?.ws) continue
    const key = normalizeJid(s?.user?.jid || s?.user?.id || s?.user?.lid || '')
    if (!key) continue
    if (!map.has(key)) map.set(key, s)
  }
  return Array.from(map.values())
}

async function uniqSubsByResolvedJid(items = [], groupMeta = null) {
  const map = new Map()
  for (const s of items) {
    if (!s?.isSubBot) continue
    if (!s?.ws) continue
    const { jid } = await getSubIdentity(s, groupMeta)
    const k = normalizeJid(jid)
    if (!k) continue
    if (!map.has(k)) map.set(k, s)
  }
  return Array.from(map.values())
}

let handler = async (m, { conn }) => {
  const chatId = getChatId(m)
  if (!chatId) return

  const base = Array.isArray(global.conns) ? global.conns : []
  const sessionsMap =
    global.__SUBBOT_SESSIONS__ instanceof Map ? global.__SUBBOT_SESSIONS__ : new Map()
  const fromSessions = Array.from(sessionsMap.values())

  const merged = [...base, ...fromSessions].filter((s) => s && s.ws && (s.user || s.isSubBot))

  const firstPass = uniqSubsByJid(merged)

  let groupMeta = null
  if (isGroup(chatId) && typeof conn?.groupMetadata === 'function') {
    try {
      groupMeta = await conn.groupMetadata(chatId)
    } catch {}
  }

  const subs = await uniqSubsByResolvedJid(firstPass, groupMeta)
  const subsOnline = subs.filter((s) => isWsOpen(s))

  const inThisGroup = isGroup(chatId) ? subsOnline : []

  const mentionedJidSet = new Set()

  const makeLine = async (s) => {
    const name = pickSubName(s)
    const { jid } = await getSubIdentity(s, groupMeta)
    const finalJid = ensureJid(jid)
    if (finalJid) mentionedJidSet.add(finalJid)
    const shown = finalJid ? buildUsername(finalJid) : '~—'
    return `\t• [Sub *${name}*] » ${shown}`
  }

  const listLinesArr = []
  for (const s of subsOnline) listLinesArr.push(await makeLine(s))
  const listLines = listLinesArr.join('\n')

  const groupLinesArr = []
  for (const s of inThisGroup) groupLinesArr.push(await makeLine(s))
  const groupLines = groupLinesArr.join('\n')

  const text =
    `「✦」Lista de Sub-Bots activos (*${prettyCount(subsOnline.length)}* sesiones)\n\n` +
    `✿ Subs » *${prettyCount(subsOnline.length)}* sesiones\n\n` +
    (isGroup(chatId)
      ? `❏ En este grupo: *${prettyCount(inThisGroup.length)}*\n${groupLines || '\t• — Ninguno —'}`
      : subsOnline.length
        ? listLines
        : '— Ninguno —')

  await conn.sendMessage(
    chatId,
    {
      text,
      contextInfo: {
        mentionedJid: Array.from(mentionedJidSet)
      }
    },
    { quoted: m }
  )
}

handler.help = ['bots']
handler.tags = ['serbot']
handler.command = ['bots']

export default handler