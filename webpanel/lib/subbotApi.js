import fs from 'fs'
import path from 'path'
import { jidNormalizedUser } from '@whiskeysockets/baileys'

import { ensureSubbot, getBotVisual } from '../../subbotManager.js'
import {
  isWelcomeEnabled,
  isAvisosEnabled,
  isBotEnabled,
  isAntilinkEnabled,
  setWelcomeEnabled,
  setAvisosEnabled,
  setBotEnabled,
  setAntilinkEnabled,
  setWelcomeMessage,
  getWelcomeMessage,
  setByeMessage,
  getByeMessage
} from '../../biblioteca/settings.js'

import {
  getPrimaryKey,
  setPrimaryForChat,
  clearPrimaryForChat
} from '../../biblioteca/primary.js'


function isWsOpen(sock) {
  const rs1 = sock?.ws?.socket?.readyState
  const rs2 = sock?.ws?.readyState
  return rs1 === 1 || rs2 === 1
}

function normalizeJid(jid = '') {
  return jid ? jidNormalizedUser(jid) : ''
}

function getDecodeJid(sock) {
  return typeof sock?.decodeJid === 'function'
    ? sock.decodeJid.bind(sock)
    : (jid) => normalizeJid(jid)
}

function listAllConnectedBots(decodeJid) {
  const base = Array.isArray(global.conns) ? global.conns : []
  const sessions = global.__SUBBOT_SESSIONS__ instanceof Map ? Array.from(global.__SUBBOT_SESSIONS__.values()) : []

  const merged = [...base, ...sessions]
  const map = new Map()

  for (const s of merged) {
    if (!s?.user) continue
    if (!s?.ws) continue
    if (!isWsOpen(s)) continue

    const isSub = Boolean(s?.isSubBot)
    const key = isSub ? `subbot:${String(s?.subbotId || '').trim()}` : 'main'
    const jid = decodeJid(s?.user?.jid || s?.user?.id || '')
    if (!jid || !key) continue

    const label = isSub ? `Subbot ${String(s?.subbotId || '').trim()}` : 'Main'
    map.set(key, { jid, key, label, isSubBot: isSub })
  }

  return Array.from(map.values())
}

function getParticipantJid(p = {}, decodeJid) {
  
  const raw = p?.jid || p?.id || p?.participant || ''
  return decodeJid(raw)
}

function computeGlobalSubbotCount() {
  const base = Array.isArray(global.conns) ? global.conns : []
  const sessions = global.__SUBBOT_SESSIONS__ instanceof Map ? Array.from(global.__SUBBOT_SESSIONS__.values()) : []
  const merged = [...base, ...sessions]
  const map = new Map()
  for (const s of merged) {
    if (!s?.isSubBot) continue
    if (!s?.ws) continue
    if (!isWsOpen(s)) continue
    const jid = normalizeJid(s?.user?.jid || s?.user?.id || '')
    if (!jid) continue
    map.set(jid, s)
  }
  return map.size
}

function getSubbotIdFromWaNumber(waNumber = '') {
  return String(waNumber || '').replace(/\D/g, '')
}

function getSessionDirFor(waNumber = '') {
  const id = getSubbotIdFromWaNumber(waNumber)
  return path.join('./', 'Sessions/SubBotTemp', id)
}

function hasSession(waNumber = '') {
  const d = getSessionDirFor(waNumber)
  return fs.existsSync(d)
}

function getConnectedStatus(waNumber = '') {
  const id = getSubbotIdFromWaNumber(waNumber)
  const sessions = global.__SUBBOT_SESSIONS__ instanceof Map ? global.__SUBBOT_SESSIONS__ : new Map()
  const sock = sessions.get(id)
  if (sock && isWsOpen(sock) && sock.user) return { connected: true, id }
  
  const base = Array.isArray(global.conns) ? global.conns : []
  const found = base.find((s) => s?.isSubBot && String(s?.subbotId || '') === id && isWsOpen(s))
  return { connected: !!found, id }
}

async function getMySubbotSummary(waNumber = '') {
  const id = getSubbotIdFromWaNumber(waNumber)
  const sessionExists = hasSession(waNumber)
  const { connected } = getConnectedStatus(waNumber)

  let info = null
  try {
    const sessions = global.__SUBBOT_SESSIONS__ instanceof Map ? global.__SUBBOT_SESSIONS__ : new Map()
    const sock = sessions.get(id)
    if (sock) info = getBotVisual(sock)
  } catch {}

  if (!info && sessionExists) {
    const infoPath = path.join(getSessionDirFor(waNumber), 'info.json')
    try {
      const raw = fs.readFileSync(infoPath, 'utf8')
      const parsed = JSON.parse(raw)
      info = {
        id,
        name: parsed?.name || '',
        banner: parsed?.banner || '',
        owner: parsed?.owner || '',
        isSubBot: true
      }
    } catch {}
  }

  return {
    id,
    sessionExists,
    connected,
    info
  }
}

async function ensureMySubbot(waNumber = '') {
  const ownerJid = `${getSubbotIdFromWaNumber(waNumber)}@s.whatsapp.net`
  const res = await ensureSubbot(ownerJid)
  return res
}

async function listMyGroups(waNumber = '') {
  const id = getSubbotIdFromWaNumber(waNumber)
  const ownerJid = `${id}@s.whatsapp.net`
  await ensureSubbot(ownerJid)

  const sessions = global.__SUBBOT_SESSIONS__ instanceof Map ? global.__SUBBOT_SESSIONS__ : new Map()
  const sock = sessions.get(id)
  if (!sock) throw new Error('Subbot no encontrado')

  const decodeJid = getDecodeJid(sock)

  const groupsObj = await sock.groupFetchAllParticipating().catch(() => ({}))
  const groups = Object.values(groupsObj || {})

  const botList = listAllConnectedBots(decodeJid)

  return groups
    .map((g) => {
      const gid = g.id

      const parts = Array.isArray(g.participants) ? g.participants : []
      const participantIds = parts
        .map((p) => getParticipantJid(p, decodeJid))
        .filter(Boolean)

      const myJid = decodeJid(sock?.user?.jid || sock?.user?.id || '')
      const me = parts.find((p) => getParticipantJid(p, decodeJid) === myJid)
      const botIsAdmin = Boolean(me?.admin)

      const botsInGroup = botList.filter((b) => participantIds.includes(decodeJid(b.jid)))

      const primaryKey = getPrimaryKey(gid)
      const primaryBot = botsInGroup.find((b) => b.key === primaryKey) || null
      const primaryLabel = primaryBot?.label || (primaryKey ? primaryKey : '')

      return {
        id: gid,
        subject: g.subject || 'Grupo',
        size: g.size || (g.participants?.length || 0),
        botIsAdmin,
        primaryKey,
        primaryLabel,
        botsInGroup,
        bot: isBotEnabled(gid, id),
        antilink: isAntilinkEnabled(gid, id),
        welcome: isWelcomeEnabled(gid, id),
        avisos: isAvisosEnabled(gid, id)
      }
    })
    .sort((a, b) => a.subject.localeCompare(b.subject))
}

async function getBotsInGroupForOwner(waNumber = '', groupId = '') {
  const id = getSubbotIdFromWaNumber(waNumber)
  const ownerJid = `${id}@s.whatsapp.net`
  await ensureSubbot(ownerJid)

  const sessions = global.__SUBBOT_SESSIONS__ instanceof Map ? global.__SUBBOT_SESSIONS__ : new Map()
  const sock = sessions.get(id)
  if (!sock) throw new Error('Subbot no encontrado')

  const decodeJid = getDecodeJid(sock)
  const myJid = decodeJid(sock?.user?.jid || sock?.user?.id || '')

  const metadata = await sock.groupMetadata(groupId).catch(() => null)
  if (!metadata) throw new Error('No se pudo leer metadata del grupo')

  const parts = Array.isArray(metadata.participants) ? metadata.participants : []
  const participantIds = parts.map((p) => getParticipantJid(p, decodeJid)).filter(Boolean)
  const me = parts.find((p) => getParticipantJid(p, decodeJid) === myJid)
  const botIsAdmin = Boolean(me?.admin)

  const botList = listAllConnectedBots(decodeJid)
  const botsInGroup = botList.filter((b) => participantIds.includes(decodeJid(b.jid)))

  return { botIsAdmin, botsInGroup }
}

async function setGroupPrimary({ waNumber, groupId, key }) {
  await assertSubbotAdminInGroup(waNumber, groupId)
  const { botsInGroup } = await getBotsInGroupForOwner(waNumber, groupId)
  const sel = String(key || '').trim()
  if (!sel) throw new Error('key requerido')
  const allowed = botsInGroup.some((b) => b.key === sel)
  if (!allowed) throw new Error('Ese bot no está en el grupo o no está conectado.')
  const ok = setPrimaryForChat(groupId, sel)
  if (!ok) throw new Error('No se pudo establecer primary')
  const primaryKey = getPrimaryKey(groupId)
  const primaryBot = botsInGroup.find((b) => b.key === primaryKey) || null
  return { groupId, primaryKey, primaryLabel: primaryBot?.label || primaryKey }
}

async function clearGroupPrimary({ waNumber, groupId }) {
  await assertSubbotAdminInGroup(waNumber, groupId)
  const { botsInGroup } = await getBotsInGroupForOwner(waNumber, groupId)
  clearPrimaryForChat(groupId)
  const primaryKey = getPrimaryKey(groupId)
  const primaryBot = botsInGroup.find((b) => b.key === primaryKey) || null
  return { groupId, primaryKey, primaryLabel: primaryBot?.label || primaryKey }
}

function setGroupToggles({ waNumber, groupId, bot, antilink, welcome, avisos }) {
  const subbotId = getSubbotIdFromWaNumber(waNumber)
  if (typeof bot === 'boolean') setBotEnabled(groupId, bot, subbotId)
  if (typeof antilink === 'boolean') setAntilinkEnabled(groupId, antilink, subbotId)
  if (typeof welcome === 'boolean') setWelcomeEnabled(groupId, welcome, subbotId)
  if (typeof avisos === 'boolean') setAvisosEnabled(groupId, avisos, subbotId)
  return {
    groupId,
    bot: isBotEnabled(groupId, subbotId),
    antilink: isAntilinkEnabled(groupId, subbotId),
    welcome: isWelcomeEnabled(groupId, subbotId),
    avisos: isAvisosEnabled(groupId, subbotId)
  }
}


async function assertSubbotAdminInGroup(waNumber = '', groupId = '') {
  const id = getSubbotIdFromWaNumber(waNumber)
  const ownerJid = `${id}@s.whatsapp.net`
  await ensureSubbot(ownerJid)

  const sessions = global.__SUBBOT_SESSIONS__ instanceof Map ? global.__SUBBOT_SESSIONS__ : new Map()
  const sock = sessions.get(id)
  if (!sock) throw new Error('Subbot no encontrado')

  const decodeJid = getDecodeJid(sock)
  const myJid = decodeJid(sock?.user?.jid || sock?.user?.id || '')

  const metadata = await sock.groupMetadata(groupId).catch(() => null)
  if (!metadata) throw new Error('No se pudo leer metadata del grupo')

  const parts = Array.isArray(metadata.participants) ? metadata.participants : []
  const me = parts.find((p) => getParticipantJid(p, decodeJid) === myJid)
  const botIsAdmin = Boolean(me?.admin)
  if (!botIsAdmin) throw new Error('El subbot no es admin en ese grupo')
  return true
}

function getGroupMessages({ waNumber, groupId }) {
  const subbotId = getSubbotIdFromWaNumber(waNumber)
  return {
    groupId,
    welcomeText: getWelcomeMessage(groupId, subbotId),
    byeText: getByeMessage(groupId, subbotId)
  }
}

async function setGroupMessages({ waNumber, groupId, welcomeText, byeText }) {
  await assertSubbotAdminInGroup(waNumber, groupId)

  const subbotId = getSubbotIdFromWaNumber(waNumber)
  if (typeof welcomeText === 'string') setWelcomeMessage(groupId, welcomeText, subbotId)
  if (typeof byeText === 'string') setByeMessage(groupId, byeText, subbotId)

  return getGroupMessages({ waNumber, groupId })
}

export {
  computeGlobalSubbotCount,
  getMySubbotSummary,
  ensureMySubbot,
  listMyGroups,
  setGroupToggles,
  getGroupMessages,
  setGroupMessages,
  setGroupPrimary,
  clearGroupPrimary,
  getSubbotIdFromWaNumber,
  getSessionDirFor
}
