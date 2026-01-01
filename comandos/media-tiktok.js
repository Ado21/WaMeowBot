import axios from 'axios'

function esc(s = '') {
  return String(s || '')
    .replace(/\*/g, '＊')
    .replace(/_/g, '＿')
    .replace(/`/g, '｀')
}

async function replyText(conn, chat, text, quoted) {
  return conn.sendMessage(chat, { text }, { quoted })
}

async function reactMsg(conn, chat, key, emoji) {
  try {
    return await conn.sendMessage(chat, { react: { text: emoji, key } })
  } catch {
    return null
  }
}

function formatCompact(num) {
  const n = Number(num) || 0
  try {
    return new Intl.NumberFormat('en-US', { notation: 'compact', compactDisplay: 'short' }).format(n)
  } catch {
    return String(n)
  }
}

let handler = async (m, { conn, args, usedPrefix, command }) => {
  const chat = m.chat || m.key?.remoteJid
  const url = (args?.[0] || '').trim()

  if (!url) {
    return replyText(
      conn,
      chat,
      `「✦」Uso » *${usedPrefix + command}* <enlace tiktok>\n> ✐ Ejemplo » *${usedPrefix + command}* https://www.tiktok.com/@user/video/123`,
      m
    )
  }

  if (!/tiktok\.com/i.test(url)) {
    return replyText(conn, chat, '「✦」Por favor ingresa un enlace válido de TikTok.\n> ✐ Debe contener *tiktok.com*', m)
  }

  try {
    await reactMsg(conn, chat, m.key, '🕒')

    const apiUrl = `https://api-adonix.ultraplus.click/download/tiktok?apikey=${globalThis.apikey}&url=${encodeURIComponent(url)}`
    const res = await axios.get(apiUrl, { timeout: 30000 }).catch(() => null)
    const json = res?.data

    if (!json || String(json?.status).toLowerCase() !== 'true' || !json?.data) {
      await reactMsg(conn, chat, m.key, '✔️')
      return replyText(conn, chat, '「✦」No se pudo obtener el video.\n> ✐ Intenta nuevamente.', m)
    }

    const data = json.data || {}
    const authorName = data?.author?.name || data?.author?.nickname || 'Desconocido'
    const likes = formatCompact(data?.likes)
    const comments = formatCompact(data?.comments)
    const shares = formatCompact(data?.shares)
    const views = formatCompact(data?.views)
    const title = esc(data?.title || '')
    const video = data?.video || data?.videoUrl || data?.url

    if (!video) {
      await reactMsg(conn, chat, m.key, '✔️')
      return replyText(conn, chat, '「✦」No se encontró el link del video.\n> ✐ Intenta con otro enlace.', m)
    }

    const caption =
      `「✦」 *TIKTOK DOWNLOAD*\n\n` +
      `❀ *User* » *${esc(authorName)}*\n` +
      (title ? `> ❏ Título » ${title}\n` : '') +
      `> ✿ Likes » *${likes}*\n` +
      `> ᰔᩚ Comentarios » *${comments}*\n` +
      `> ❍ Shares » *${shares}*\n` +
      `> ✠ Views » *${views}*\n` +
      `> 🜸 Link » _${url}_`

    await conn.sendMessage(chat, { video: { url: video }, caption }, { quoted: m })
    await reactMsg(conn, chat, m.key, '✔️')
  } catch (err) {
    console.error(err)
    await reactMsg(conn, chat, m.key, '✔️')
    try {
      const apiUrl = `https://api-adonix.ultraplus.click/download/tiktok?apikey=${globalThis.apikey}&url=${encodeURIComponent(url)}`
      const resFallback = await axios.get(apiUrl, { timeout: 30000 })
      const videoUrl = resFallback?.data?.data?.video
      if (!videoUrl) throw new Error('no_video')
      await conn.sendMessage(chat, { video: { url: videoUrl }, caption: '「✦」Aquí tienes tu video de TikTok.' }, { quoted: m })
    } catch (e) {
      return replyText(conn, chat, '「✦」Error fatal: No se pudo descargar el video.\n> ✐ Intenta nuevamente.', m)
    }
  }
}

handler.command = ['tiktok', 'tt', 'tiktokdl']
handler.tags = ['downloader']

export default handler