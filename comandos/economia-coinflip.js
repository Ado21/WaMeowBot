import {
  withDbLock,
  loadEconomyDb,
  saveEconomyDb,
  getSubbotId,
  getUser,
  parseAmount,
  formatMoney,
  economyDecor,
  safeUserTag,
  getCooldown,
  setCooldown,
  pick,
  replyText
} from '../biblioteca/economia.js'

const CD = 15 * 1000

const WIN_LINES = [
  'La moneda cayó de tu lado',
  'Te sonrió la suerte',
  '¡Ganaste limpio!'
]

const LOSE_LINES = [
  'Se te fue por nada',
  'La moneda te traicionó',
  'Hoy no fue tu día'
]

function normalizeChoice(s = '') {
  const t = String(s || '').toLowerCase()
  if (['cara', 'c', 'heads', 'h'].includes(t)) return 'cara'
  if (['cruz', 'x', 'tails', 't'].includes(t)) return 'cruz'
  return null
}

const handler = async (m, { conn, args }) => {
  const subbotId = getSubbotId(conn)
  const userJid = m?.sender

  await withDbLock(subbotId, async () => {
    const db = loadEconomyDb()
    const user = getUser(db, subbotId, userJid)
    const userTag = safeUserTag(conn, m)

    const remain = getCooldown(user, 'coinflip')
    if (remain > 0) {
      const text = economyDecor({
        title: 'Espera un momento para lanzar otra moneda.',
        lines: ['> Mira tu tiempo en *.einfo*'],
        userTag
      })
      saveEconomyDb(db)
      return await replyText(conn, m, text)
    }

    const amount = parseAmount(args?.[0], user.wallet)
    const choice = normalizeChoice(args?.[1] || '')

    if (!amount || amount <= 0) {
      const text = economyDecor({
        title: 'Uso: coinflip <cantidad> [cara/cruz]',
        lines: ['> Ej: coinflip 50k cara'],
        userTag
      })
      saveEconomyDb(db)
      return await replyText(conn, m, text)
    }

    if (user.wallet < amount) {
      const text = economyDecor({
        title: 'No tienes suficiente para apostar.',
        lines: ['> Mira tu dinero en *.einfo*'],
        userTag
      })
      saveEconomyDb(db)
      return await replyText(conn, m, text)
    }

    // Resolver resultado
    const result = Math.random() < 0.5 ? 'cara' : 'cruz'
    const win = choice ? result === choice : Math.random() < 0.5

    user.stats.coinflip = (user.stats.coinflip || 0) + 1
    setCooldown(user, 'coinflip', CD)

    if (win) {
      user.wallet += amount
      const text = economyDecor({
        title: `¡Coinflip ganado! +${formatMoney(amount)}`,
        lines: [
          `> Resultado: *${result}*${choice ? ` (elegiste *${choice}*)` : ''}.`,
          `> ${pick(WIN_LINES)}.`
        ],
        userTag
      })
      saveEconomyDb(db)
      return await replyText(conn, m, text)
    }

    user.wallet = Math.max(0, user.wallet - amount)
    const text = economyDecor({
      title: `Coinflip perdido... -${formatMoney(amount)}`,
      lines: [
        `> Resultado: *${result}*${choice ? ` (elegiste *${choice}*)` : ''}.`,
        `> ${pick(LOSE_LINES)}.`
      ],
      userTag
    })

    saveEconomyDb(db)
    return await replyText(conn, m, text)
  })
}

handler.command = ['coinflip', 'flip', 'cf', 'caracruz', 'moneda']
handler.tags = ['economy']
handler.help = ['coinflip 50k cara']

export default handler
