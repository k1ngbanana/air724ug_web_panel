import { db } from '../database.js'
import { tokenUserMap } from '../index.js'

export function setupDeviceRoutes(app) {
  // 获取设备列表
  app.get('/api/userPool', (req, res) => {
    console.log('========== 获取设备列表（单用户开放模式） ==========' )

    // 单用户模式：不区分管理员/普通用户，不做登录校验，直接返回所有设备
    const devices = db.prepare(`
      SELECT 
        d.*
      FROM devices d
      ORDER BY d.connected DESC, d.last_seen DESC
    `).all()

    const formattedDevices = devices.map(device => ({
      ...device,
      lastSeen: device.last_seen || null,
      createdAt: device.created_at || null,
      connected: Boolean(device.connected),
    }))

    console.log(`✅ 返回设备数量: ${formattedDevices.length} 个`)
    res.json(formattedDevices)
  })
  
  // 绑定设备
  app.post('/api/device/bind', (req, res) => {
    const { imei, phone } = req.body
    const token = req.headers.authorization?.replace('Bearer ', '')
    const username = tokenUserMap.get(token)
    
    if (!username) {
      return res.json({ code: 1, msg: '请先登录' })
    }
    
    if (!imei && !phone) {
      return res.json({ code: 1, msg: '请输入设备IMEI或手机号' })
    }
    
    let device
    if (imei) {
      // 通过IMEI查找设备
      device = db.prepare('SELECT * FROM devices WHERE imei = ?').get(imei)
    } else if (phone) {
      // 通过手机号查找设备
      device = db.prepare('SELECT * FROM devices WHERE phone = ?').get(phone)
    }
    
    if (!device) {
      return res.json({ code: 1, msg: '设备不存在或未连接' })
    }
    
    if (device.owner && device.owner !== '') {
      return res.json({ code: 1, msg: '设备已被其他用户绑定' })
    }
    
    // 绑定设备
    db.prepare('UPDATE devices SET owner = ? WHERE imei = ?').run(username, device.imei)
    
    console.log(`✅ 设备 ${device.imei} (手机号: ${device.phone || '无'}) 已绑定到用户 ${username}`)
    
    res.json({ code: 0, msg: '设备绑定成功', data: { imei: device.imei, phone: device.phone } })
  })
  
  // 解绑设备
  app.post('/api/device/unbind', (req, res) => {
    const { imei, phone } = req.body
    const token = req.headers.authorization?.replace('Bearer ', '')
    const username = tokenUserMap.get(token)
    
    if (!username) {
      return res.json({ code: 1, msg: '请先登录' })
    }
    
    if (!imei && !phone) {
      return res.json({ code: 1, msg: '请输入设备IMEI或手机号' })
    }
    
    // 查询当前用户角色
    const user = db.prepare('SELECT role FROM users WHERE username = ?').get(username)

    if (!user) {
      return res.json({ code: 1, msg: '用户不存在' })
    }

    let device

    if (user.role === 'admin') {
      // 管理员可以解绑任意设备（按 IMEI 或手机号），不限制 owner
      if (imei) {
        device = db.prepare('SELECT * FROM devices WHERE imei = ?').get(imei)
      } else if (phone) {
        device = db.prepare('SELECT * FROM devices WHERE phone = ?').get(phone)
      }

      if (!device) {
        return res.json({ code: 1, msg: '设备不存在' })
      }
    } else {
      // 普通用户只能解绑绑定到自己的设备
      if (imei) {
        device = db.prepare('SELECT * FROM devices WHERE imei = ? AND owner = ?').get(imei, username)
      } else if (phone) {
        device = db.prepare('SELECT * FROM devices WHERE phone = ? AND owner = ?').get(phone, username)
      }

      if (!device) {
        return res.json({ code: 1, msg: '设备不存在或未绑定到当前用户' })
      }
    }

    // 解绑设备：将 owner 置为 NULL（未绑定），避免违反外键约束
    db.prepare('UPDATE devices SET owner = NULL WHERE imei = ?').run(device.imei)
    
    console.log(`✅ 设备 ${device.imei} (手机号: ${device.phone || '无'}) 已从用户 ${username} 解绑`)
    
    res.json({ code: 0, msg: '设备解绑成功' })
  })
}
