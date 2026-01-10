import Database from 'better-sqlite3'
import path from 'path'
import { fileURLToPath } from 'url'
import fs from 'fs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// 确保data目录存在
const dataDir = path.join(__dirname, 'data')
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true })
}

// 数据库文件路径
const dbPath = path.join(dataDir, 'database.sqlite')
export const db = new Database(dbPath)

// 启用外键约束
db.pragma('foreign_keys = ON')

export function initDatabase() {
  console.log('📦 初始化数据库...')
  console.log('📍 数据库位置:', dbPath)

  // 创建用户表（单用户模式仍保留，用于 Logo 等少量功能的外键引用）
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      email TEXT,
      role TEXT DEFAULT 'user' CHECK(role IN ('admin', 'user')),
      status TEXT DEFAULT 'active' CHECK(status IN ('active', 'inactive')),
      need_activation INTEGER DEFAULT 0,
      expires_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `)

  // 创建设备表
  db.exec(`
    CREATE TABLE IF NOT EXISTS devices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      imei TEXT UNIQUE NOT NULL,
      phone TEXT,
      iccid TEXT,
      signal INTEGER,
      operator TEXT,
      connected INTEGER DEFAULT 0,
      last_seen DATETIME,
      owner TEXT,
      FOREIGN KEY (owner) REFERENCES users(username) ON DELETE SET NULL
    )
  `)

  // 为已存在的设备表添加 created_at 字段（如果不存在）
  try {
    db.exec(`ALTER TABLE devices ADD COLUMN created_at DATETIME DEFAULT CURRENT_TIMESTAMP`)
    console.log('✅ 已为设备表添加 created_at 字段')
  } catch (e) {
    // 字段已存在，忽略错误
  }

  // 为已存在的设备表添加 mac 字段（如果不存在）
  try {
    db.exec(`ALTER TABLE devices ADD COLUMN mac TEXT`)
    console.log('✅ 已为设备表添加 mac 字段')
  } catch (e) {
    // 字段已存在，忽略错误
  }

  // 为已存在的设备表添加温度字段（如果不存在）
  try {
    db.exec(`ALTER TABLE devices ADD COLUMN temperature REAL`)
    console.log('✅ 已为设备表添加 temperature 字段')
  } catch (e) {
    // 字段已存在，忽略错误
  }

  // 为已存在的设备表添加电压字段（如果不存在）
  try {
    db.exec(`ALTER TABLE devices ADD COLUMN voltage REAL`)
    console.log('✅ 已为设备表添加 voltage 字段')
  } catch (e) {
    // 字段已存在，忽略错误
  }

  // 为已存在的设备表添加运行时长字段（秒）（如果不存在）
  try {
    db.exec(`ALTER TABLE devices ADD COLUMN runtime INTEGER`)
    console.log('✅ 已为设备表添加 runtime 字段')
  } catch (e) {
    // 字段已存在，忽略错误
  }

  // 为已存在的设备表添加系统版本字段（如果不存在）
  try {
    db.exec(`ALTER TABLE devices ADD COLUMN ver TEXT`)
    console.log('✅ 已为设备表添加 ver 字段')
  } catch (e) {
    // 字段已存在，忽略错误
  }

  // 为已存在的设备表添加 IP 地址字段（如果不存在）
  try {
    db.exec(`ALTER TABLE devices ADD COLUMN ip TEXT`)
    console.log('✅ 已为设备表添加 ip 字段')
  } catch (e) {
    // 字段已存在，忽略错误
  }

  // 清理多用户/激活码相关旧表（单用户模式不再使用）
  db.exec(`DROP TABLE IF EXISTS device_whitelist`)
  db.exec(`DROP TABLE IF EXISTS activation_usage`)
  db.exec(`DROP TABLE IF EXISTS activation_keys`)
  db.exec(`DROP TABLE IF EXISTS user_permissions`)

  // 创建录音记录表
  db.exec(`
    CREATE TABLE IF NOT EXISTS voice_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      imei TEXT NOT NULL,
      device_phone TEXT,
      caller_number TEXT,
      file_path TEXT NOT NULL,
      original_filename TEXT,
      file_size INTEGER,
      upload_time DATETIME,
      call_timestamp DATETIME,
      status TEXT DEFAULT 'uploaded' CHECK(status IN ('uploaded', 'transcribing', 'completed', 'failed')),
      transcribed_text TEXT,
      transcribe_started_at DATETIME,
      transcribe_completed_at DATETIME,
      expires_at DATETIME,  -- 过期时间，上传后7天
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (imei) REFERENCES devices(imei)
    )
  `)

  // 为已存在的表添加 expires_at 字段（如果不存在）
  try {
    db.exec(`ALTER TABLE voice_records ADD COLUMN expires_at DATETIME`)
    console.log('✅ 已为录音记录表添加 expires_at 字段')
  } catch (e) {
    // 字段已存在，忽略错误
  }

  // 单用户最小化版本不再使用 logo 配置表，清理历史遗留表
  db.exec(`DROP TABLE IF EXISTS logo_configs`)

  // 检查并创建默认管理员账号
  const defaultAdminUser = process.env.DEFAULT_ADMIN_USER
  const defaultAdminPassword = process.env.DEFAULT_ADMIN_PASSWORD

  if (defaultAdminUser && defaultAdminPassword) {
    try {
      // 检查用户是否已存在
      const user = db.prepare('SELECT * FROM users WHERE username = ?').get(defaultAdminUser)

      if (!user) {
        db.prepare(`
          INSERT INTO users (username, password, role, status, email)
          VALUES (?, ?, 'admin', 'active', 'admin@example.com')
        `).run(defaultAdminUser, defaultAdminPassword)
        console.log(`✅ 已创建默认管理员账号: ${defaultAdminUser}`)
      } else {
        console.log(`ℹ️ 默认管理员账号已存在: ${defaultAdminUser}`)
      }
    } catch (error) {
      console.error('❌ 创建默认管理员账号失败:', error)
    }
  }

  console.log('✅ 数据库初始化完成')
}
