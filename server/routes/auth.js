import { db } from '../database.js'
import { tokenUserMap } from '../index.js'

export function setupAuthRoutes(app) {
  // 用户登录
  app.post('/api/auth/login', (req, res) => {
    // 简化为单用户模式：任何账号密码都登录为 admin
    const username = 'admin'
    const role = 'admin'

    const token = `token-${username}-${role}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
    tokenUserMap.set(token, username)

    console.log(`✅ 单用户模式登录: ${username} (${role})`)

    res.json({
      code: 0,
      data: {
        token,
        userInfo: {
          username,
          role,
          email: null,
          uid: 1,
          needActivation: false,
          status: 'active',
          expiresAt: null
        }
      },
      msg: '登录成功（单用户模式）'
    })
  })
  
  // 用户注册
  app.post('/api/auth/register', (req, res) => {
    // 单用户模式下关闭注册功能
    res.json({ code: 1, msg: '当前为单用户模式，注册功能已关闭' })
  })
  
  // 激活账号
  app.post('/api/auth/activate', (req, res) => {
    // 单用户模式下关闭激活功能
    res.json({ code: 1, msg: '当前为单用户模式，激活功能已关闭' })
  })
  
  // 验证用户token状态
  app.get('/api/auth/verify', (req, res) => {
    const authHeader = req.headers.authorization
    let token = null
    
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7) // 移除 'Bearer ' 前缀
    } else if (req.headers.token) {
      token = req.headers.token
    }
    
    if (!token) {
      return res.json({ code: 1, msg: 'Token不存在' })
    }
    
    const username = tokenUserMap.get(token) || 'admin'

    res.json({
      code: 0,
      success: true,
      data: {
        userInfo: {
          username,
          role: 'admin',
          email: null,
          uid: 1,
          needActivation: false,
          status: 'active',
          expiresAt: null
        }
      },
      msg: 'Token有效（单用户模式）'
    })
  })
}
