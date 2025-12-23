import { defineMock } from 'vite-plugin-mock-dev-server'
// import { userService } from '../../server/services/userService'
// import { deviceService } from '../../server/services/deviceService'
// import { activationService } from '../../server/services/activationService'

// 用于存储token和用户名的映射（模拟JWT解析）
const tokenUserMap: Record<string, string> = {}

// Mock 已禁用 - 使用真实后端服务器
export default defineMock([
  /*
  // 用户登录
  {
    url: '/api/auth/login',
    delay: 500,
    body: ({ body }) => {
      const { username, password } = body
      
      const result = userService.login(username, password)
      
      if (!result.success) {
        return { code: 1, msg: result.message }
      }
      
      const user = result.user!
      const token = `mock-${user.role}-token-${Date.now()}`
      
      // 保存token和用户名的映射
      tokenUserMap[token] = username
      console.log('✅ 用户登录:', username, 'Role:', user.role)
      
      return {
        code: 0,
        data: {
          token,
          userInfo: {
            username: user.username,
            role: user.role,
            email: user.email,
            uid: user.id
          }
        },
        msg: '登录成功'
      }
    }
  },

  // 用户注册
  {
    url: '/api/auth/register',
    delay: 500,
    body: ({ body }) => {
      const { username, password, email, activationCode } = body
      
      if (!username || !password) {
        return { code: 1, msg: '用户名和密码不能为空' }
      }
      
      // 验证激活码
      if (activationCode) {
        const validation = activationService.validateKey(activationCode)
        if (!validation.valid) {
          return { code: 1, msg: validation.message }
        }
      }
      
      // 注册用户
      const needActivation = !activationCode
      const result = userService.register(username, password, email, needActivation)
      
      if (!result.success) {
        return { code: 1, msg: result.message }
      }
      
      // 如果有激活码，使用它
      if (activationCode) {
        activationService.useKey(activationCode, username)
      }
      
      console.log('✅ 用户注册成功:', username)
      
      return {
        code: 0,
        data: { needActivation },
        msg: needActivation ? '注册成功，请联系管理员激活账号' : '注册成功'
      }
    }
  },

  // 激活账号
  {
    url: '/api/auth/activate',
    delay: 500,
    body: ({ body }) => {
      const { username, activationCode } = body
      
      if (!userService.userExists(username)) {
        return { code: 1, msg: '用户不存在' }
      }
      
      const result = activationService.useKey(activationCode, username)
      if (!result.success) {
        return { code: 1, msg: result.message }
      }
      
      userService.activateUser(username)
      
      console.log('✅ 账号激活成功:', username)
      
      return { code: 0, msg: '激活成功，请登录' }
    }
  },

  // 获取设备列表
  {
    url: '/api/userPool',
    delay: 300,
    body: ({ headers }) => {
      const token = headers?.authorization?.replace('Bearer ', '') || ''
      
      console.log('========== 获取设备列表 ==========')
      console.log('Token:', token.substring(0, 30) + '...')
      
      let currentUser = tokenUserMap[token] || ''
      let isAdmin = false
      
      // Token恢复机制
      if (!currentUser && token) {
        if (token.includes('admin-token')) {
          currentUser = 'admin'
          isAdmin = true
          tokenUserMap[token] = 'admin'
          console.log('⚠️ 从token恢复管理员身份')
        } else if (token.includes('user-token')) {
          console.log('⚠️ 无法从token恢复用户身份，请重新登录')
          return []
        }
      } else {
        isAdmin = currentUser === 'admin'
      }
      
      console.log('当前用户:', currentUser, '是否管理员:', isAdmin)
      
      if (isAdmin) {
        const devices = deviceService.getAllDevices()
        console.log('✅ 管理员可以看到所有设备:', devices.length, '个')
        return devices
      }
      
      const devices = deviceService.getUserDevices(currentUser)
      console.log(`👤 用户 ${currentUser} 的设备数量:`, devices.length, '个')
      return devices
    }
  },

  // 绑定设备
  {
    url: '/api/device/bind',
    method: 'POST',
    delay: 500,
    body: ({ body, headers }) => {
      const { imei } = body
      const token = headers?.authorization?.replace('Bearer ', '') || ''
      
      if (!imei) {
        return { code: 1, msg: '请输入设备IMEI' }
      }
      
      const currentUser = tokenUserMap[token] || ''
      if (!currentUser) {
        return { code: 1, msg: '请先登录' }
      }
      
      const result = deviceService.bindDevice(imei, currentUser)
      
      if (!result.success) {
        return { code: 1, msg: result.message }
      }
      
      console.log(`✅ 设备 ${imei} 已绑定到用户 ${currentUser}`)
      return { code: 0, msg: result.message }
    }
  },

  // 解绑设备
  {
    url: '/api/device/unbind',
    method: 'POST',
    delay: 500,
    body: ({ body, headers }) => {
      const { imei } = body
      const token = headers?.authorization?.replace('Bearer ', '') || ''
      
      if (!imei) {
        return { code: 1, msg: '请输入设备IMEI' }
      }
      
      const currentUser = tokenUserMap[token] || ''
      if (!currentUser) {
        return { code: 1, msg: '请先登录' }
      }
      
      const result = deviceService.unbindDevice(imei, currentUser)
      
      if (!result.success) {
        return { code: 1, msg: result.message }
      }
      
      console.log(`✅ 设备 ${imei} 已从用户 ${currentUser} 解绑`)
      return { code: 0, msg: result.message }
    }
  },

  // 获取用户列表（管理员）
  {
    url: '/api/admin/users',
    delay: 300,
    body: ({ headers }) => {
      const token = headers?.authorization?.replace('Bearer ', '') || ''
      const currentUser = tokenUserMap[token] || ''
      
      if (currentUser !== 'admin') {
        return { code: 1, msg: '无权限' }
      }
      
      const users = userService.getAllUsers()
      console.log('✅ 获取用户列表:', users.length, '个用户')
      
      return users.map(user => ({
        username: user.username,
        email: user.email,
        role: user.role,
        status: user.status,
        needActivation: user.need_activation === 1,
        createdAt: user.created_at
      }))
    }
  },

  // 获取激活码列表（管理员）
  {
    url: '/api/admin/activation-keys',
    method: 'GET',
    delay: 300,
    body: ({ headers }) => {
      const token = headers?.authorization?.replace('Bearer ', '') || ''
      const currentUser = tokenUserMap[token] || ''
      
      if (currentUser !== 'admin') {
        return { code: 1, msg: '无权限' }
      }
      
      const keys = activationService.getAllKeys()
      console.log('✅ 获取激活码列表:', keys.length, '个')
      
      return keys.map(key => ({
        _id: key.id.toString(),
        code: key.code,
        description: key.description,
        createdAt: key.created_at,
        expiresAt: key.expires_at,
        status: key.status,
        maxUses: key.max_uses,
        usedCount: key.used_count
      }))
    }
  },

  // 创建激活码（管理员）
  {
    url: '/api/admin/activation-keys',
    method: 'POST',
    delay: 500,
    body: ({ body, headers }) => {
      const token = headers?.authorization?.replace('Bearer ', '') || ''
      const currentUser = tokenUserMap[token] || ''
      
      if (currentUser !== 'admin') {
        return { code: 1, msg: '无权限' }
      }
      
      const { code, description, maxUses, expiresAt } = body
      
      if (!code) {
        return { code: 1, msg: '激活码不能为空' }
      }
      
      const result = activationService.createKey({
        code,
        description,
        maxUses,
        expiresAt
      })
      
      if (!result.success) {
        return { code: 1, msg: result.message }
      }
      
      console.log('✅ 创建激活码:', code)
      
      return {
        code: 0,
        data: { _id: result.keyId?.toString() },
        msg: '创建成功'
      }
    }
  },

  // 更新账号信息
  {
    url: '/api/admin/account/update',
    method: 'POST',
    delay: 500,
    body: ({ body, headers }) => {
      const { currentPassword, newPassword, email } = body
      const token = headers?.authorization?.replace('Bearer ', '') || ''
      const currentUser = tokenUserMap[token] || ''
      
      if (!currentUser) {
        return { success: false, message: '请先登录' }
      }
      
      const result = userService.updateUser(currentUser, {
        currentPassword,
        newPassword,
        email
      })
      
      if (!result.success) {
        return { success: false, message: result.message }
      }
      
      console.log(`✅ 用户 ${currentUser} 更新账号信息`)
      
      return {
        success: true,
        data: { email },
        message: result.message
      }
    }
  }
  */
])
