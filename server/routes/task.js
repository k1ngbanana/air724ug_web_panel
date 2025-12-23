import { db } from '../database.js'
import { tokenUserMap } from '../index.js'
import { hasUserPermission } from '../permissions.js'

// 存储待处理的任务和响应
const pendingTasks = new Map()
const taskTimeouts = new Map()

export function setupTaskRoutes(app, deviceConnections) {
  // 执行设备任务
  app.post('/api/executeTask', (req, res) => {
    const token = req.headers.authorization?.replace('Bearer ', '')
    const username = tokenUserMap.get(token)
    
    if (!username) {
      return res.json({ success: false, message: '请先登录' })
    }
    
    const { imei, task, command, configText, rcv_phone, content, config } = req.body
    
    if (!imei) {
      return res.json({ success: false, message: '缺少设备IMEI' })
    }
    
    if (!task) {
      return res.json({ success: false, message: '缺少任务类型' })
    }
    
    console.log(`📋 收到任务请求: ${task} for ${imei}`)
    
    // 检查设备是否在线
    const deviceWs = deviceConnections.get(imei)
    if (!deviceWs || deviceWs.readyState !== 1) {
      console.log(`❌ 设备 ${imei} 不在线`)
      return res.json({ success: false, message: '设备不在线' })
    }
    
    // 生成任务ID
    const taskId = `${task}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    
    // 准备发送给设备的消息
    let deviceMessage = {
      type: 'task',
      taskId,
      task
    }
    
    // 根据任务类型添加参数
    // 权限检查
    const user = db.prepare('SELECT role FROM users WHERE username = ?').get(username)
    if (!user) {
      return res.status(401).json({ success: false, message: '用户不存在' })
    }
    
    // 检查短信读取权限
    if (task === 'read_sms' && !hasUserPermission(username, 'sms_read')) {
      return res.status(403).json({ 
        success: false, 
        message: '您没有短信读取权限，请联系管理员开通' 
      })
    }
    
    // 检查设备权限
    const device = db.prepare('SELECT * FROM devices WHERE imei = ?').get(imei)
    if (!device) {
      return res.json({ success: false, message: '设备不存在' })
    }
    
    if (user.role !== 'admin' && device.owner !== username) {
      return res.json({ success: false, message: '无权限操作此设备' })
    }
    
    // 单用户开放模式：不再使用设备白名单限制，任何已存在设备均可通过 Web 执行任务
    
    switch (task) {
      case 'at_cmd':
        if (!command) {
          return res.json({ success: false, message: '缺少AT命令' })
        }
        deviceMessage.command = command
        break
        
      case 'get_config':
        // 获取配置不需要额外参数
        break
        
      case 'set_config':
        if (!configText) {
          return res.json({ success: false, message: '缺少配置内容' })
        }
        deviceMessage.configText = configText
        break
        
      case 'send_sms':
        if (!rcv_phone || !content) {
          return res.json({ success: false, message: '缺少收件人或短信内容' })
        }
        deviceMessage.rcv_phone = rcv_phone
        deviceMessage.content = content
        break
        
      case 'read_sms':
        // 读取短信不需要额外参数
        break
        
      default:
        return res.json({ success: false, message: `未知的任务类型: ${task}` })
    }
    
    // 设置超时处理（30秒）
    const timeout = setTimeout(() => {
      if (pendingTasks.has(taskId)) {
        const { res: pendingRes, task: pendingTaskName, imei: pendingImei } = pendingTasks.get(taskId)
        pendingTasks.delete(taskId)
        taskTimeouts.delete(taskId)
        console.log(`⏰ 任务超时: ${taskId} (${pendingTaskName}) for ${pendingImei}`)
        try {
          pendingRes.json({ success: false, message: '任务超时，设备可能未响应' })
        } catch (e) {
          console.error('❌ 返回超时响应失败:', e)
        }
      }
    }, 30000)
    
    taskTimeouts.set(taskId, timeout)
    
    // 存储任务和响应对象
    pendingTasks.set(taskId, { res, task, imei })
    
    // 发送任务给设备
    try {
      deviceWs.send(JSON.stringify(deviceMessage))
      console.log(`✅ 任务已发送到设备: ${taskId}`)
    } catch (error) {
      console.error(`❌ 发送任务失败: ${error.message}`)
      clearTimeout(timeout)
      pendingTasks.delete(taskId)
      taskTimeouts.delete(taskId)
      return res.json({ success: false, message: '发送任务失败' })
    }
  })
  
  // 处理设备返回的任务结果
  return {
    handleTaskResponse: (message) => {
      console.log('📬 收到设备任务响应:', JSON.stringify(message, null, 2))
      console.log('📬 message.result 原始值:', message.result)
      console.log('📬 message.result 类型:', typeof message.result)
      
      const { taskId, success, result, error, data } = message
      console.log('📬 解构后 result:', result)
      console.log('📬 解构后 result 类型:', typeof result)
      
      if (!taskId) {
        console.log('⚠️ 收到任务响应但缺少taskId')
        console.log('完整消息:', message)
        return
      }
      
      const pendingTask = pendingTasks.get(taskId)
      if (!pendingTask) {
        console.log(`⚠️ 未找到待处理任务: ${taskId}`)
        console.log('当前待处理任务列表:', Array.from(pendingTasks.keys()))
        return
      }
      
      // 对于 at_cmd 任务，如果 result 为空或 undefined，先不处理，等待完整响应
      if (message.task === 'at_cmd' && (result === undefined || result === null || result === '')) {
        console.log('⏳ AT命令响应不完整，等待完整数据...')
        return
      }
      
      const { res, task, imei } = pendingTask
      
      // 清除超时
      const timeout = taskTimeouts.get(taskId)
      if (timeout) {
        clearTimeout(timeout)
        taskTimeouts.delete(taskId)
      }
      
      // 删除待处理任务
      pendingTasks.delete(taskId)
      
      // 返回结果（兼容多种响应格式）
      // 注意：result 可能是空字符串 ""，这也是有效结果
      // 特殊处理：lua 的 nil 可能被编码为字符串 "nil"
      let actualResult = result !== undefined && result !== null ? result : (data || '执行成功')
      
      // 如果结果是字符串 "nil" 或空字符串，显示提示信息
      if (actualResult === 'nil' || actualResult === '') {
        actualResult = 'AT命令执行完成，但设备未返回数据'
      }
      
      console.log('🔍 调试信息:')
      console.log('  - result:', result)
      console.log('  - data:', data)
      console.log('  - error:', error)
      console.log('  - actualResult:', actualResult)
      
      // 兼容两种格式：
      // 1. 有 success 字段的格式（新格式）
      // 2. 没有 success 字段，有 error 字段的格式（lua 格式）
      const isSuccess = success !== undefined ? success : !error
      
      if (isSuccess) {
        console.log(`✅ 任务完成: ${task} for ${imei}`)
        console.log(`📤 返回结果:`, actualResult)
        res.json({
          success: true,
          result: actualResult,
          message: '执行成功'
        })
      } else {
        console.log(`❌ 任务失败: ${task} for ${imei}, 错误: ${error}`)
        res.json({
          success: false,
          message: error || '执行失败'
        })
      }
    }
  }
}
