import { jidNormalizedUser } from '@whiskeysockets/baileys'

import {
  withDbLock,
  loadEconomyDb,
  saveEconomyDb,
  getUser,
  getWaifuState,
  setMarketEntry,
  gachaDecor,
  safeUserTag,
  normalizeUserJid,
  resolveUserJid,
  getNameSafe,
  replyText
} from '../biblioteca/economia.js'

import { getWaifuById, rarityMeta } from '../biblioteca/waifuCatalog.js'

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

    const found = participants.find((p) => {
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

function looksLikePhoneName(name = '') {
  const s = String(name || '').trim()
  if (!s) return true
  const plain = s.replace(/\s+/g, '')
  if (/^\+?\d{6,}$/.test(plain)) return true
  if (/@s\.whatsapp\.net$/i.test(s) || /@lid$/i.test(s)) return true
  return false
}

async function getBestTargetName(conn, m, targetJid) {
  const jid = normalizeUserJid(targetJid)
  if (!jid) return ''

  try {
    const n0 = await getNameSafe(conn, jid)
    if (n0 && !looksLikePhoneName(n0)) return String(n0).trim()
  } catch {}

  try {
    if (typeof conn?.getName === 'function') {
      const n1 = await conn.getName(jid)
      if (n1 && !looksLikePhoneName(n1)) return String(n1).trim()
    }
  } catch {}

  try {
    const c = conn?.contacts?.[jid]
    const n2 = c?.notify || c?.name || c?.verifiedName || c?.vname || ''
    if (n2 && !looksLikePhoneName(n2)) return String(n2).trim()
  } catch {}

  try {
    const decodeJid = getDecodeJid(conn)
    const chatJid = decodeJid(m?.chat || m?.key?.remoteJid || m?.from || '')
    if (chatJid && String(chatJid).endsWith('@g.us') && typeof conn?.groupMetadata === 'function') {
      const meta = await conn.groupMetadata(chatJid)
      const participants = Array.isArray(meta?.participants) ? meta.participants : []
      const found = participants.find((p) => {
        const pid = normalizeUserJid(p?.id || p?.jid || '')
        const plid = normalizeUserJid(p?.lid || '')
        return pid === jid || plid === jid
      })
      const n3 =
        found?.notify ||
        found?.name ||
        found?.verifiedName ||
        found?.vname ||
        ''
      if (n3 && !looksLikePhoneName(n3)) return String(n3).trim()
    }
  } catch {}

  return ''
}

function normText(t = '') {
  return String(t || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
}

function extractAtNumber(text = '') {
  const t = String(text || '')
  const m = t.match(/@([0-9]{6,15})/)
  return m?.[1] || ''
}

function looksLikeJidOrNum(s = '') {
  const t = String(s || '').trim()
  if (!t) return false
  if (/@(s\.whatsapp\.net|lid)$/i.test(t)) return true
  if (/^@\d{6,}$/.test(t)) return true
  return /^[+]?\d{6,}$/.test(t.replace(/\s+/g, ''))
}

function argToSwhats(arg = '') {
  const n = String(arg || '')
    .replace(/^@/, '')
    .replace(/[@ .+\-]/g, '')
    .replace(/\D/g, '')
  return n ? `${n}@s.whatsapp.net` : ''
}

function getQuotedRaw(m) {
  return (
    m?.quoted?.sender ||
    m?.quoted?.participant ||
    m?.msg?.contextInfo?.participant ||
    m?.message?.extendedTextMessage?.contextInfo?.participant ||
    ''
  )
}

function resolveTargetRaw(m, tokens) {
  const quoted = getQuotedRaw(m)
  if (quoted) return quoted

  const mention = Array.isArray(m?.mentionedJid) ? (m.mentionedJid[0] || '') : ''
  if (mention) return mention

  const last = tokens?.length ? tokens[tokens.length - 1] : ''
  if (looksLikeJidOrNum(last)) return last

  const n = extractAtNumber(m?.text || m?.body || '')
  if (n) return `${n}@s.whatsapp.net`

  return ''
}

function removeTargetFromTokens(tokens, targetRaw) {
  if (!tokens?.length) return []
  if (!targetRaw) return tokens

  const targetJid = normalizeUserJid(targetRaw)
  const targetNum = String(targetJid || '').split('@')[0]?.replace(/\D/g, '')

  return tokens.filter((tok) => {
    const t = String(tok || '').trim()
    if (!t) return false

    const asNum = t.replace(/^@/, '').replace(/\D/g, '')
    const asJid = normalizeUserJid(
      /@/.test(t) ? t : (looksLikeJidOrNum(t) ? argToSwhats(t) : t)
    )

    if (t === targetRaw) return false
    if (asJid && targetJid && asJid === targetJid) return false
    if (targetNum && asNum && asNum === targetNum) return false

    return true
  })
}

function isLikelyId(s = '') {
  const t = String(s || '').trim().toLowerCase()
  return /^w\d+$/i.test(t) || /^\d+$/.test(t)
}

function findOwnedMatchByName(ownedIds, query) {
  const q = normText(query)
  if (!q) return { exact: null, matches: [] }

  const matches = []
  for (const id of ownedIds) {
    const w = getWaifuById(id)
    if (!w) continue
    const name = normText(w.name)
    const src = normText(w.source || w.anime || '')
    let score = 0
    if (name === q) score += 100
    if (name.startsWith(q)) score += 70
    if (name.includes(q)) score += 45
    if (src && (src === q || src.includes(q))) score += 15
    if (score > 0) matches.push({ id, w, score })
  }

  matches.sort((a, b) => b.score - a.score)
  return { exact: matches[0]?.id || null, matches: matches.slice(0, 8) }
}

const handler = async (m, { conn, text, usedPrefix, command }) => {
  const arg = String(text || '').trim()
  const tokens = arg ? arg.split(/\s+/) : []

  const senderJid =
    (await ensureUserJid(conn, m, m?.sender)) ||
    (await resolveUserJid(conn, m?.sender)) ||
    normalizeUserJid(m?.sender)

  await withDbLock('global', async () => {
    const db = loadEconomyDb()
    const user = getUser(db, normalizeUserJid(senderJid))
    const userTag = safeUserTag(conn, m)

    const pickedTarget = await pickTargetJid(m, conn)
    const targetRaw = pickedTarget || resolveTargetRaw(m, tokens)
    const rest = removeTargetFromTokens(tokens, targetRaw)

    const wanted = targetRaw
      ? (looksLikeJidOrNum(targetRaw) ? (/@/.test(targetRaw) ? targetRaw : argToSwhats(targetRaw)) : targetRaw)
      : ''

    const targetJid =
      wanted
        ? ((await ensureUserJid(conn, m, wanted)) || (await resolveUserJid(conn, wanted)))
        : ''

    const targetOk = targetJid && !/@lid$/i.test(String(targetJid || ''))

    if (!rest.length || !targetOk) {
      const t = gachaDecor({
        title: 'Uso incorrecto.',
        lines: [
          `> Ej: *${usedPrefix || '.'}${command} Kurome @usuario*`,
          `> Ej: *${usedPrefix || '.'}${command} 126 @usuario*`,
          `> O responde al usuario: *${usedPrefix || '.'}${command} Kurome*`
        ],
        userTag
      })
      saveEconomyDb(db)
      return replyText(conn, m, t)
    }

    if (normalizeUserJid(targetJid) === normalizeUserJid(senderJid)) {
      const t = gachaDecor({
        title: 'No puedes regalarte a ti mismo.',
        lines: [`> Menciona o responde a otra persona.`],
        userTag
      })
      saveEconomyDb(db)
      return replyText(conn, m, t)
    }

    const owned = Array.isArray(user.waifus) ? user.waifus.map(String) : []
    if (!owned.length) {
      const t = gachaDecor({
        title: 'No tienes waifus para regalar.',
        lines: [`> Tu inv: *${usedPrefix || '.'}waifus*`],
        userTag
      })
      saveEconomyDb(db)
      return replyText(conn, m, t)
    }

    const query = rest.join(' ').replace(/^"|"$/g, '').trim()
    const first = rest[0] || ''

    let waifuId = ''
    if (isLikelyId(first) && owned.includes(String(first))) {
      waifuId = String(first)
    } else if (isLikelyId(query) && owned.includes(String(query))) {
      waifuId = String(query)
    } else {
      const { exact, matches } = findOwnedMatchByName(owned, query)
      if (!exact) {
        const t = gachaDecor({
          title: 'No encontré esa waifu en tu inventario.',
          lines: [
            `> Busqué: *${query || '(vacío)'}*`,
            `> Revisa tu inv: *${usedPrefix || '.'}waifus*`,
            `> Tip: regala por ID si hay duda: *${usedPrefix || '.'}${command} 126 @usuario*`
          ],
          userTag
        })
        saveEconomyDb(db)
        return replyText(conn, m, t)
      }

      const bestScore = matches?.[0]?.score || 0
      const close = (matches || []).filter((x) => x.score >= bestScore - 10)
      if (close.length >= 2) {
        const opts = close
          .map(
            (x, i) =>
              `> ${(i + 1).toString().padStart(2, '0')}. *${x.w?.name || x.id}*  —  ID: *${x.id}*`
          )
          .join('\n')

        const t = gachaDecor({
          title: 'Encontré varias coincidencias.',
          lines: [opts, '', `✐ Regala por ID: *${usedPrefix || '.'}${command} <id> @usuario*`],
          userTag
        })
        saveEconomyDb(db)
        return replyText(conn, m, t)
      }

      waifuId = String(exact)
    }

    if (!waifuId || !owned.includes(String(waifuId))) {
      const t = gachaDecor({
        title: 'No tienes esa waifu.',
        lines: [`> Revisa tu inv: *${usedPrefix || '.'}waifus*`],
        userTag
      })
      saveEconomyDb(db)
      return replyText(conn, m, t)
    }

    const state = getWaifuState(db, waifuId)
    if (state.owner && normalizeUserJid(state.owner) !== normalizeUserJid(senderJid)) {
      const ownerName = await getNameSafe(conn, state.owner)
      const t = gachaDecor({
        title: 'Esa waifu no es tuya.',
        lines: [`> Actualmente pertenece a *${ownerName}*.`],
        userTag
      })
      saveEconomyDb(db)
      return replyText(conn, m, t)
    }

    const targetUser = getUser(db, normalizeUserJid(targetJid))

    state.owner = normalizeUserJid(targetJid)
    state.claimedAt = Date.now()

    user.waifus = owned.filter((x) => String(x) !== String(waifuId))
    if (!Array.isArray(targetUser.waifus)) targetUser.waifus = []
    if (!targetUser.waifus.map(String).includes(String(waifuId))) targetUser.waifus.push(String(waifuId))

    setMarketEntry(db, waifuId, null)

    const w = getWaifuById(waifuId)
    const meta = rarityMeta(w?.rarity)
    const origin = w ? (w.source || w.anime || 'Desconocido') : 'Desconocido'

    const toId = getUserId(targetJid)
    const bestName = await getBestTargetName(conn, m, targetJid)
    const toName = (bestName || '').trim() || String(await getNameSafe(conn, targetJid) || '').trim() || `+${toId}`

    const t = gachaDecor({
      title: '`Regalo exitoso`',
      lines: [
        `> Entregaste *${w?.name || waifuId}* a *${toName}*.`,
        `> ❏ ID » *${waifuId}*`,
        w ? `> ✰ Rareza » *${meta.name} (${w.rarity})*` : '',
        w ? `> ❐ Origen » *${origin}*` : ''
      ].filter(Boolean),
      userTag
    })

    saveEconomyDb(db)
    return replyText(conn, m, t, { mentions: [targetJid] })
  })
}

handler.command = ['givechar', 'givewaifu', 'regalarwaifu', 'regalar']
handler.tags = ['gacha']
handler.help = ['regalarwaifu <id|nombre> @usuario', 'regalarwaifu <id|nombre> (respondiendo)']

export default handler