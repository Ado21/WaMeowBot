import axios from 'axios'

let handler = async (m, { conn, args, usedPrefix, command }) => {
  const chatId = m?.chat || m?.key?.remoteJid
  if (!chatId) return

  const url = (args?.[0] || '').trim()

  if (!url || !/^https?:\/\/(www\.)?mediafire\.com\/.+/i.test(url)) {
    return await conn.sendMessage(
      chatId,
      {
        text:
          `「✦」Uso correcto:\n` +
          `> ✐ ${usedPrefix + command} <link-mediafire>\n\n` +
          `「✦」Ejemplo:\n` +
          `> ✐ ${usedPrefix + command} https://www.mediafire.com/file/xxxx/archivo.zip/file`
      },
      { quoted: m }
    )
  }

  const api = `https://api-adonix.ultraplus.click/download/mediafire?apikey=Adofreekey&url=${encodeURIComponent(url)}`

  const getExtFromUrl = (u = '') => {
    try {
      const clean = u.split('?')[0].split('#')[0]
      const last = clean.substring(clean.lastIndexOf('/') + 1)
      const m = last.match(/\.([a-z0-9]{1,10})$/i)
      return m ? m[1].toLowerCase() : ''
    } catch {
      return ''
    }
  }

  const sanitizeName = (s = '') =>
    (s || 'archivo').toString().replace(/[\/\\:*?"<>|]/g, '').trim() || 'archivo'

  const withExtension = (fileName = 'archivo', u = '') => {
    const ext = getExtFromUrl(u)
    const base = sanitizeName(fileName)
    if (!ext) return base
    if (new RegExp(`\\.${ext}$`, 'i').test(base)) return base
    return `${base}.${ext}`
  }

  const mimeFromExt = (ext = '') => {
    const e = (ext || '').toLowerCase()
    const map = {
      zip: 'application/zip',
      rar: 'application/vnd.rar',
      '7z': 'application/x-7z-compressed',
      tar: 'application/x-tar',
      gz: 'application/gzip',

      txt: 'text/plain',
      json: 'application/json',
      js: 'application/javascript',
      mjs: 'application/javascript',
      cjs: 'application/javascript',
      html: 'text/html',
      css: 'text/css',
      xml: 'application/xml',
      csv: 'text/csv',

      pdf: 'application/pdf',

      mp3: 'audio/mpeg',
      m4a: 'audio/mp4',
      wav: 'audio/wav',
      ogg: 'audio/ogg',
      flac: 'audio/flac',

      mp4: 'video/mp4',
      mkv: 'video/x-matroska',
      webm: 'video/webm',
      avi: 'video/x-msvideo',
      mov: 'video/quicktime',

      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      png: 'image/png',
      webp: 'image/webp',
      gif: 'image/gif'
    }
    return map[e] || 'application/octet-stream'
  }

  try {
    await conn.sendMessage(chatId, { react: { text: '🕒', key: m.key } })

    const { data } = await axios.get(api, {
      timeout: 60000,
      headers: { 'User-Agent': 'Mozilla/5.0' }
    })

    if (!data?.status) {
      return await conn.sendMessage(
        chatId,
        { text: `「✦」La API no devolvió resultado.\n\n\`\`\`\n${JSON.stringify(data, null, 2).slice(0, 3500)}\n\`\`\`` },
        { quoted: m }
      )
    }

    const item = Array.isArray(data?.result) ? data.result[0] : null
    if (!item?.link) {
      return await conn.sendMessage(
        chatId,
        { text: `「✦」No se encontró link de descarga.\n\n\`\`\`\n${JSON.stringify(data, null, 2).slice(0, 3500)}\n\`\`\`` },
        { quoted: m }
      )
    }

    const direct = item.link
    const size = item.size || 'Desconocido'
    const rawName = item.nama || item.name || 'archivo'
    const name = withExtension(rawName, direct)

    const ext = (name.split('.').pop() || '').toLowerCase()
    const mimetype = mimeFromExt(ext)

    const caption =
      `「✦」 *MediaFire Downloader*\n\n` +
      `> ✿ Nombre: *${name}*\n` +
      `> ✐ Tamaño: *${size}*\n` +
      `> ✦ Tipo: *${ext ? ext.toUpperCase() : 'DESCONOCIDO'}*\n\n` +
      `> ❑ API: *Adonix*`

    await conn.sendMessage(
      chatId,
      {
        document: { url: direct },
        fileName: name,
        mimetype,
        caption
      },
      { quoted: m }
    )

    await conn.sendMessage(chatId, { react: { text: '✔️', key: m.key } })
  } catch (e) {
    const err =
      e?.response?.data && typeof e.response.data === 'object'
        ? JSON.stringify(e.response.data, null, 2)
        : (e?.response?.data || e?.message || String(e)).toString()

    await conn.sendMessage(
      chatId,
      { text: `「✦」Error descargando MediaFire.\n\n\`\`\`\n${err.slice(0, 3500)}\n\`\`\`` },
      { quoted: m }
    )
  }
}

handler.help = ['mediafire <url>']
handler.tags = ['downloader']
handler.command = ['mediafire', 'mf']

export default handler