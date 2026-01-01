import fs from 'fs'
import path from 'path'

const DB_PATH = path.resolve('./webpanel/db/users.json')

function ensureDb() {
  const dir = path.dirname(DB_PATH)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  if (!fs.existsSync(DB_PATH)) {
    fs.writeFileSync(DB_PATH, JSON.stringify({ users: [] }, null, 2))
  }
}

function readDb() {
  ensureDb()
  try {
    const raw = fs.readFileSync(DB_PATH, 'utf8')
    const json = JSON.parse(raw)
    if (!json || typeof json !== 'object') return { users: [] }
    if (!Array.isArray(json.users)) json.users = []
    return json
  } catch {
    return { users: [] }
  }
}

function writeDb(db) {
  ensureDb()
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2))
}

function findUserByUsername(username) {
  const db = readDb()
  const u = String(username || '').trim().toLowerCase()
  return db.users.find((x) => (x.username || '').toLowerCase() === u) || null
}

function findUserById(id) {
  const db = readDb()
  return db.users.find((x) => x.id === id) || null
}

function createUser(user) {
  const db = readDb()
  db.users.push(user)
  writeDb(db)
  return user
}

export {
  DB_PATH,
  readDb,
  writeDb,
  findUserByUsername,
  findUserById,
  createUser
}
