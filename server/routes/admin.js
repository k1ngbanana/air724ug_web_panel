import { db } from '../database.js'
import { tokenUserMap } from '../index.js'

export function setupAdminRoutes(app) {
  // 临时接口：批量设置用户有效期
  app.post('/api/admin/fix-user-expires', (req, res) => {
    const token = req.headers.authorization?.replace('Bearer ', '')
    const username = tokenUserMap.get(token)
    const user = db.prepare('SELECT role FROM users WHERE username = ?').get(username)
    
    if (user?.role !== 'admin') {
      return res.json({ code: 1, msg: '无权限' })
    }
    
    try {
      // 获取所有激活码的有效期
      const keys = db.prepare('SELECT code, expires_at FROM activation_keys WHERE status = "active"').all()
      console.log('📋 激活码列表:', keys)
      
      // 为所有没有有效期的用户设置有效期（使用第一个有效期不为空的激活码）
      const keyWithExpires = keys.find(k => k.expires_at)
      
      if (keyWithExpires) {
        const result = db.prepare(`
          UPDATE users 
          SET expires_at = ? 
          WHERE expires_at IS NULL AND role = 'user'
        `).run(keyWithExpires.expires_at)
        
        console.log(`✅ 已为 ${result.changes} 个用户设置有效期: ${keyWithExpires.expires_at}`)
        
        res.json({ 
          code: 0, 
          success: true, 
          msg: `已为 ${result.changes} 个用户设置有效期`,
          data: {
            updatedCount: result.changes,
            expiresAt: keyWithExpires.expires_at
          }
        })
      } else {
        // 如果没有激活码有有效期，设置为1年后
        const oneYearLater = new Date()
        oneYearLater.setFullYear(oneYearLater.getFullYear() + 1)
        const expiresAt = oneYearLater.toISOString().slice(0, 19).replace('T', ' ')
        
        const result = db.prepare(`
          UPDATE users 
          SET expires_at = ? 
          WHERE expires_at IS NULL AND role = 'user'
        `).run(expiresAt)
        
        console.log(`✅ 已为 ${result.changes} 个用户设置有效期: ${expiresAt}`)
        
        res.json({ 
          code: 0, 
          success: true, 
          msg: `已为 ${result.changes} 个用户设置有效期（1年后）`,
          data: {
            updatedCount: result.changes,
            expiresAt: expiresAt
          }
        })
      }
    } catch (error) {
      console.error('❌ 设置用户有效期失败:', error)
      res.json({ code: 1, success: false, msg: error.message })
    }
  })
  
  // 获取用户列表（管理员）
  app.get('/api/admin/users', (req, res) => {
    console.log('📥 收到获取用户列表请求')
    const token = req.headers.authorization?.replace('Bearer ', '')
    console.log('🔑 Token:', token ? '存在' : '不存在')
    const username = tokenUserMap.get(token)
    console.log('👤 用户名:', username)
    
    const user = db.prepare('SELECT role FROM users WHERE username = ?').get(username)
    console.log('👤 用户角色:', user?.role)
    
    if (user?.role !== 'admin') {
      console.log('❌ 无权限')
      return res.json({ code: 1, msg: '无权限' })
    }
    
    const users = db.prepare(`
      SELECT 
        u.id, 
        u.username, 
        u.email, 
        u.role, 
        u.status, 
        u.need_activation, 
        u.created_at,
        u.expires_at,
        CASE WHEN EXISTS (
          SELECT 1 FROM activation_usage au WHERE au.username = u.username
        ) THEN 1 ELSE 0 END AS has_activation
      FROM users u
      WHERE u.role != 'admin'
      ORDER BY u.created_at DESC
    `).all()
    
    console.log(`✅ 获取用户列表: ${users.length} 个用户`)
    console.log('📋 原始数据:', JSON.stringify(users, null, 2))
    
    const result = {
      code: 0,
      success: true,
      data: users.map(u => ({
        id: u.id,
        username: u.username,
        email: u.email,
        role: u.role,
        status: u.status,
        needActivation: u.need_activation === 1,
        createdAt: u.created_at,
        expiresAt: u.expires_at,
        hasActivation: u.has_activation === 1
      })),
      msg: '获取成功'
    }
    
    console.log('📤 返回数据:', JSON.stringify(result, null, 2))
    res.json(result)
  })
  
  // 获取激活码列表（管理员）
  app.get('/api/admin/activation-keys', (req, res) => {
    const token = req.headers.authorization?.replace('Bearer ', '')
    const username = tokenUserMap.get(token)
    
    const user = db.prepare('SELECT role FROM users WHERE username = ?').get(username)
    
    if (user?.role !== 'admin') {
      return res.json({ code: 1, msg: '无权限' })
    }
    
    const keys = db.prepare(`
      SELECT * FROM activation_keys
      ORDER BY created_at DESC
    `).all()
    
    console.log(`✅ 获取激活码列表: ${keys.length} 个`)
    
    res.json({
      code: 0,
      success: true,
      data: keys.map(k => ({
        _id: k.id.toString(),
        code: k.code,
        description: k.description,
        createdAt: k.created_at,
        expiresAt: k.expires_at,
        status: k.status,
        maxUses: k.max_uses,
        usedCount: k.used_count
      })),
      msg: '获取成功'
    })
  })
  
  // 创建激活码（管理员）
  app.post('/api/admin/activation-keys', (req, res) => {
    const token = req.headers.authorization?.replace('Bearer ', '')
    const username = tokenUserMap.get(token)
    
    const user = db.prepare('SELECT role FROM users WHERE username = ?').get(username)
    
    if (user?.role !== 'admin') {
      return res.json({ code: 1, success: false, msg: '无权限' })
    }
    
    let { code, description, maxUses, expiresAt, expiresIn } = req.body
    
    // 如果没有提供code，自动生成
    if (!code) {
      const timestamp = Date.now().toString(36).toUpperCase()
      const random = Math.random().toString(36).substring(2, 6).toUpperCase()
      code = `KEY-${timestamp}-${random}`
    }
    
    // 如果提供了expiresIn（天数），转换为expiresAt
    if (expiresIn && !expiresAt) {
      const expireDate = new Date()
      expireDate.setDate(expireDate.getDate() + parseInt(expiresIn))
      expiresAt = expireDate.toISOString().slice(0, 19).replace('T', ' ')
    }
    
    try {
      const result = db.prepare(`
        INSERT INTO activation_keys (code, description, max_uses, expires_at)
        VALUES (?, ?, ?, ?)
      `).run(code, description || null, maxUses || 1, expiresAt || null)
      
      console.log(`✅ 创建激活码: ${code}`)
      
      res.json({
        code: 0,
        success: true,
        data: { 
          _id: result.lastInsertRowid.toString(),
          code: code  // 返回生成的激活码
        },
        msg: '创建成功'
      })
    } catch (error) {
      console.error('创建激活码失败:', error)
      if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
        res.json({ code: 1, success: false, msg: '激活码已存在' })
      } else {
        res.json({ code: 1, success: false, msg: '创建失败: ' + error.message })
      }
    }
  })
  
  // 删除激活码（管理员）
  app.delete('/api/admin/activation-keys/:keyId', (req, res) => {
    const token = req.headers.authorization?.replace('Bearer ', '')
    const username = tokenUserMap.get(token)
    
    const user = db.prepare('SELECT role FROM users WHERE username = ?').get(username)
    
    if (user?.role !== 'admin') {
      return res.json({ code: 1, success: false, msg: '无权限' })
    }
    
    const { keyId } = req.params
    
    try {
      db.prepare('DELETE FROM activation_keys WHERE id = ?').run(keyId)
      
      console.log(`✅ 管理员删除激活码ID: ${keyId}`)
      
      res.json({
        code: 0,
        success: true,
        msg: '删除成功'
      })
    } catch (error) {
      res.json({ code: 1, success: false, msg: '删除失败' })
    }
  })
  
  // 更新激活码状态（管理员）
  app.patch('/api/admin/activation-keys/:keyId/status', (req, res) => {
    const token = req.headers.authorization?.replace('Bearer ', '')
    const username = tokenUserMap.get(token)
    
    const user = db.prepare('SELECT role FROM users WHERE username = ?').get(username)
    
    if (user?.role !== 'admin') {
      return res.json({ code: 1, success: false, msg: '无权限' })
    }
    
    const { keyId } = req.params
    const { status } = req.body
    
    try {
      db.prepare('UPDATE activation_keys SET status = ? WHERE id = ?').run(status, keyId)
      
      console.log(`✅ 管理员更新激活码状态: ${keyId} -> ${status}`)
      
      res.json({
        code: 0,
        success: true,
        msg: '更新成功'
      })
    } catch (error) {
      res.json({ code: 1, success: false, msg: '更新失败' })
    }
  })
  
  // 设备白名单列表（管理员）
  app.get('/api/admin/device-whitelist', (req, res) => {
    const token = req.headers.authorization?.replace('Bearer ', '')
    const username = tokenUserMap.get(token)
    const user = db.prepare('SELECT role FROM users WHERE username = ?').get(username)
    if (user?.role !== 'admin') {
      return res.json({ code: 1, success: false, msg: '无权限' })
    }
    try {
      const rows = db.prepare(`
        SELECT id, imei, mac, remark, created_by, created_at
        FROM device_whitelist
        ORDER BY created_at DESC
      `).all()
      res.json({
        code: 0,
        success: true,
        data: rows,
        msg: '获取成功'
      })
    } catch (error) {
      res.json({ code: 1, success: false, msg: '获取失败' })
    }
  })
  
  // 添加设备白名单（管理员，按 IMEI 管理，不再要求 MAC）
  app.post('/api/admin/device-whitelist', (req, res) => {
    const token = req.headers.authorization?.replace('Bearer ', '')
    const username = tokenUserMap.get(token)
    const user = db.prepare('SELECT role FROM users WHERE username = ?').get(username)
    if (user?.role !== 'admin') {
      return res.json({ code: 1, success: false, msg: '无权限' })
    }
    let { imei, remark } = req.body
    if (!imei) {
      return res.json({ code: 1, success: false, msg: '缺少IMEI' })
    }
    imei = String(imei).trim()
    if (!/^\d{14,16}$/.test(imei)) {
      return res.json({ code: 1, success: false, msg: 'IMEI格式不正确' })
    }

    // 使用占位 MAC，白名单仅按 IMEI 管理
    const mac = '000000000000'
    try {
      const result = db.prepare(`
        INSERT INTO device_whitelist (imei, mac, remark, created_by)
        VALUES (?, ?, ?, ?)
      `).run(imei, mac, remark || null, username)
      res.json({
        code: 0,
        success: true,
        data: { id: result.lastInsertRowid },
        msg: '添加成功'
      })
    } catch (error) {
      if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
        return res.json({ code: 1, success: false, msg: '该设备已在白名单中' })
      }
      res.json({ code: 1, success: false, msg: '添加失败' })
    }
  })
  
  // 删除设备白名单（管理员）
  app.delete('/api/admin/device-whitelist/:id', (req, res) => {
    const token = req.headers.authorization?.replace('Bearer ', '')
    const username = tokenUserMap.get(token)
    const user = db.prepare('SELECT role FROM users WHERE username = ?').get(username)
    if (user?.role !== 'admin') {
      return res.json({ code: 1, success: false, msg: '无权限' })
    }
    const { id } = req.params
    try {
      const result = db.prepare('DELETE FROM device_whitelist WHERE id = ?').run(id)
      if (result.changes === 0) {
        return res.json({ code: 1, success: false, msg: '记录不存在' })
      }
      res.json({ code: 0, success: true, msg: '删除成功' })
    } catch (error) {
      res.json({ code: 1, success: false, msg: '删除失败' })
    }
  })

  // 按 IMEI 添加设备到白名单（管理员，MAC 可选占位，适配从设备列表勾选场景）
  app.post('/api/admin/device-whitelist/by-imei', (req, res) => {
    const token = req.headers.authorization?.replace('Bearer ', '')
    const username = tokenUserMap.get(token)
    const user = db.prepare('SELECT role FROM users WHERE username = ?').get(username)
    if (user?.role !== 'admin') {
      return res.json({ code: 1, success: false, msg: '无权限' })
    }

    let { imei, remark } = req.body
    if (!imei) {
      return res.json({ code: 1, success: false, msg: '缺少IMEI' })
    }
    imei = String(imei).trim()
    if (!/^\d{14,16}$/.test(imei)) {
      return res.json({ code: 1, success: false, msg: 'IMEI格式不正确' })
    }

    // 统一使用占位 MAC，白名单仅按 IMEI 管理
    const mac = '000000000000'

    try {
      const result = db.prepare(`
        INSERT OR IGNORE INTO device_whitelist (imei, mac, remark, created_by)
        VALUES (?, ?, ?, ?)
      `).run(imei, mac, remark || null, username)
      if (result.changes === 0) {
        return res.json({ code: 0, success: true, msg: '已在白名单中' })
      }
      res.json({ code: 0, success: true, msg: '添加成功' })
    } catch (error) {
      res.json({ code: 1, success: false, msg: '添加失败' })
    }
  })

  // 按 IMEI 从白名单移除（管理员）
  app.delete('/api/admin/device-whitelist/by-imei/:imei', (req, res) => {
    const token = req.headers.authorization?.replace('Bearer ', '')
    const username = tokenUserMap.get(token)
    const user = db.prepare('SELECT role FROM users WHERE username = ?').get(username)
    if (user?.role !== 'admin') {
      return res.json({ code: 1, success: false, msg: '无权限' })
    }

    const imei = String(req.params.imei || '').trim()
    if (!/^\d{14,16}$/.test(imei)) {
      return res.json({ code: 1, success: false, msg: 'IMEI格式不正确' })
    }

    try {
      const result = db.prepare('DELETE FROM device_whitelist WHERE imei = ?').run(imei)
      if (result.changes === 0) {
        return res.json({ code: 0, success: true, msg: '原本不在白名单中' })
      }
      res.json({ code: 0, success: true, msg: '已从白名单移除' })
    } catch (error) {
      res.json({ code: 1, success: false, msg: '移除失败' })
    }
  })
  
  // 添加用户（管理员）
  app.post('/api/admin/users', (req, res) => {
    const token = req.headers.authorization?.replace('Bearer ', '')
    const username = tokenUserMap.get(token)
    
    const user = db.prepare('SELECT role FROM users WHERE username = ?').get(username)
    
    if (user?.role !== 'admin') {
      return res.json({ code: 1, success: false, msg: '无权限' })
    }
    
    const { username: newUsername, password, email, role } = req.body
    
    if (!newUsername || !password) {
      return res.json({ code: 1, success: false, msg: '用户名和密码不能为空' })
    }
    
    try {
      db.prepare(`
        INSERT INTO users (username, password, email, role, status)
        VALUES (?, ?, ?, ?, 'active')
      `).run(newUsername, password, email || null, role || 'user')
      
      console.log(`✅ 管理员创建用户: ${newUsername}`)
      
      res.json({
        code: 0,
        success: true,
        msg: '添加用户成功'
      })
    } catch (error) {
      if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
        res.json({ code: 1, success: false, msg: '用户名已存在' })
      } else {
        res.json({ code: 1, success: false, msg: '添加失败' })
      }
    }
  })
  
  // 删除用户（管理员）
  app.delete('/api/admin/users/:userId', (req, res) => {
    console.log('🗑️ 收到删除用户请求')
    const token = req.headers.authorization?.replace('Bearer ', '')
    const username = tokenUserMap.get(token)
    console.log('👤 操作用户:', username)
    
    const user = db.prepare('SELECT role FROM users WHERE username = ?').get(username)
    console.log('👤 用户角色:', user?.role)
    
    if (user?.role !== 'admin') {
      console.log('❌ 无权限')
      return res.json({ code: 1, success: false, msg: '无权限' })
    }
    
    const { userId } = req.params
    console.log('🗑️ 要删除的用户ID:', userId, '类型:', typeof userId)
    
    try {
      // 先获取用户名（因为外键引用的是username）
      const userToDelete = db.prepare('SELECT username FROM users WHERE id = ?').get(userId)
      if (!userToDelete) {
        return res.json({ code: 1, success: false, msg: '用户不存在', message: '用户不存在' })
      }
      console.log('🗑️ 要删除的用户名:', userToDelete.username)
      
      // 开始事务
      db.prepare('BEGIN').run()
      
      try {
        // 1. 删除激活码使用记录（引用username）
        try {
          const result1 = db.prepare('DELETE FROM activation_usage WHERE username = ?').run(userToDelete.username)
          console.log('🗑️ 已删除激活码使用记录:', result1.changes, '条')
        } catch (e) {
          console.log('ℹ️ 删除激活码使用记录失败:', e.message)
        }
        
        // 2. 更新设备的owner为NULL（引用username，已设置ON DELETE SET NULL）
        try {
          const result2 = db.prepare('UPDATE devices SET owner = NULL WHERE owner = ?').run(userToDelete.username)
          console.log('🗑️ 已清除设备关联:', result2.changes, '个设备')
        } catch (e) {
          console.log('ℹ️ 清除设备关联失败:', e.message)
        }
        
        // 3. 删除用户
        const result = db.prepare('DELETE FROM users WHERE id = ?').run(userId)
        console.log('🗑️ 删除用户结果:', result)
        
        // 提交事务
        db.prepare('COMMIT').run()
        
        console.log(`✅ 管理员删除用户ID: ${userId}`)
        
        const response = {
          code: 0,
          success: true,
          msg: '删除成功',
          message: '删除成功'
        }
        console.log('📤 返回响应:', response)
        res.json(response)
      } catch (error) {
        // 回滚事务
        db.prepare('ROLLBACK').run()
        throw error
      }
    } catch (error) {
      console.error('❌ 删除用户错误:', error)
      res.json({ 
        code: 1, 
        success: false, 
        msg: '删除失败', 
        message: error.code === 'SQLITE_CONSTRAINT_FOREIGNKEY' 
          ? '该用户有关联数据，无法删除' 
          : error.message 
      })
    }
  })
  
  // 更新用户状态（管理员）
  app.patch('/api/admin/users/:userId/status', (req, res) => {
    const token = req.headers.authorization?.replace('Bearer ', '')
    const username = tokenUserMap.get(token)
    
    const user = db.prepare('SELECT role FROM users WHERE username = ?').get(username)
    
    if (user?.role !== 'admin') {
      return res.json({ code: 1, success: false, msg: '无权限' })
    }
    
    const { userId } = req.params
    const { status } = req.body
    
    try {
      db.prepare('UPDATE users SET status = ? WHERE id = ?').run(status, userId)
      
      console.log(`✅ 管理员更新用户状态: ${userId} -> ${status}`)
      
      res.json({
        code: 0,
        success: true,
        msg: '更新成功'
      })
    } catch (error) {
      res.json({ code: 1, success: false, msg: '更新失败' })
    }
  })
  
  // 更新账号信息
  app.post('/api/admin/account/update', (req, res) => {
    const { currentPassword, newPassword, email } = req.body
    const token = req.headers.authorization?.replace('Bearer ', '')
    const username = tokenUserMap.get(token)
    
    if (!username) {
      return res.json({ success: false, message: '请先登录' })
    }
    
    // 如果要修改密码，验证当前密码
    if (newPassword) {
      if (!currentPassword) {
        return res.json({ success: false, message: '请输入当前密码' })
      }
      
      const user = db.prepare('SELECT id FROM users WHERE username = ? AND password = ?').get(username, currentPassword)
      
      if (!user) {
        return res.json({ success: false, message: '当前密码错误' })
      }
      
      db.prepare('UPDATE users SET password = ? WHERE username = ?').run(newPassword, username)
      console.log(`✅ 用户 ${username} 密码已更新`)
    }
    
    // 更新邮箱
    if (email !== undefined) {
      db.prepare('UPDATE users SET email = ? WHERE username = ?').run(email, username)
      console.log(`✅ 用户 ${username} 邮箱已更新为: ${email}`)
    }
    
    res.json({
      success: true,
      data: { email },
      message: '保存成功'
    })
  })
}
