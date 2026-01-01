import yts from 'yt-search'
import axios from 'axios'

const MAX_SECONDS = 90 * 60

function getVideoId(url = '') {
  const m =
    url.match(/v=([a-zA-Z0-9_-]{6,})/) ||
    url.match(/youtu\.be\/([a-zA-Z0-9_-]{6,})/) ||
    url.match(/shorts\/([a-zA-Z0-9_-]{6,})/)
  return m?.[1]
}

function parseDurationToSeconds(d) {
  if (d == null) return null
  if (typeof d === 'number' && Number.isFinite(d)) return Math.max(0, Math.floor(d))
  const s = String(d).trim()
  if (!s) return null
  if (/^\d+$/.test(s)) return Math.max(0, parseInt(s, 10))

  const parts = s
    .split(':')
    .map((x) => x.trim())
    .filter(Boolean)
  if (!parts.length || parts.some((p) => !/^\d+$/.test(p))) return null

  let sec = 0
  for (const p of parts) sec = sec * 60 + parseInt(p, 10)
  return Number.isFinite(sec) ? sec : null
}

function secondsToHms(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return 'Desconocida'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}

function formatErr(err, maxLen = 1400) {
  const e = err ?? 'Error desconocido'
  let msg =
    e instanceof Error
      ? e.stack || `${e.name}: ${e.message}`
      : typeof e === 'string'
        ? e
        : JSON.stringify(e, null, 2)

  msg = String(msg || 'Error desconocido').trim()
  if (msg.length > maxLen) msg = msg.slice(0, maxLen) + '\n... (recortado)'
  return msg
}

function assertApiKey() {
  const key = globalThis?.apikey
  if (!key || typeof key !== 'string') throw new Error('Falta globalThis.apikey')
  return key.trim()
}

async function fetchYtVideoFromApi(ytUrl) {
  const apikey = assertApiKey()
  const endpoint = `https://api-adonix.ultraplus.click/download/ytvideo?apikey=${encodeURIComponent(apikey)}&url=${encodeURIComponent(ytUrl)}`

  const { data } = await axios.get(endpoint, {
    timeout: 900000,
    headers: { Accept: 'application/json' },
    validateStatus: () => true
  })

  if (!data || typeof data !== 'object') throw new Error('Respuesta inválida de la API (no JSON)')
  if (data.status !== true) {
    const msg = data?.message || data?.error || 'La API devolvió status=false'
    throw new Error(String(msg))
  }

  const title = data?.data?.title
  const url = data?.data?.url
  if (!title || !url) throw new Error('Respuesta incompleta: falta data.title o data.url')

  return { title: String(title), url: String(url), raw: data }
}

let handler = async (m, { conn, text }) => {
  const from = m?.chat || m?.key?.remoteJid
  if (!from) return

  if (!text) {
    return conn.sendMessage(
      from,
      { text: '「✦」Escribe el nombre o link del video.\n> ✐ Ejemplo » *.play2 lovely*' },
      { quoted: m }
    )
  }

  await conn.sendMessage(from, { react: { text: '🕒', key: m.key } }).catch(() => {})

  let ytUrl = text.trim()
  const isLink = /youtu\.be|youtube\.com/i.test(ytUrl)

  if (!isLink) {
    try {
      const search = await yts(ytUrl)
      const first = search?.videos?.[0]
      if (!first) {
        return conn.sendMessage(
          from,
          { text: '「✦」No se encontraron resultados.\n> ✐ Intenta con otro título.' },
          { quoted: m }
        )
      }
      ytUrl = first.url
    } catch (err) {
      console.error('[play2] Error yt-search:', err)
      return conn.sendMessage(
        from,
        { text: `「✦」Error buscando en YouTube.\n\n> 🧩 Error:\n\`\`\`\n${formatErr(err)}\n\`\`\`` },
        { quoted: m }
      )
    }
  }

  let meta = null
  try {
    const search = await yts(ytUrl)
    const first = search?.videos?.[0] || null
    if (first) {
      meta = {
        title: first.title || 'Video',
        author: first.author?.name || 'Desconocido',
        durationSec: parseDurationToSeconds(first.seconds ?? first.timestamp),
        durationText: first.timestamp || 'Desconocida',
        thumb: first.thumbnail || null,
        url: first.url || ytUrl
      }
    } else {
      meta = {
        title: 'Video',
        author: 'Desconocido',
        durationSec: null,
        durationText: 'Desconocida',
        thumb: null,
        url: ytUrl
      }
    }
  } catch (errMeta) {
    console.error('[play2] Error meta yt-search:', errMeta)
    meta = {
      title: 'Video',
      author: 'Desconocido',
      durationSec: null,
      durationText: 'Desconocida',
      thumb: null,
      url: ytUrl
    }
  }

  const title = meta?.title || 'Video'
  const author = meta?.author || 'Desconocido'
  const durationText = meta?.durationText || 'Desconocida'
  const durationSec = meta?.durationSec

  const vid = getVideoId(meta?.url || ytUrl)
  const thumb = meta?.thumb || (vid ? `https://i.ytimg.com/vi/${vid}/hqdefault.jpg` : null)

  const overLimit = Number.isFinite(durationSec) ? durationSec > MAX_SECONDS : false

  const caption =
    `「✦」Enviando *${title}*\n\n` +
    `> ❀ Canal » *${author}*\n` +
    `> ⴵ Duración » *${durationText}*\n` +
    `> 🜸 Link » ${meta?.url || ytUrl}\n` +
    (overLimit ? `\n> ⚠️ *Pasa de 1h 30m, se enviará como documento.*` : '')

  try {
    if (thumb) {
      await conn.sendMessage(from, { image: { url: thumb }, caption }, { quoted: m })
    } else {
      await conn.sendMessage(from, { text: caption }, { quoted: m })
    }
  } catch (errPrev) {
    console.error('[play2] Error preview:', errPrev)
  }

  try {
    const apiResp = await fetchYtVideoFromApi(meta?.url || ytUrl)

    const fileName = `${String(apiResp.title || title)
      .replace(/[\\/:*?"<>|]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 180)}.mp4`

    if (overLimit) {
      await conn.sendMessage(
        from,
        {
          document: { url: apiResp.url },
          mimetype: 'video/mp4',
          fileName
        },
        { quoted: m }
      )
    } else {
      await conn.sendMessage(
        from,
        {
          video: { url: apiResp.url },
          mimetype: 'video/mp4',
          fileName
        },
        { quoted: m }
      )
    }

    await conn.sendMessage(from, { react: { text: '✔️', key: m.key } }).catch(() => {})
  } catch (errSend) {
    console.error('[play2] Error api/envío:', errSend)
    await conn.sendMessage(
      from,
      { text: `「✦」Ocurrió un error al enviar el video.\n\n> 🧩 Error:\n\`\`\`\n${formatErr(errSend)}\n\`\`\`` },
      { quoted: m }
    )
  }
}

handler.help = ['play2 <texto|link>']
handler.tags = ['multimedia']
handler.command = ['play2']

export default handler