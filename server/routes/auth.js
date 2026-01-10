import { db } from '../database.js'
import { tokenUserMap } from '../index.js'

export function setupAuthRoutes(app) {
  // 用户登录
  app.post('/api/auth/login', (req, res) => {
    const { username, password } = req.body || {}

    if (!username || !password) {
      return res.json({ code: 1, success: false, msg: '用户名和密码不能为空' })
    }

    try {
      const users = db.prepare(`
            SELECT id, username, password, email, role, status, need_activation AS needActivation, expires_at AS expiresAt
        FROM users`).all()
      // console.log(users)

      // 从 users 表中查询用户
      const user = db.prepare(`
        SELECT id, username, password, email, role, status, need_activation AS needActivation, expires_at AS expiresAt
        FROM users
        WHERE username = ?
      `).get(username)

      // 用户不存在或密码不匹配
      if (!user || user.password !== password) {
        return res.json({ code: 1, success: false, msg: '用户名或密码错误' })
      }

      // 登录成功，生成 token
      const role = user.role || 'user'
      const token = `token-${user.username}-${role}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
      tokenUserMap.set(token, user.username)

      console.log(`✅ 用户登录成功: ${user.username} (${role})`)

      res.json({
        code: 0,
        success: true,
        data: {
          token,
          userInfo: {
            username: user.username,
            role,
            email: user.email,
            uid: user.id,
            needActivation: !!user.needActivation,
            status: user.status,
            expiresAt: user.expiresAt,
          },
        },
        msg: '登录成功',
      })
    } catch (error) {
      console.error('用户登录失败:', error)
      res.json({ code: 1, success: false, msg: '登录失败，请稍后重试' })
    }
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
