// 腾讯云语音识别API完整集成
import dotenv from 'dotenv'
import tencentcloud from 'tencentcloud-sdk-nodejs'
import fs from 'fs'
import path from 'path'

// 加载环境变量
dotenv.config()

// 腾讯云配置
const TENCENT_CONFIG = {
  secretId: process.env.TENCENT_SECRET_ID,
  secretKey: process.env.TENCENT_SECRET_KEY,
  region: process.env.TENCENT_REGION || 'ap-beijing'
}

// 初始化腾讯云ASR客户端
function initTencentASRClient() {
  if (!TENCENT_CONFIG.secretId || !TENCENT_CONFIG.secretKey) {
    throw new Error('腾讯云API密钥未配置')
  }

  const AsrClient = tencentcloud.default.asr.v20190614.Client
  const clientConfig = {
    credential: {
      secretId: TENCENT_CONFIG.secretId,
      secretKey: TENCENT_CONFIG.secretKey,
    },
    region: TENCENT_CONFIG.region,
    profile: {
      httpProfile: {
        endpoint: 'asr.tencentcloudapi.com',
      },
    },
  }
  
  return new AsrClient(clientConfig)
}

// 语音识别函数 - 使用最新API参数
export async function recognizeSpeechWithTencent(audioFilePath) {
  console.log('🎤 开始腾讯云语音识别')
  console.log(`📁 音频文件: ${audioFilePath}`)
  
  try {
    // 检查文件是否存在
    if (!fs.existsSync(audioFilePath)) {
      throw new Error('音频文件不存在')
    }

    // 初始化客户端
    const client = initTencentASRClient()
    
    // 读取音频文件
    const audioData = fs.readFileSync(audioFilePath)
    const audioBase64 = audioData.toString('base64')
    
    console.log(`🎵 文件大小: ${audioData.length} 字节`)
    
    // 调用腾讯云语音识别API - 使用正确的参数格式
    const params = {
      EngineModelType: '16k_zh',    // 16k 中文通用模型
      ChannelNum: 1,                // 单声道
      ResTextFormat: 0,             // 0: 一次性返回结果
      SourceType: 1,                // 1: 语音数据
      Data: audioBase64,            // base64编码的音频数据
      DataLen: audioData.length     // 数据长度
    }
    
    console.log('📋 发送请求到腾讯云...')
    
    // 创建识别任务
    const result = await client.CreateRecTask(params)
    
    if (result.Data && result.Data.TaskId) {
      console.log(`✅ 任务创建成功: ${result.Data.TaskId}`)
      
      // 获取识别结果
      const taskResult = await getRecognitionResult(client, result.Data.TaskId)
      
      if (taskResult.Result === 0 && taskResult.ResultStr) {
        return {
          success: true,
          text: taskResult.ResultStr,
          confidence: 0.95,
          duration: taskResult.AudioDuration || 0,
          taskId: taskResult.TaskId,
          provider: 'tencent-cloud'
        }
      } else {
        throw new Error(`识别失败: ${taskResult.ErrorMessage || '未知错误'}`)
      }
    } else {
      throw new Error('创建识别任务失败')
    }
    
  } catch (error) {
    console.error('腾讯云语音识别失败:', error)
    
    // 返回错误信息
    return {
      success: false,
      error: error.message,
      provider: 'tencent-cloud'
    }
  }
}

// 获取识别结果
async function getRecognitionResult(client, taskId, maxRetries = 30, interval = 2000) {
  let retries = 0
  
  console.log(`⏳ 等待识别结果: ${taskId}`)
  
  while (retries < maxRetries) {
    try {
      const result = await client.DescribeTaskStatus({ TaskId: taskId })
      
      if (result.Data) {
        const status = result.Data.Status
        
        if (status === 2) { // 完成
          console.log('✅ 识别完成')
          return result.Data
        } else if (status === 3) { // 失败
          throw new Error(`识别失败: ${result.Data.ErrorMessage || '未知错误'}`)
        } else if (status === 1) { // 进行中
          console.log(`⏳ 识别中... (${retries + 1}/${maxRetries})`)
          await new Promise(resolve => setTimeout(resolve, interval))
          retries++
        } else {
          throw new Error(`未知状态: ${status}`)
        }
      } else {
        throw new Error('获取任务状态失败')
      }
    } catch (error) {
      console.error(`获取状态失败 (第${retries + 1}次):`, error.message)
      
      if (retries >= maxRetries - 1) {
        throw error
      }
      
      await new Promise(resolve => setTimeout(resolve, interval))
      retries++
    }
  }
  
  throw new Error(`识别超时: 超过 ${maxRetries * interval / 1000} 秒`)
}

// 测试函数
export async function testTencentAPI() {
  console.log('🧪 测试腾讯云API集成')
  
  try {
    // 检查配置
    if (!TENCENT_CONFIG.secretId || !TENCENT_CONFIG.secretKey) {
      console.log('❌ 腾讯云API密钥未配置')
      return false
    }
    
    console.log('✅ API密钥配置正常')
    
    // 初始化客户端
    const client = initTencentASRClient()
    console.log('✅ 客户端初始化成功')
    
    // 测试一个简单的查询来验证连接
    await client.DescribeTaskStatus({ TaskId: 'test' })
    console.log('✅ API连接测试成功')
    
    return true
    
  } catch (error) {
    console.error('❌ API测试失败:', error.message)
    return false
  }
}

// 使用示例
if (import.meta.url === `file://${process.argv[1]}`) {
  testTencentAPI().then(success => {
    if (success) {
      console.log('🎉 腾讯云API集成成功！')
    } else {
      console.log('❌ 腾讯云API集成失败')
    }
  })
}
