const handler = async (m, ctx) => {
  const { conn, from, isGroup, text, usedPrefix, command } = ctx

  if (!isGroup) {
    await conn.sendMessage(from, { text: '「✦」Este comando solo funciona en grupos.' }, { quoted: m })
    return
  }

  const name = String(text || '').trim()
  if (!name) {
    await conn.sendMessage(from, { text: `「✦」Uso: *${usedPrefix || '.'}${command} <nuevo nombre>*` }, { quoted: m })
    return
  }

  try {
    await conn.groupUpdateSubject(from, name)
    await conn.sendMessage(from, { text: `「✿」Nombre del grupo actualizado\n> ${name}` }, { quoted: m })
  } catch {
    await conn.sendMessage(from, { text: '「✦」No pude actualizar el nombre del grupo.' }, { quoted: m })
  }
}

handler.command = ['setgpname', 'setnamegc', 'gpnombre']
handler.tags = ['group']
handler.help = ['setgpname <nuevo nombre>']

handler.useradm = true
handler.botadm = true

export default handler