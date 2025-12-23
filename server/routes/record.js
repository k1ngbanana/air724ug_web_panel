import express from 'express'
import multer from 'multer'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'
import { db } from '../database.js'
import { tokenUserMap } from '../index.js'
import { cleanupExpiredRecords, cleanupDeviceRecords, getExpiringRecords } from '../cleanup.js'
import { transcribeAudio, processPendingTranscriptions } from '../tencent-asr.js'
import { hasUserPermission } from '../permissions.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const router = express.Router()

// 确保上传目录存在
const uploadDir = path.join(__dirname, '../uploads/records')
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true })
}

// 配置multer存储
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    // 根据设备IMEI创建子目录
    const imei = req.headers['x-device-imei'] || 'unknown'
    const deviceDir = path.join(uploadDir, imei)
    if (!fs.existsSync(deviceDir)) {
      fs.mkdirSync(deviceDir, { recursive: true })
    }
    cb(null, deviceDir)
  },
  filename: (req, file, cb) => {
    // 生成唯一文件名：时间戳+随机数
    const timestamp = Date.now()
    const random = Math.random().toString(36).substring(2, 8)
    const ext = path.extname(file.originalname) || '.amr'
    cb(null, `${timestamp}_${random}${ext}`)
  }
})

const upload = multer({ 
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB限制
  }
})

// 录音上传接口
router.post('/record', upload.single('audio'), async (req, res) => {
  try {
    const { imei, phone, callerNumber, timestamp } = req.body
    const file = req.file

    if (!file) {
      return res.status(400).json({ 
        success: false, 
        message: '没有上传录音文件' 
      })
    }

    if (!imei) {
      return res.status(400).json({ 
        success: false, 
        message: '缺少设备IMEI信息' 
      })
    }

    // 验证设备是否存在
    const device = db.prepare('SELECT * FROM devices WHERE imei = ?').get(imei)
    if (!device) {
      return res.status(404).json({ 
        success: false, 
        message: '设备不存在' 
      })
    }

    // 保存录音记录到数据库
    const uploadTime = new Date().toISOString()
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString() // 7天后过期
    
    const result = db.prepare(`
      INSERT INTO voice_records (
        imei, device_phone, caller_number, file_path, 
        original_filename, file_size, upload_time, 
        call_timestamp, status, expires_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `).run(
      imei,
      phone || device.phone,
      callerNumber || 'unknown',
      file.path,
      file.originalname,
      file.size,
      uploadTime,
      timestamp || new Date().toISOString(),
      'uploaded',
      expiresAt
    )

    console.log(`🎵 设备 ${imei} 录音上传成功: ${file.originalname}`)

    res.json({
      success: true,
      message: '录音上传成功',
      data: {
        recordId: result.lastInsertRowid,
        fileName: file.filename,
        filePath: file.path,
        fileSize: file.size
      }
    })

  } catch (error) {
    console.error('录音上传失败:', error)
    res.status(500).json({
      success: false,
      message: '录音上传失败: ' + error.message
    })
  }
})

// 获取录音列表
router.get('/records', (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '')
  const username = tokenUserMap.get(token)

  if (!username) {
    return res.status(401).json({ 
      success: false, 
      message: '请先登录' 
    })
  }

  const user = db.prepare('SELECT role FROM users WHERE username = ?').get(username)
  if (!user) {
    return res.status(401).json({ 
      success: false, 
      message: '用户不存在' 
    })
  }

  // 检查语音转文字权限
  const hasVoicePermission = hasUserPermission(username, 'voice_transcribe')

  try {
    let records
    if (user.role === 'admin') {
      // 管理员可以看到所有录音
      records = db.prepare(`
        SELECT vr.*, d.owner as device_owner
        FROM voice_records vr
        LEFT JOIN devices d ON vr.imei = d.imei
        ORDER BY vr.created_at DESC
      `).all()
    } else {
      // 普通用户只能看到自己设备的录音
      records = db.prepare(`
        SELECT vr.*, d.owner as device_owner
        FROM voice_records vr
        LEFT JOIN devices d ON vr.imei = d.imei
        WHERE d.owner = ?
        ORDER BY vr.created_at DESC
      `).all(username)
    }

    // 如果用户没有语音转文字权限，隐藏转换结果
    if (!hasVoicePermission) {
      records = records.map(record => ({
        ...record,
        transcribed_text: null,
        status: record.status === 'completed' ? 'hidden' : record.status
      }))
    }

    res.json({
      success: true,
      data: records
    })

  } catch (error) {
    console.error('获取录音列表失败:', error)
    res.status(500).json({
      success: false,
      message: '获取录音列表失败'
    })
  }
})

// 语音转文字接口
router.post('/records/:recordId/transcribe', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '')
  const username = tokenUserMap.get(token)
  const { recordId } = req.params

  if (!username) {
    return res.status(401).json({ 
      success: false, 
      message: '请先登录' 
    })
  }

  // 检查语音转文字权限
  if (!hasUserPermission(username, 'voice_transcribe')) {
    return res.status(403).json({ 
      success: false, 
      message: '您没有语音转文字权限，请联系管理员开通' 
    })
  }

  try {
    // 获取录音记录
    const record = db.prepare(`
      SELECT vr.*, d.owner as device_owner
      FROM voice_records vr
      LEFT JOIN devices d ON vr.imei = d.imei
      WHERE vr.id = ?
    `).get(recordId)

    if (!record) {
      return res.status(404).json({ 
        success: false, 
        message: '录音记录不存在' 
      })
    }

    // 权限检查
    const user = db.prepare('SELECT role FROM users WHERE username = ?').get(username)
    if (user.role !== 'admin' && record.device_owner !== username) {
      return res.status(403).json({ 
        success: false, 
        message: '无权限访问此录音' 
      })
    }

    // 检查文件是否存在
    if (!fs.existsSync(record.file_path)) {
      return res.status(404).json({ 
        success: false, 
        message: '录音文件不存在' 
      })
    }

    // 更新状态为转换中
    db.prepare('UPDATE voice_records SET status = ?, transcribe_started_at = datetime(\'now\') WHERE id = ?')
      .run('transcribing', recordId)

    // 异步执行语音识别
    transcribeAudio(recordId).then(result => {
      console.log(`🎤 录音 ${recordId} 转换完成:`, result.success ? '成功' : '失败')
    }).catch(error => {
      console.error(`🎤 录音 ${recordId} 转换失败:`, error)
    })

    res.json({
      success: true,
      message: '语音转文字任务已开始',
      data: {
        recordId,
        status: 'transcribing'
      }
    })

  } catch (error) {
    console.error('语音转文字失败:', error)
    res.status(500).json({
      success: false,
      message: '语音转文字失败: ' + error.message
    })
  }
})

// 下载录音文件
router.get('/records/:recordId/download', (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '')
  const username = tokenUserMap.get(token)
  const { recordId } = req.params

  if (!username) {
    return res.status(401).json({ 
      success: false, 
      message: '请先登录' 
    })
  }

  try {
    const record = db.prepare(`
      SELECT vr.*, d.owner as device_owner
      FROM voice_records vr
      LEFT JOIN devices d ON vr.imei = d.imei
      WHERE vr.id = ?
    `).get(recordId)

    if (!record) {
      return res.status(404).json({ 
        success: false, 
        message: '录音记录不存在' 
      })
    }

    // 权限检查
    const user = db.prepare('SELECT role FROM users WHERE username = ?').get(username)
    if (user.role !== 'admin' && record.device_owner !== username) {
      return res.status(403).json({ 
        success: false, 
        message: '无权限下载此录音' 
      })
    }

    if (!fs.existsSync(record.file_path)) {
      return res.status(404).json({ 
        success: false, 
        message: '录音文件不存在' 
      })
    }

    // 设置下载响应头
    res.setHeader('Content-Disposition', `attachment; filename="${record.original_filename}"`)
    res.setHeader('Content-Type', 'audio/amr')

    // 发送文件
    res.sendFile(record.file_path)

  } catch (error) {
    console.error('下载录音失败:', error)
    res.status(500).json({
      success: false,
      message: '下载录音失败'
    })
  }
})

// 删除录音记录（管理员接口）
router.delete('/records/:recordId', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '')
  const username = tokenUserMap.get(token)
  const { recordId } = req.params

  if (!username) {
    return res.status(401).json({ 
      success: false, 
      message: '请先登录' 
    })
  }

  // 检查是否是管理员
  const user = db.prepare('SELECT role FROM users WHERE username = ?').get(username)
  if (user.role !== 'admin') {
    return res.status(403).json({ 
      success: false, 
      message: '只有管理员可以删除录音记录' 
    })
  }

  try {
    // 获取录音记录
    const record = db.prepare(`
      SELECT vr.*, d.owner as device_owner
      FROM voice_records vr
      LEFT JOIN devices d ON vr.imei = d.imei
      WHERE vr.id = ?
    `).get(recordId)

    if (!record) {
      return res.status(404).json({ 
        success: false, 
        message: '录音记录不存在' 
      })
    }

    // 删除录音文件
    if (fs.existsSync(record.file_path)) {
      try {
        fs.unlinkSync(record.file_path)
        console.log(`🗑️ 已删除录音文件: ${record.file_path}`)
      } catch (fileError) {
        console.error(`删除录音文件失败: ${record.file_path}`, fileError)
        // 文件删除失败不影响数据库记录删除
      }
    }

    // 删除数据库记录
    const result = db.prepare('DELETE FROM voice_records WHERE id = ?').run(recordId)
    
    if (result.changes > 0) {
      console.log(`🗑️ 管理员 ${username} 删除了录音记录: ${recordId}`)
      res.json({
        success: true,
        message: '录音记录已删除'
      })
    } else {
      res.status(404).json({
        success: false,
        message: '录音记录不存在'
      })
    }

  } catch (error) {
    console.error('删除录音记录失败:', error)
    res.status(500).json({
      success: false,
      message: '删除录音记录失败'
    })
  }
})

// 批量处理待转换的录音（管理员接口）
router.post('/transcribe/batch', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '')
  const username = tokenUserMap.get(token)
  const { limit = 5 } = req.body

  if (!username) {
    return res.status(401).json({ 
      success: false, 
      message: '请先登录' 
    })
  }

  // 只有管理员可以执行批量转换
  const user = db.prepare('SELECT role FROM users WHERE username = ?').get(username)
  if (user.role !== 'admin') {
    return res.status(403).json({ 
      success: false, 
      message: '无权限执行此操作' 
    })
  }

  try {
    const result = await processPendingTranscriptions(limit)
    
    res.json({
      success: true,
      message: `批量处理完成，处理了 ${result.processed} 个录音`,
      data: result
    })
  } catch (error) {
    console.error('批量转换失败:', error)
    res.status(500).json({
      success: false,
      message: '批量转换失败: ' + error.message
    })
  }
})

// 手动清理过期录音
router.post('/cleanup/expired', (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '')
  const username = tokenUserMap.get(token)

  if (!username) {
    return res.status(401).json({ 
      success: false, 
      message: '请先登录' 
    })
  }

  // 只有管理员可以执行清理操作
  const user = db.prepare('SELECT role FROM users WHERE username = ?').get(username)
  if (user.role !== 'admin') {
    return res.status(403).json({ 
      success: false, 
      message: '无权限执行此操作' 
    })
  }

  try {
    const result = cleanupExpiredRecords()
    res.json({
      success: true,
      message: '清理完成',
      data: result
    })
  } catch (error) {
    console.error('清理过期录音失败:', error)
    res.status(500).json({
      success: false,
      message: '清理失败: ' + error.message
    })
  }
})

// 清理指定设备的旧录音
router.post('/cleanup/device/:imei', (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '')
  const username = tokenUserMap.get(token)
  const { imei } = req.params
  const { olderThanDays = 7 } = req.body

  if (!username) {
    return res.status(401).json({ 
      success: false, 
      message: '请先登录' 
    })
  }

  // 只有管理员可以执行清理操作
  const user = db.prepare('SELECT role FROM users WHERE username = ?').get(username)
  if (user.role !== 'admin') {
    return res.status(403).json({ 
      success: false, 
      message: '无权限执行此操作' 
    })
  }

  try {
    const result = cleanupDeviceRecords(imei, olderThanDays)
    res.json({
      success: true,
      message: '设备录音清理完成',
      data: result
    })
  } catch (error) {
    console.error('清理设备录音失败:', error)
    res.status(500).json({
      success: false,
      message: '清理失败: ' + error.message
    })
  }
})

// 获取即将过期的录音统计
router.get('/expiring', (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '')
  const username = tokenUserMap.get(token)
  const { days = 1 } = req.query

  if (!username) {
    return res.status(401).json({ 
      success: false, 
      message: '请先登录' 
    })
  }

  const user = db.prepare('SELECT role FROM users WHERE username = ?').get(username)
  if (!user) {
    return res.status(401).json({ 
      success: false, 
      message: '用户不存在' 
    })
  }

  try {
    let expiringRecords
    if (user.role === 'admin') {
      // 管理员可以看到所有设备的即将过期录音
      expiringRecords = getExpiringRecords(parseInt(days))
    } else {
      // 普通用户只能看到自己设备的即将过期录音
      expiringRecords = getExpiringRecords(parseInt(days)).filter(record => {
        const device = db.prepare('SELECT owner FROM devices WHERE imei = ?').get(record.imei)
        return device && device.owner === username
      })
    }

    res.json({
      success: true,
      data: expiringRecords
    })
  } catch (error) {
    console.error('获取即将过期录音失败:', error)
    res.status(500).json({
      success: false,
      message: '获取统计失败'
    })
  }
})

// 设置录音路由
export function setupRecordRoutes(app) {
  console.log('🔧 注册录音路由到 /api')
  app.use('/api', router)
  // 同时支持直接访问 /record（兼容设备端）
  app.use('/record', router)
}
