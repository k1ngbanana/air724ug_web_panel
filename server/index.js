import express from 'express'
import { WebSocketServer } from 'ws'
import path from 'path'
import { fileURLToPath } from 'url'
import dotenv from 'dotenv'
import { initDatabase, db } from './database.js'
import { setupAuthRoutes } from './routes/auth.js'
import { setupDeviceRoutes } from './routes/device.js'
import { setupTaskRoutes } from './routes/task.js'
import { setupRecordRoutes } from './routes/record.js'
import { setupAdminRoutes } from './routes/admin.js'
import { startCleanupScheduler } from './cleanup.js'

// 加载环境变量
dotenv.config()

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const app = express()
const PORT = process.env.PORT || 9527

// 中间件
app.use(express.json())
app.use(express.urlencoded({ extended: true }))

// 初始化数据库
initDatabase()

// Token映射（简单实现，生产环境建议使用JWT）
export const tokenUserMap = new Map()

// 存储设备连接
const deviceConnections = new Map()

// 设置API路由（必须在静态文件之前）
setupAuthRoutes(app)
setupDeviceRoutes(app)
// 任务路由（下发指令等）
const { handleTaskResponse } = setupTaskRoutes(app, deviceConnections)
// 录音相关路由
setupRecordRoutes(app)
// 管理员相关路由（账号管理、激活码等）
setupAdminRoutes(app)

// 静态文件服务（前端构建后的文件）
app.use(express.static(path.join(__dirname, 'public')))

// SPA路由支持（放在最后，处理所有未匹配的路由）
app.get('*', (req, res, next) => {
  // 如果是API请求但没有匹配到路由，返回404
  if (req.path.startsWith('/api')) {
    return res.status(404).json({ code: 1, msg: 'API not found' })
  }
  // 其他请求返回index.html（SPA）
  res.sendFile(path.join(__dirname, 'public', 'index.html'))
})

// 启动HTTP服务器
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log('╔════════════════════════════════════════════╗')
  console.log('║   Air724UG Web Panel Server Started       ║')
  console.log('╠════════════════════════════════════════════╣')
  console.log(`║ 🚀 HTTP Server: http://localhost:${PORT}     ║`)
  console.log(`║ 🔌 WebSocket: ws://localhost:${PORT}/websocket ║`)
  console.log(`║ 💾 Database: ./data/database.sqlite       ║`)
  console.log('╠════════════════════════════════════════════╣')
  console.log('║ 默认管理员账号: admin / admin123          ║')
  console.log('╚════════════════════════════════════════════╝')
})

// 启动录音清理任务（每小时执行一次）
startCleanupScheduler(60)

// WebSocket服务器（用于设备连接）
const wss = new WebSocketServer({
  server,
  path: '/api/websocket'
})

// 定期心跳超时检查：每 30 秒检查一次 last_seen，超过 HEARTBEAT_TIMEOUT 秒无心跳就标记离线
const HEARTBEAT_TIMEOUT = 150 // 150秒无心跳则标记为离线（与 jam/server(1).js 保持一致级别）
setInterval(() => {
  try {
    // 查找超时的在线设备
    const timeoutDevices = db.prepare(`
      SELECT imei FROM devices 
      WHERE connected = 1 
      AND datetime(last_seen, '+${HEARTBEAT_TIMEOUT} seconds') < datetime('now')
    `).all()

    if (timeoutDevices.length > 0) {
      console.log(`⏰ 检测到 ${timeoutDevices.length} 个设备心跳超时，标记为离线`)

      // 批量更新为离线状态，并记录离线时间
      const stmt = db.prepare(`
        UPDATE devices 
        SET connected = 0, last_seen = datetime('now')
        WHERE imei = ?
      `)

      timeoutDevices.forEach(device => {
        stmt.run(device.imei)
        console.log(`  📴 设备 ${device.imei} 已标记为离线`)
      })
    }
  } catch (error) {
    console.error('❌ 心跳超时检查错误:', error)
  }
}, 30000) // 每30秒检查一次

wss.on('connection', (ws, req) => {
  const clientIp = req.socket.remoteAddress
  console.log(`📱 新设备连接: ${clientIp}`)

  let deviceImei = null

  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data.toString())
      console.log('📨 收到消息:', message)

      // 处理设备注册和上线（兼容 'register' 和 'online' 两种类型）
      if (message.type === 'register' || message.type === 'online') {
        deviceImei = message.imei
        const { phone, iccid, signal, operator, mac, temperature, voltage } = message

        console.log(`📝 处理设备${message.type === 'online' ? '上线' : '注册'}: ${deviceImei}`)

        // 检查设备是否已存在
        const existingDevice = db.prepare('SELECT * FROM devices WHERE imei = ?').get(deviceImei)

        if (existingDevice) {
          // 更新设备状态
          db.prepare(`
            UPDATE devices 
            SET connected = 1,
                last_seen = datetime('now'),
                phone = ?,
                iccid = ?,
                signal = ?,
                operator = ?,
                mac = COALESCE(?, mac),
                temperature = COALESCE(?, temperature),
                voltage = COALESCE(?, voltage)
            WHERE imei = ?
          `).run(
            phone || existingDevice.phone,
            iccid || existingDevice.iccid,
            signal || existingDevice.signal,
            operator || existingDevice.operator,
            mac || existingDevice.mac || null,
            temperature || existingDevice.temperature,
            voltage || existingDevice.voltage,
            deviceImei,
          )
          console.log(`✅ 设备已更新: ${deviceImei} (手机号: ${phone || existingDevice.phone})`)
        } else {
          // 添加新设备
          db.prepare(`
            INSERT INTO devices (imei, phone, iccid, signal, operator, mac, temperature, voltage, connected, last_seen)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, datetime('now'))
          `).run(deviceImei, phone, iccid, signal, operator, mac || null, temperature || null, voltage || null)
          console.log(`✅ 新设备已注册: ${deviceImei} (手机号: ${phone})`)
        }

        deviceConnections.set(deviceImei, ws)

        ws.send(JSON.stringify({
          type: message.type === 'online' ? 'online_success' : 'register_success',
          message: message.type === 'online' ? '上线成功' : '注册成功'
        }))
      }

      // 兼容处理设备状态上报（device_status），同样视为“在线/心跳”
      if (message.type === 'device_status') {
        // 优先使用消息中的 imei，若当前会话已绑定 deviceImei，则复用
        const imei = message.imei || deviceImei
        if (!imei) {
          console.warn('device_status 消息缺少 imei，忽略:', message)
        } else {
          deviceImei = imei

          // 兼容不同字段名：oper/rsrp/vbatt 等
          const {
            phone,
            iccid,
            signal,
            operator,
            oper,
            mac,
            temperature,
            voltage,
            ver,
            uptime,
            rsrp,
            vbatt,
          } = message

          const existingDevice = db.prepare('SELECT * FROM devices WHERE imei = ?').get(deviceImei)

          // 解析信号强度：优先使用 signal，其次从 rsrp 字符串中提取数值（如 "-96 dB" -> -96）
          let parsedSignal = signal
          if (parsedSignal == null && typeof rsrp === 'string') {
            const m = rsrp.match(/-?\d+/)
            if (m) {
              parsedSignal = parseInt(m[0], 10)
            }
          }

          // 解析电压：优先使用数值 voltage，其次从字符串 voltage/vbatt 中提取浮点数（如 "3.944 V" -> 3.944）
          let parsedVoltage = voltage
          const voltageSource = typeof voltage === 'string' ? voltage : (typeof vbatt === 'string' ? vbatt : null)
          if (parsedVoltage == null && voltageSource) {
            const m = voltageSource.match(/\d+(?:\.\d+)?/)
            if (m) {
              parsedVoltage = parseFloat(m[0])
            }
          }

          // 解析温度：字符串 "18.23 ℃" -> 18.23
          let parsedTemperature = temperature
          if (typeof parsedTemperature === 'string') {
            const m = parsedTemperature.match(/-?\d+(?:\.\d+)?/)
            if (m) {
              parsedTemperature = parseFloat(m[0])
            }
          }

          // 运营商：兼容 oper 字段
          const finalOperator = operator || oper || (existingDevice && existingDevice.operator) || null

          // 解析运行时长：uptime 形如 "HH:MM:SS"，转为总秒数存入 runtime
          let parsedRuntime = null
          if (typeof uptime === 'string') {
            const parts = uptime.split(':').map(p => parseInt(p, 10))
            if (parts.length === 3 && parts.every(n => !Number.isNaN(n))) {
              const [h, m, s] = parts
              parsedRuntime = h * 3600 + m * 60 + s
            }
          }

          if (existingDevice) {
            db.prepare(`
              UPDATE devices 
              SET connected = 1,
                  last_seen = datetime('now'),
                  phone = COALESCE(?, phone),
                  iccid = COALESCE(?, iccid),
                  signal = COALESCE(?, signal),
                  operator = COALESCE(?, operator),
                  mac = COALESCE(?, mac),
                  temperature = COALESCE(?, temperature),
                  voltage = COALESCE(?, voltage),
                  runtime = COALESCE(?, runtime),
                  ver = COALESCE(?, ver),
                  ip = COALESCE(?, ip)
              WHERE imei = ?
            `).run(
              phone || null,
              iccid || null,
              parsedSignal != null ? parsedSignal : existingDevice.signal,
              finalOperator,
              mac || existingDevice.mac || null,
              parsedTemperature != null ? parsedTemperature : existingDevice.temperature,
              parsedVoltage != null ? parsedVoltage : existingDevice.voltage,
              parsedRuntime != null ? parsedRuntime : existingDevice.runtime,
              ver || existingDevice.ver || null,
              clientIp || existingDevice.ip || null,
              deviceImei,
            )
            console.log(`✅ device_status 更新设备: ${deviceImei} (手机号: ${phone || existingDevice.phone || '未知'}, ver: ${ver || '未知'}, uptime: ${uptime || '未知'})`)
          } else {
            db.prepare(`
              INSERT INTO devices (imei, phone, iccid, signal, operator, mac, temperature, voltage, runtime, ver, ip, connected, last_seen)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, datetime('now'))
            `).run(
              deviceImei,
              phone || null,
              iccid || null,
              parsedSignal != null ? parsedSignal : null,
              finalOperator,
              mac || null,
              parsedTemperature != null ? parsedTemperature : null,
              parsedVoltage != null ? parsedVoltage : null,
              parsedRuntime != null ? parsedRuntime : null,
              ver || null,
              clientIp || null,
            )
            console.log(`✅ device_status 新设备已注册: ${deviceImei} (手机号: ${phone || '未知'}, ver: ${ver || '未知'}, uptime: ${uptime || '未知'})`)
          }

          deviceConnections.set(deviceImei, ws)
        }
      }

      // 处理设备心跳
      if (message.type === 'heartbeat') {
        db.prepare(`
          UPDATE devices 
          SET last_seen = datetime('now'), signal = ?, connected = 1
          WHERE imei = ?
        `).run(message.signal || null, deviceImei)

        ws.send(JSON.stringify({
          type: 'heartbeat_ack'
        }))
      }

      // 处理设备数据上报
      if (message.type === 'data') {
        console.log(`📊 设备 ${deviceImei} 数据:`, message.data)
        // 这里可以存储设备数据到数据库
      }

      // 处理任务响应（兼容 task_response 和 task_result 两种类型）
      if (message.type === 'task_response' || message.type === 'task_result') {
        console.log(`📬 收到任务响应: ${message.taskId}`)
        handleTaskResponse(message)
      }

    } catch (error) {
      console.error('❌ 消息处理错误:', error)
    }
  })

  ws.on('close', () => {
    if (deviceImei) {
      console.log(`📴 设备断开: ${deviceImei}`)
      deviceConnections.delete(deviceImei)

      // 更新设备离线状态
      db.prepare(`
        UPDATE devices 
        SET connected = 0, last_seen = datetime('now')
        WHERE imei = ?
      `).run(deviceImei)
    }
  })

  ws.on('error', (error) => {
    console.error('❌ WebSocket错误:', error)
  })
})

// 优雅关闭
process.on('SIGINT', () => {
  console.log('\n正在关闭服务器...')
  wss.close(() => {
    server.close(() => {
      db.close()
      console.log('服务器已关闭')
      process.exit(0)
    })
  })
})
