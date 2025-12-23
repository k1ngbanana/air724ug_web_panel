import fs from 'fs'
import { db } from './database.js'

// 清理过期录音文件
export function cleanupExpiredRecords() {
  console.log('🧹 开始清理过期录音文件...')
  
  try {
    // 查找所有过期的录音记录
    const expiredRecords = db.prepare(`
      SELECT id, imei, file_path, original_filename 
      FROM voice_records 
      WHERE expires_at IS NOT NULL 
      AND datetime(expires_at) < datetime('now')
    `).all()
    
    if (expiredRecords.length === 0) {
      console.log('✅ 没有需要清理的过期录音')
      return { deletedCount: 0, deletedFiles: [] }
    }
    
    console.log(`📁 发现 ${expiredRecords.length} 个过期录音记录`)
    
    let deletedCount = 0
    const deletedFiles = []
    const errors = []
    
    for (const record of expiredRecords) {
      try {
        // 删除物理文件
        if (fs.existsSync(record.file_path)) {
          fs.unlinkSync(record.file_path)
          deletedFiles.push(record.file_path)
          console.log(`🗑️ 已删除文件: ${record.file_path}`)
        }
        
        // 从数据库删除记录
        const result = db.prepare('DELETE FROM voice_records WHERE id = ?').run(record.id)
        if (result.changes > 0) {
          deletedCount++
          console.log(`📋 已删除记录: ID=${record.id}, IMEI=${record.imei}, 文件=${record.original_filename}`)
        }
        
      } catch (error) {
        console.error(`❌ 删除录音失败: ID=${record.id}, 错误:`, error.message)
        errors.push({ recordId: record.id, error: error.message })
      }
    }
    
    console.log(`✅ 清理完成: 删除了 ${deletedCount} 个录音记录`)
    
    if (errors.length > 0) {
      console.warn(`⚠️ 清理过程中发生 ${errors.length} 个错误`)
    }
    
    return {
      deletedCount,
      deletedFiles,
      errors,
      totalFound: expiredRecords.length
    }
    
  } catch (error) {
    console.error('❌ 清理过期录音失败:', error)
    throw error
  }
}

// 手动清理指定设备的录音
export function cleanupDeviceRecords(imei, olderThanDays = 7) {
  console.log(`🧹 开始清理设备 ${imei} 的录音文件...`)
  
  try {
    const cutoffDate = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000).toISOString()
    
    // 查找指定设备的旧录音
    const oldRecords = db.prepare(`
      SELECT id, file_path, original_filename, upload_time 
      FROM voice_records 
      WHERE imei = ? 
      AND datetime(upload_time) < datetime(?)
    `).all(imei, cutoffDate)
    
    if (oldRecords.length === 0) {
      console.log(`✅ 设备 ${imei} 没有需要清理的录音`)
      return { deletedCount: 0, deletedFiles: [] }
    }
    
    console.log(`📁 设备 ${imei} 发现 ${oldRecords.length} 个旧录音记录`)
    
    let deletedCount = 0
    const deletedFiles = []
    
    for (const record of oldRecords) {
      try {
        // 删除物理文件
        if (fs.existsSync(record.file_path)) {
          fs.unlinkSync(record.file_path)
          deletedFiles.push(record.file_path)
          console.log(`🗑️ 已删除文件: ${record.file_path}`)
        }
        
        // 从数据库删除记录
        const result = db.prepare('DELETE FROM voice_records WHERE id = ?').run(record.id)
        if (result.changes > 0) {
          deletedCount++
        }
        
      } catch (error) {
        console.error(`❌ 删除录音失败: ID=${record.id}, 错误:`, error.message)
      }
    }
    
    console.log(`✅ 设备 ${imei} 清理完成: 删除了 ${deletedCount} 个录音记录`)
    
    return {
      deletedCount,
      deletedFiles,
      totalFound: oldRecords.length
    }
    
  } catch (error) {
    console.error(`❌ 清理设备 ${imei} 录音失败:`, error)
    throw error
  }
}

// 获取即将过期的录音统计
export function getExpiringRecords(days = 1) {
  const futureDate = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString()
  
  const expiringRecords = db.prepare(`
    SELECT 
      imei,
      COUNT(*) as count,
      MIN(datetime(expires_at)) as earliest_expires,
      MAX(datetime(expires_at)) as latest_expires
    FROM voice_records 
    WHERE datetime(expires_at) < datetime(?)
    AND datetime(expires_at) > datetime('now')
    GROUP BY imei
    ORDER BY earliest_expires ASC
  `).all(futureDate)
  
  return expiringRecords
}

// 启动定时清理任务
export function startCleanupScheduler(intervalMinutes = 60) {
  console.log(`⏰ 启动录音清理任务，每 ${intervalMinutes} 分钟执行一次`)
  
  // 立即执行一次清理
  cleanupExpiredRecords()
  
  // 设置定时器
  const intervalId = setInterval(() => {
    try {
      cleanupExpiredRecords()
    } catch (error) {
      console.error('定时清理任务执行失败:', error)
    }
  }, intervalMinutes * 60 * 1000)
  
  return intervalId
}
