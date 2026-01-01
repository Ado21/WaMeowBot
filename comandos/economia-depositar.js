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
  replyText
} from '../biblioteca/economia.js'

const handler = async (m, { conn, args }) => {
  const subbotId = getSubbotId(conn)
  const userJid = m?.sender
  const input = args?.[0]

  await withDbLock(subbotId, async () => {
    const db = loadEconomyDb()
    const user = getUser(db, subbotId, userJid)

    const amount = parseAmount(input, user.wallet)
    const userTag = safeUserTag(conn, m)

    if (!amount || amount <= 0) {
      const text = economyDecor({
        title: 'Uso: dep all | dep <cantidad>',
        lines: [
          `> Billetera » *${formatMoney(user.wallet)}*`,
          `> Banco » *${formatMoney(user.bank)}*`
        ],
        userTag
      })
      saveEconomyDb(db)
      return await replyText(conn, m, text)
    }

    if (user.wallet < amount) {
      const text = economyDecor({
        title: 'No tienes suficiente en la billetera.',
        lines: [`> Te faltan » *${formatMoney(amount - user.wallet)}*`],
        userTag
      })
      saveEconomyDb(db)
      return await replyText(conn, m, text)
    }

    user.wallet -= amount
    user.bank += amount

    const text = economyDecor({
      title: `Has depositado *${formatMoney(amount)}* al banco.`,
      lines: [
        `> Billetera » *${formatMoney(user.wallet)}*`,
        `> Banco » *${formatMoney(user.bank)}*`
      ],
      userTag
    })

    saveEconomyDb(db)
    await replyText(conn, m, text)
  })
}

handler.command = ['deposit', 'dep', 'depositar', 'deposito', 'd']
handler.tags = ['economy']
handler.help = ['dep all', 'deposit 50000', 'depositar 50k']

export default handler
                                      
