import { jidNormalizedUser } from '@whiskeysockets/baileys'

import {
  withDbLock,
  loadEconomyDb,
  saveEconomyDb,
  getSubbotId,
  getUser,
  parseAmount,
  formatMoney,
  economyDecor,
  replyText,
  normalizeUserJid,
  resolveUserJid,
  getNameSafe
} from '../biblioteca/economia.js'

const CDUMMY = 0

function normalizeJid(jid = '') {
  return jid ? jidNormalizedUser(jid) : ''
}

function getDecodeJid(conn) {
  return typeof conn?.decodeJid === 'function'
    ? conn.decodeJid.bind(conn)
    : (jid) => normalizeJid(jid)
}

function getParticipantJid(p = {}, decodeJid) {
  const raw = p?.jid || p?.id || p?.participant || ''
  return decodeJid(raw)
}

function getUserId(userId = '') {
  return String(userId || '').split('@')[0]
}

async function resolveLidToPnJid(conn, chatJid, candidateJid) {
  const jid = normalizeJid(candidateJid)
  if (!jid || !jid.endsWith('@lid')) return jid
  if (!chatJid || !String(chatJid).endsWith('@g.us')) return jid
  if (typeof conn?.groupMetadata !== 'function') return jid

  try {
    const meta = await conn.groupMetadata(chatJid)
    const participants = Array.isArray(meta?.participants) ? meta.participants : []

    const found = participants.find(p => {
      const pid = normalizeJid(p?.id || '')
      const plid = normalizeJid(p?.lid || '')
      const pjid = normalizeJid(p?.jid || '')
      return pid === jid || plid === jid || pjid === jid
    })

    const mapped = normalizeJid(found?.jid || '')
    return mapped || jid
  } catch {
    return jid
  }
}

async function pickTargetJid(m, conn) {
  const decodeJid = getDecodeJid(conn)
  const chatJid = decodeJid(m?.chat || m?.key?.remoteJid || m?.from || '')

  const ctx =
    m?.message?.extendedTextMessage?.contextInfo ||
    m?.msg?.contextInfo ||
    {}

  const mentioned =
    m?.mentionedJid ||
    ctx?.mentionedJid ||
    ctx?.mentionedJidList ||
    []

  if (Array.isArray(mentioned) && mentioned.length) {
    const raw = decodeJid(mentioned[0])
    const fixed = await resolveLidToPnJid(conn, chatJid, raw)
    return decodeJid(fixed)
  }

  const text =
    m?.text ||
    m?.body ||
    m?.message?.conversation ||
    m?.message?.extendedTextMessage?.text ||
    ''

  if (conn?.parseMention) {
    const parsed = conn.parseMention(String(text))
    if (parsed?.length) {
      const raw = decodeJid(parsed[0])
      const fixed = await resolveLidToPnJid(conn, chatJid, raw)
      return decodeJid(fixed)
    }
  }

  const quotedCtx =
    m?.quoted?.msg?.contextInfo ||
    m?.quoted?.contextInfo ||
    {}

  const qRaw =
    getParticipantJid(m?.quoted?.participant, decodeJid) ||
    getParticipantJid(ctx?.participant, decodeJid) ||
    getParticipantJid(quotedCtx?.participant, decodeJid)

  if (qRaw) {
    const fixed = await resolveLidToPnJid(conn, chatJid, qRaw)
    return decodeJid(fixed)
  }

  return ''
}

async function ensureUserJid(conn, m, raw = '') {
  const decodeJid = getDecodeJid(conn)
  const chatJid = decodeJid(m?.chat || m?.key?.remoteJid || m?.from || '')

  const s = String(raw || '').trim()
  if (!s) return null

  if (/@(s\.whatsapp\.net|lid|g\.us)$/i.test(s)) {
    const decoded = decodeJid(s)
    const fixed = await resolveLidToPnJid(conn, chatJid, decoded)
    const r = await resolveUserJid(conn, fixed)
    const out = decodeJid(r || fixed)
    return out && !/@lid$/i.test(out) ? out : null
  }

  const num = s.replace(/^@/, '').replace(/\D/g, '')
  const jid = num ? `${num}@s.whatsapp.net` : null
  if (!jid) return null

  const r = await resolveUserJid(conn, jid)
  const out = decodeJid(r || jid)
  return out && !/@lid$/i.test(out) ? out : null
}

function sanitizeNumber(input = '') {
  return String(input || '').replace(/[@ .+-]/g, '').replace(/\D/g, '')
}

function argToSwhats(arg = '') {
  const n = sanitizeNumber(arg)
  return n ? `${n}@s.whatsapp.net` : ''
}

function isNumberLike(arg = '') {
  const n = sanitizeNumber(arg)
  return n.length >= 6 && n.length <= 15
}

function isNumber(x) {
  return !isNaN(x)
}

function getQuotedJid(m) {
  const q =
    m?.quoted?.sender ||
    m?.quoted?.participant ||
    m?.msg?.contextInfo?.participant ||
    m?.message?.extendedTextMessage?.contextInfo?.participant ||
    null
  return q ? normalizeUserJid(q) : ''
}

async function handler(m, { conn, args, usedPrefix, command }) {
  const subbotId = getSubbotId(conn)

  const sender =
    (await ensureUserJid(conn, m, m?.sender)) ||
    (await resolveUserJid(conn, m?.sender)) ||
    normalizeUserJid(m?.sender)

  await withDbLock(subbotId, async () => {
    const db = loadEconomyDb()

    const quotedJid = getQuotedJid(m)
    const picked = await pickTargetJid(m, conn)

    const hasMention = !!picked
    const hasReply = !!quotedJid

    if (!args[0] || (!args[1] && !hasReply && !hasMention)) {
      const text = economyDecor({
        title: `Uso: ${(usedPrefix || '.') + (command || 'pay')} <cantidad> <numero|@mencion>`,
        lines: [
          `> Número » ${(usedPrefix || '.') + (command || 'pay')} 25000 50493059810`,
          `> Mención » ${(usedPrefix || '.') + (command || 'pay')} 25000 @usuario`,
          `> Reply » Responde a alguien y usa: ${(usedPrefix || '.') + (command || 'pay')} 25000`
        ]
      })
      saveEconomyDb(db)
      return await replyText(conn, m, text)
    }

    if (!isNumber(args[0]) && String(args[0]).startsWith('@')) {
      const text = economyDecor({
        title: 'Primero indica la cantidad y luego el usuario.',
        lines: [
          `> Ejemplo: ${(usedPrefix || '.') + (command || 'pay')} 1000 @usuario`,
          `> Con reply: ${(usedPrefix || '.') + (command || 'pay')} 1000`
        ]
      })
      saveEconomyDb(db)
      return await replyText(conn, m, text)
    }

    let who = ''

    if (hasMention) {
      who =
        (await ensureUserJid(conn, m, picked)) ||
        (await resolveUserJid(conn, picked)) ||
        ''
    } else if (hasReply) {
      who =
        (await ensureUserJid(conn, m, quotedJid)) ||
        (await resolveUserJid(conn, quotedJid)) ||
        normalizeUserJid(quotedJid)
    } else {
      if (!isNumberLike(args[1])) {
        const text = economyDecor({
          title: 'Número inválido.',
          lines: [
            `> Ejemplo: ${(usedPrefix || '.') + (command || 'pay')} 1000 50493059810`,
            `> También sirve: ${(usedPrefix || '.') + (command || 'pay')} 1000 +50493059810`,
            `> O menciona: ${(usedPrefix || '.') + (command || 'pay')} 1000 @usuario`
          ]
        })
        saveEconomyDb(db)
        return await replyText(conn, m, text)
      }

      const jid = argToSwhats(args[1])
      who =
        (await ensureUserJid(conn, m, jid)) ||
        (await resolveUserJid(conn, jid)) ||
        normalizeUserJid(jid)
    }

    who = normalizeUserJid(who)

    if (!who) {
      const text = economyDecor({
        title: 'No pude identificar al usuario.',
        lines: [
          `> Por número: ${(usedPrefix || '.') + (command || 'pay')} 1000 23210439508110`,
          `> Por mención: ${(usedPrefix || '.') + (command || 'pay')} 1000 @usuario`,
          `> Con reply: responde al usuario y usa ${(usedPrefix || '.') + (command || 'pay')} 1000`
        ]
      })
      saveEconomyDb(db)
      return await replyText(conn, m, text)
    }

    if (/@lid$/i.test(String(who || ''))) {
      const text = economyDecor({
        title: 'No pude resolver ese usuario (lid).',
        lines: [
          `> Intenta responder a su mensaje, o escribe su número.`,
          `> Ej: ${(usedPrefix || '.') + (command || 'pay')} 1000 50493059810`
        ]
      })
      saveEconomyDb(db)
      return await replyText(conn, m, text)
    }

    if (who === normalizeUserJid(sender)) {
      const text = economyDecor({ title: 'No puedes pagarte a ti mismo.'
})
      saveEconomyDb(db)
      return await replyText(conn, m, text)
    }

    const senderUser = getUser(db, subbotId, normalizeUserJid(sender))
    const recipient = getUser(db, subbotId, who)

    const rawAmount = String(args[0] || '')
    const count = parseAmount(rawAmount, senderUser.wallet)

    if (!count || count <= 0) {
      const text = economyDecor({
        title: 'Cantidad inválida.',
        lines: [
          `> Ejemplo: ${(usedPrefix || '.') + (command || 'pay')} 1000 @usuario`,
          `> O por número: ${(usedPrefix || '.') + (command || 'pay')} 1000 50493059810`
        ]
      })
      saveEconomyDb(db)
      return await replyText(conn, m, text)
    }

    if (senderUser.wallet < count) {
      const text = economyDecor({
        title: 'No tienes suficiente en la billetera.',
        lines: ['> Mira tu dinero en .einfo']
      })
      saveEconomyDb(db)
      return await replyText(conn, m, text)
    }

    senderUser.wallet -= count
    recipient.wallet += count
    senderUser.stats.pay = (senderUser.stats.pay || 0) + 1
    const toNameRaw = await getNameSafe(conn, who)
    const toName = String(toNameRaw || '').replace(/\s+/g, ' ').trim() ||
      (who ? `+${String(who).split('@')[0].replace(/\D/g, '')}` : 'usuario')

    const text = economyDecor({
      title: `Pago enviado: -${formatMoney(count)}`,
      lines: [`> Le enviaste *${formatMoney(count)}* a ${toName}.`]
    })

    saveEconomyDb(db)
    return await replyText(conn, m, text, { mentions: [who] })
  })
}

handler.help = ['pay 1000 50493732693', 'pay 1000 @usuario', 'pay 1000 (respondiendo a alguien)']
handler.tags = ['economy']
handler.command = ['givecoins', 'coinsgive', 'pay', 'pagar', 'transferir']

export default handler