import {
  withDbLock,
  loadEconomyDb,
  saveEconomyDb,
  getUser,
  getWaifuState,
  normalizeUserJid,
  getNameSafe,
  gachaDecor,
  safeUserTag,
  replyText
} from '../biblioteca/economia.js'

import { getWaifuById, rarityMeta } from '../biblioteca/waifuCatalog.js'

const CLAIM_WINDOW = 5 * 60 * 1000

function renderClaimMsg(template = '', ctx = {}) {
  const t = String(template || '').trim()
  if (!t) return ''
  const map = {
    '{name}': ctx.name,
    '{id}': ctx.id,
    '{rarity}': ctx.rarity,
    '{source}': ctx.source,
    '{value}': ctx.value,
    '{user}': ctx.user
  }
  let out = t
  for (const [k, v] of Object.entries(map)) out = out.split(k).join(String(v ?? ''))
  return out
}


const handler = async (m, { conn }) => {
  const userJid = normalizeUserJid(m?.sender)

  await withDbLock('global', async () => {
    const db = loadEconomyDb()
    const user = getUser(db, userJid)
    const userTag = safeUserTag(conn, m)

    const last = user.lastRoll || { id: '', at: 0 }
    const waifuId = String(last.id || '')
    const rolledAt = Number(last.at || 0)

    if (!waifuId || !rolledAt) {
      const text = gachaDecor({
        title: 'No tienes un roll para reclamar.',
        lines: [`> Usa *${m.usedPrefix || '.'}rw* primero.`],
        userTag
      })
      saveEconomyDb(db)
      return await replyText(conn, m, text)
    }

    const elapsed = Date.now() - rolledAt
    if (elapsed > CLAIM_WINDOW) {
      user.lastRoll = { id: '', at: 0 }
      const text = gachaDecor({
        title: 'Ese roll expiró.',
        lines: [`> Vuelve a tirar con *${m.usedPrefix || '.'}rw*.`],
        userTag
      })
      saveEconomyDb(db)
      return await replyText(conn, m, text)
    }

    const waifu = getWaifuById(waifuId)
    if (!waifu) {
      user.lastRoll = { id: '', at: 0 }
      const text = gachaDecor({
        title: 'Waifu inválida.',
        lines: [`> Vuelve a tirar con *${m.usedPrefix || '.'}rw*.`],
        userTag
      })
      saveEconomyDb(db)
      return await replyText(conn, m, text)
    }

    const state = getWaifuState(db, waifuId)
    if (state.owner) {
      const ownerName = await getNameSafe(conn, state.owner)
      const text = gachaDecor({
        title: 'Ups… ya está reclamada.',
        lines: [`> *${waifu.name}* ya fue reclamada por *${ownerName}*.`],
        userTag
      })
      user.lastRoll = { id: '', at: 0 }
      saveEconomyDb(db)
      return await replyText(conn, m, text)
    }

    // Reclamar
    state.owner = normalizeUserJid(userJid)
    state.claimedAt = Date.now()
    if (!user.waifus.includes(waifuId)) user.waifus.push(waifuId)
    user.lastRoll = { id: '', at: 0 }

    const meta = rarityMeta(waifu.rarity)

    const custom = renderClaimMsg(user.claimMsg, {
      name: waifu.name,
      id: waifu.id,
      rarity: `${meta.name} (${waifu.rarity})`,
      source: waifu.source,
      value: `¥${meta.value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`,
      user: userTag
    })

    const text = custom
      ? gachaDecor({
          title: `¡Reclamaste a ${waifu.name}!`,
          lines: [custom],
          userTag
        })
      : gachaDecor({

      title: `¡Reclamaste a ${waifu.name}!`,
      lines: [
        `> ❏ ID » *${waifu.id}*`,
        `> ✰ Rareza » *${meta.name} (${waifu.rarity})*`,
        `> ❐ Origen » *${waifu.source}*`,
        `> ♡ Valor » *¥${meta.value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')}*`,
        '',
        `✐ Mira tu inventario: *${m.usedPrefix || '.'}waifus*`,
        `✐ Vender: *${m.usedPrefix || '.'}venderwaifu ${waifu.id} 50000*`
      ],
      userTag
    })

    saveEconomyDb(db)
    await replyText(conn, m, text)
  })
}

handler.command = ['claim', 'c', 'reclamar']
handler.tags = ['gacha']
handler.help = ['c']

export default handler
