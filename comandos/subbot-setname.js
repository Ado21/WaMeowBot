import { getSubbotInfo, setSubbotName } from '../subbotManager.js'

const handler = async (m, { conn, sender, text, usedPrefix, command }) => {
  const from = m.key?.remoteJid
  if (!conn?.isSubBot) {
    return await conn.sendMessage(
      from,
      { text: '「✦」Este comando solo funciona dentro de tu subbot.' },
      { quoted: m }
    )
  }

  const info = getSubbotInfo(conn)
  if (!info || info.owner !== sender) {
    return await conn.sendMessage(from, { text: '「✦」Solo el dueño del subbot puede cambiar el nombre.' }, { quoted: m })
  }

  const newName = (text || '').trim()
  if (!newName) {
    return await conn.sendMessage(
      from,
      {
        text:
          '「✦」Envía el nuevo nombre.\n' +
          `> ✐ Ejemplo » *${usedPrefix + command} Mi Subbot*`
      },
      { quoted: m }
    )
  }

  try {
    const updated = await setSubbotName(conn, newName)
    await conn.sendMessage(
      from,
      {
        text:
          '「✦」Nombre actualizado correctamente.\n' +
          `> ✐ Nuevo nombre » *${updated?.name || newName}*`
      },
      { quoted: m }
    )
  } catch (err) {
    const msg = err?.message || 'No se pudo cambiar el nombre.'
    await conn.sendMessage(from, { text: `「✦」Error: ${msg}` }, { quoted: m })
  }
}

handler.help = ['setname']
handler.tags = ['owner']
handler.command = ['setname']

export default handler
