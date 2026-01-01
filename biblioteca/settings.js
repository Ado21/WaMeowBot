import fs from 'fs'

const SETTINGS_PATH = './biblioteca/settings.json'

let _settingsCache = null
let _settingsCacheAt = 0
let _settingsCacheMtimeMs = 0

function getSettingsFileMtimeMs() {
  try {
    if (!fs.existsSync(SETTINGS_PATH)) return 0
    return fs.statSync(SETTINGS_PATH).mtimeMs || 0
  } catch {
    return 0
  }
}



const defaultSettings = {
  welcome: {},
  avisos: {},
  bot: {},
  antilink: {},
  strikes: {},
  welcomeMsg: {},
  byeMsg: {},
  prefix: '',
  bySubbot: {}
}

function loadSettings() {
  const now = Date.now()
  const mtime = getSettingsFileMtimeMs()

  if (_settingsCache && _settingsCacheMtimeMs === mtime && now - _settingsCacheAt < 1500) {
    return _settingsCache
  }

  if (!fs.existsSync(SETTINGS_PATH)) {
    const v = { ...defaultSettings }
    _settingsCache = v
    _settingsCacheAt = now
    _settingsCacheMtimeMs = mtime
    return v
  }

  try {
    const raw = fs.readFileSync(SETTINGS_PATH, 'utf-8')
    const data = JSON.parse(raw)
    const v = {
      welcome: data?.welcome || {},
      avisos: data?.avisos || {},
      bot: data?.bot || {},
      antilink: data?.antilink || {},
      strikes: data?.strikes || {},
      welcomeMsg: data?.welcomeMsg || {},
      byeMsg: data?.byeMsg || {},
      prefix: typeof data?.prefix === 'string' ? data.prefix : '',
      bySubbot: data?.bySubbot || {}
    }
    _settingsCache = v
    _settingsCacheAt = now
    _settingsCacheMtimeMs = mtime
    return v
  } catch (err) {
    console.error('[settings] No se pudieron cargar las configuraciones, usando valores por defecto.', err)
    const v = { ...defaultSettings }
    _settingsCache = v
    _settingsCacheAt = now
    _settingsCacheMtimeMs = mtime
    return v
  }
}

function saveSettings(settings) {
  try {
    fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2))
    _settingsCache = settings
    _settingsCacheAt = Date.now()
    _settingsCacheMtimeMs = getSettingsFileMtimeMs()
  } catch (err) {
    console.error('[settings] No se pudieron guardar las configuraciones.', err)
  }
}



function ensureSubbotBucket(settings, subbotId) {
  const id = String(subbotId || '').trim()
  if (!id) return null
  if (!settings.bySubbot) settings.bySubbot = {}
  
  if (!settings.bySubbot[id]) {
    settings.bySubbot[id] = {
      welcome: {},
      avisos: {},
      bot: {},
      antilink: {},
      strikes: {},
      welcomeMsg: {},
      byeMsg: {},
      prefix: ''
    }
  }
  if (!settings.bySubbot[id].welcome) settings.bySubbot[id].welcome = {}
  if (!settings.bySubbot[id].avisos) settings.bySubbot[id].avisos = {}
  if (!settings.bySubbot[id].bot) settings.bySubbot[id].bot = {}
  if (!settings.bySubbot[id].antilink) settings.bySubbot[id].antilink = {}
  if (!settings.bySubbot[id].strikes) settings.bySubbot[id].strikes = {}
  if (!settings.bySubbot[id].welcomeMsg) settings.bySubbot[id].welcomeMsg = {}
  if (!settings.bySubbot[id].byeMsg) settings.bySubbot[id].byeMsg = {}
  if (typeof settings.bySubbot[id].prefix !== 'string') settings.bySubbot[id].prefix = ''
  return settings.bySubbot[id]
}


function getWelcomeMessage(groupId, subbotId = '') {
  const settings = loadSettings()
  const gid = String(groupId || '')
  if (!gid) return ''

  const id = String(subbotId || '').trim()
  const bucket = id ? settings?.bySubbot?.[id] : null
  const store = bucket ? bucket.welcomeMsg : settings.welcomeMsg
  const v = store?.[gid]
  return typeof v === 'string' ? v : ''
}

function getByeMessage(groupId, subbotId = '') {
  const settings = loadSettings()
  const gid = String(groupId || '')
  if (!gid) return ''

  const id = String(subbotId || '').trim()
  const bucket = id ? settings?.bySubbot?.[id] : null
  const store = bucket ? bucket.byeMsg : settings.byeMsg
  const v = store?.[gid]
  return typeof v === 'string' ? v : ''
}

function setWelcomeMessage(groupId, text, subbotId = '') {
  const settings = loadSettings()
  const gid = String(groupId || '')
  if (!gid) return

  const t = typeof text === 'string' ? text.trim() : ''
  const bucket = ensureSubbotBucket(settings, subbotId)
  const store = bucket ? bucket.welcomeMsg : settings.welcomeMsg
  if (!t) {
    if (store && Object.prototype.hasOwnProperty.call(store, gid)) delete store[gid]
  } else {
    store[gid] = t.slice(0, 1500)
  }
  saveSettings(settings)
}

function setByeMessage(groupId, text, subbotId = '') {
  const settings = loadSettings()
  const gid = String(groupId || '')
  if (!gid) return

  const t = typeof text === 'string' ? text.trim() : ''
  const bucket = ensureSubbotBucket(settings, subbotId)
  const store = bucket ? bucket.byeMsg : settings.byeMsg
  if (!t) {
    if (store && Object.prototype.hasOwnProperty.call(store, gid)) delete store[gid]
  } else {
    store[gid] = t.slice(0, 1500)
  }
  saveSettings(settings)
}

function setCommandPrefix(prefix = '', subbotId = '') {
  const settings = loadSettings()
  const val = typeof prefix === 'string' ? prefix : ''
  const id = String(subbotId || '').trim()

  if (id) {
    const bucket = ensureSubbotBucket(settings, id)
    if (bucket) bucket.prefix = val
  } else {
    settings.prefix = val
  }

  saveSettings(settings)
  return true
}

function getCommandPrefix(subbotId = '') {
  const settings = loadSettings()
  const id = String(subbotId || '').trim()
  if (id) {
    const bucket = settings?.bySubbot?.[id]
    if (bucket && typeof bucket.prefix === 'string' && bucket.prefix.trim()) return bucket.prefix
  }
  if (typeof settings?.prefix === 'string' && settings.prefix.trim()) return settings.prefix
  return ''
}

function setBotEnabled(groupId, value, subbotId = '') {
  const settings = loadSettings()
  const gid = String(groupId || '')
  if (!gid) return

  const bucket = ensureSubbotBucket(settings, subbotId)
  if (bucket) bucket.bot[gid] = Boolean(value)
  else settings.bot[gid] = Boolean(value)

  saveSettings(settings)
}

function isBotEnabled(groupId, subbotId = '') {
  const settings = loadSettings()
  const gid = String(groupId || '')
  if (!gid) return true

  const id = String(subbotId || '').trim()
  const bucket = id ? settings?.bySubbot?.[id] : null
  if (bucket && Object.prototype.hasOwnProperty.call(bucket.bot || {}, gid)) {
    const flag = bucket.bot[gid]
    return flag !== false
  }

  const flag = settings.bot[gid]
  return flag !== false
}

function setAntilinkEnabled(groupId, value, subbotId = '') {
  const settings = loadSettings()
  const gid = String(groupId || '')
  if (!gid) return

  const bucket = ensureSubbotBucket(settings, subbotId)
  if (bucket) bucket.antilink[gid] = Boolean(value)
  else settings.antilink[gid] = Boolean(value)

  saveSettings(settings)
}

function isAntilinkEnabled(groupId, subbotId = '') {
  const settings = loadSettings()
  const gid = String(groupId || '')
  if (!gid) return false

  const id = String(subbotId || '').trim()
  const bucket = id ? settings?.bySubbot?.[id] : null
  if (bucket && Object.prototype.hasOwnProperty.call(bucket.antilink || {}, gid)) {
    const flag = bucket.antilink[gid]
    return flag === true
  }

  const flag = settings.antilink[gid]
  return flag === true
}

function bumpAntilinkStrike(groupId, userJid, subbotId = '') {
  const settings = loadSettings()
  const gid = String(groupId || '')
  const uid = String(userJid || '')
  if (!gid || !uid) return { count: 0 }

  const bucket = ensureSubbotBucket(settings, subbotId)
  const store = bucket ? bucket.strikes : (settings.strikes || (settings.strikes = {}))
  if (!store[gid]) store[gid] = {}
  const prev = store[gid][uid] || { count: 0, updatedAt: 0 }
  const next = { count: Number(prev.count || 0) + 1, updatedAt: Date.now() }
  store[gid][uid] = next
  saveSettings(settings)
  return next
}

function resetAntilinkStrike(groupId, userJid, subbotId = '') {
  const settings = loadSettings()
  const gid = String(groupId || '')
  const uid = String(userJid || '')
  if (!gid || !uid) return

  const id = String(subbotId || '').trim()
  const bucket = id ? settings?.bySubbot?.[id] : null
  const store = bucket ? bucket.strikes : settings.strikes
  if (store?.[gid]?.[uid]) {
    delete store[gid][uid]
    saveSettings(settings)
  }
}

function setWelcomeEnabled(groupId, value, subbotId = '') {
  const settings = loadSettings()
  const gid = String(groupId || '')
  if (!gid) return

  const bucket = ensureSubbotBucket(settings, subbotId)
  if (bucket) bucket.welcome[gid] = Boolean(value)
  else settings.welcome[gid] = Boolean(value)

  saveSettings(settings)
}

function setAvisosEnabled(groupId, value, subbotId = '') {
  const settings = loadSettings()
  const gid = String(groupId || '')
  if (!gid) return

  const bucket = ensureSubbotBucket(settings, subbotId)
  if (bucket) bucket.avisos[gid] = Boolean(value)
  else settings.avisos[gid] = Boolean(value)

  saveSettings(settings)
}

function isWelcomeEnabled(groupId, subbotId = '') {
  const settings = loadSettings()
  const gid = String(groupId || '')
  if (!gid) return true

  const id = String(subbotId || '').trim()
  const bucket = id ? settings?.bySubbot?.[id] : null
  if (bucket && Object.prototype.hasOwnProperty.call(bucket.welcome || {}, gid)) {
    const flag = bucket.welcome[gid]
    return flag !== false
  }

  const flag = settings.welcome[gid]
  return flag !== false
}

function isAvisosEnabled(groupId, subbotId = '') {
  const settings = loadSettings()
  const gid = String(groupId || '')
  if (!gid) return false

  const id = String(subbotId || '').trim()
  const bucket = id ? settings?.bySubbot?.[id] : null
  if (bucket && Object.prototype.hasOwnProperty.call(bucket.avisos || {}, gid)) {
    const flag = bucket.avisos[gid]
    return flag === true
  }

  const flag = settings.avisos[gid]
  return flag === true
}

export {
  setBotEnabled,
  isBotEnabled,
  setAntilinkEnabled,
  isAntilinkEnabled,
  bumpAntilinkStrike,
  resetAntilinkStrike,
  setWelcomeEnabled,
  setAvisosEnabled,
  isWelcomeEnabled,
  isAvisosEnabled,
  setCommandPrefix,
  setWelcomeMessage,
  getWelcomeMessage,
  setByeMessage,
  getByeMessage,
  getCommandPrefix
}
