<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { showConfirmDialog, showDialog, showToast } from 'vant'
import request from '@/utils/request'
import { cleanupExpiredRecords, deleteVoiceRecord, downloadVoiceRecord, getVoiceRecords, readSms, transcribeVoice, batchTranscribeRecords } from '@/api'

const router = useRouter()

interface Device {
  imei: string
  phone: string
  connected: boolean
  lastSeen: string
  createdAt?: string
  boundUser?: string // 绑定用户（仅管理员可见）
  mac?: string // 设备MAC地址（可选）
  temperature?: number // 温度
  signal?: number // 信号强度（dBm）
  voltage?: number // 电压
  runtime?: number // 运行总时长（秒）
  is_whitelisted?: boolean // 是否在设备白名单中（单用户模式下不再使用）
  operator?: string // 运营商
  ver?: string // 系统版本
  ip?: string // 设备 IP 地址
}

const deviceList = ref<Device[]>([])
const loading = ref(false)
// 设备列表自动刷新定时器 ID
const deviceRefreshTimer = ref<number | null>(null)
const searchQuery = ref('')
const showDetailDialog = ref(false)



// 用户信息
const userInfo = ref<any>(null)

// Logo配置
const logoConfig = ref({
  websiteTitle: 'Air724设备管理',
  websiteLogo: ''
})

// 加载Logo配置
async function loadLogoConfig() {
  try {
    // 从localStorage加载Logo配置
    const savedConfig = localStorage.getItem('air724_logo_config')
    if (savedConfig) {
      const config = JSON.parse(savedConfig)
      logoConfig.value = { ...logoConfig.value, ...config }
      
      // 更新页面标题
      if (logoConfig.value.websiteTitle) {
        document.title = logoConfig.value.websiteTitle
      }
    }
  } catch (error) {
    console.error('加载Logo配置失败:', error)
  }
}

// 单用户开放模式：不再使用设备白名单功能，相关操作已禁用
const showManageDialog = ref(false)
const showAtCmdDialog = ref(false)
const showConfigDialog = ref(false)
const showSmsDialog = ref(false)
const showAdvancedDialog = ref(false)
const selectedDevice = ref<Device | null>(null)

// 设备选择和解绑
const selectedDevices = ref<string[]>([])
const restartLoading = ref(false)

// 编辑手机号弹窗
const showEditPhoneDialog = ref(false)
const editPhoneValue = ref('')
const editPhoneTarget = ref<Device | null>(null)
const editPhoneLoading = ref(false)

// 用户账号设置
const showAccountDialog = ref(false)
const accountForm = ref({
  currentPassword: '',
  newPassword: '',
  confirmPassword: '',
  email: ''
})

// 配置管理相关
const configText = ref('')
const configLoading = ref(false)

// 批量下发配置相关
const showBatchDeployDialog = ref(false)
const batchDeploySourceDevice = ref<Device | null>(null)
const batchDeployTargetDevices = ref<string[]>([])
const batchDeployLoading = ref(false)

// AT命令相关
const atCommand = ref('')
const atResult = ref('')
const atLoading = ref(false)

// 常用AT指令
const commonAtCommands = [
  { command: 'AT+CNUM', desc: '获取手机号' },
  { command: 'AT+CGSN', desc: '获取IMEI' },
  { command: 'AT+ICCID', desc: '获取ICCID' },
  { command: 'AT+CPIN?', desc: 'SIM卡状态' },
  { command: 'AT+CSQ', desc: '信号强度' },
  { command: 'AT+CREG?', desc: '网络状态' },
  { command: 'AT+RFTEMPERATURE?', desc: '查询温度' },
  { command: 'AT+RESET', desc: '设备重启' },
]

// 短信相关
const smsPhone = ref('')
const smsContent = ref('')
const smsLoading = ref(false)
const smsTab = ref('send') // 'send' 或 'read'
const smsList = ref<any[]>([])
const smsListLoading = ref(false)

// 语音转文字相关
const showVoiceDialog = ref(false)
const voiceRecords = ref([])
const voiceLoading = ref(false)

const userPermissions = ref({ voice_transcribe: true, sms_read: true, is_admin: true })

// 转换状态跟踪
const transcribingIds = ref(new Set())

// 管理员状态
const isAdmin = computed(() => userPermissions.value.is_admin)

// 高级配置标签页
const advancedTab = ref('notification')

// 高级配置字段
const trafficQueryInterval = ref(0)
const maxRetryCount = ref(100)
const appendMoreInfo = ref(true)
const websocketUrl = ref('')

// 通知类型配置
const notifyTypes = ref<string[]>([])

// 通知渠道详细配置
const customPostUrl = ref('')
const customPostContentType = ref('')
const customPostBodyTable = ref('')
const telegramApi = ref('')
const telegramChatId = ref('')
const pushdeerApi = ref('')
const pushdeerKey = ref('')
const barkApi = ref('')
const barkKey = ref('')
const dingtalkWebhook = ref('')
const dingtalkSecret = ref('')
const feishuWebhook = ref('')
const wecomWebhook = ref('')
const wecomCorpid = ref('')
const wecomCorpsecret = ref('')
const wecomAgentid = ref('')
const wecomAppTouser = ref('')
const wecomAppSafe = ref(0)
const pushoverApiToken = ref('')
const pushoverUserKey = ref('')
const inotifyApi = ref('')
const nextSmtpProxyApi = ref('')
const nextSmtpProxyUser = ref('')
const nextSmtpProxyPassword = ref('')
const nextSmtpProxyHost = ref('')
const nextSmtpProxyPort = ref(587)
const nextSmtpProxyFormName = ref('')
const nextSmtpProxyToEmail = ref('')
const nextSmtpProxySubject = ref('')
const gotifyApi = ref('')
const gotifyTitle = ref('')
const gotifyPriority = ref(8)
const gotifyToken = ref('')
const gotifyClientToken = ref('')
const serverchanTitle = ref('')
const serverchanApi = ref('')
const pushplusToken = ref('')
const pushplusTitle = ref('')
const wxpusherAppToken = ref('')
const wxpusherUids = ref('')
const wxpusherSummary = ref('')
const wxpusherContentType = ref(1)

// 短信来电配置
const smsControlWhitelistNumbers = ref<string[]>([])
const smsTts = ref(0)
const ttsText = ref('')
const callInAction = ref(0)

// 录音配置
const recordEnable = ref(true)
const recordFormat = ref(3) // 3 = amrnb
const recordQuality = ref(1)
const recordMaxTime = ref(50) // 秒
const callMaxTime = ref(300) // 秒

// 设备设置
const audioVolume = ref(1)
const callVolume = ref(0)
const micVolume = ref(7)
const rndisEnable = ref(false)
const ledEnable = ref(true)
const bootNotify = ref(true)
const voiceSendEnable = ref(false)
const pinCode = ref('')
const uploadUrl = ref('')
const notifyTypeOptions = [
  { label: '自定义POST', value: 'custom_post', icon: 'i-carbon:api' },
  { label: 'Telegram', value: 'telegram', icon: 'i-carbon:send-alt' },
  { label: 'PushDeer', value: 'pushdeer', icon: 'i-carbon:notification' },
  { label: 'Bark', value: 'bark', icon: 'i-carbon:phone' },
  { label: '钉钉', value: 'dingtalk', icon: 'i-carbon:chat' },
  { label: '飞书', value: 'feishu', icon: 'i-carbon:chat-bot' },
  { label: '企业微信群机器人', value: 'wecom', icon: 'i-carbon:group' },
  { label: '企业微信应用', value: 'wecom_app', icon: 'i-carbon:application' },
  { label: 'Pushover', value: 'pushover', icon: 'i-carbon:push-notification' },
  { label: 'Inotify', value: 'inotify', icon: 'i-carbon:email' },
  { label: 'Next SMTP Proxy', value: 'next-smtp-proxy', icon: 'i-carbon:email-new' },
  { label: 'Gotify', value: 'gotify', icon: 'i-carbon:notification-new' },
  { label: 'ServerChan', value: 'serverchan', icon: 'i-carbon:cloud-app' },
  { label: 'PushPlus', value: 'pushplus', icon: 'i-carbon:send-filled' },
  { label: 'WxPusher', value: 'wxpusher', icon: 'i-carbon:notification-off' },
]

// 过滤后的设备列表
const filteredDevices = computed(() => {
  if (!searchQuery.value)
    return deviceList.value

  const query = searchQuery.value.toLowerCase()
  return deviceList.value.filter(device =>
    device.imei.toLowerCase().includes(query)
    || (device.phone && device.phone.toLowerCase().includes(query)),
  )
})

// 列表排序相关
const sortKey = ref<
  ''
  | 'imei'
  | 'phone'
  | 'connected'
  | 'runtime'
  | 'temperature'
  | 'operator'
  | 'signal'
  | 'voltage'
  | 'ver'
  | 'ip'
  | 'lastSeen'
>('')
const sortOrder = ref<'asc' | 'desc'>('desc')

const sortedDevices = computed(() => {
  const list = [...filteredDevices.value]
  if (!sortKey.value)
    return list

  const key = sortKey.value

  return list.sort((a, b) => {
    let va: any = (a as any)[key]
    let vb: any = (b as any)[key]

    // 最后在线按时间排序
    if (key === 'lastSeen') {
      va = va ? new Date(va).getTime() : 0
      vb = vb ? new Date(vb).getTime() : 0
    }

    // 空值统一排在后面
    if (va == null && vb == null) return 0
    if (va == null) return 1
    if (vb == null) return -1

    if (va < vb) return sortOrder.value === 'asc' ? -1 : 1
    if (va > vb) return sortOrder.value === 'asc' ? 1 : -1
    return 0
  })
})

function toggleSort(key: typeof sortKey.value) {
  if (sortKey.value === key) {
    sortOrder.value = sortOrder.value === 'asc' ? 'desc' : 'asc'
  } else {
    sortKey.value = key
    // 默认从大到小
    sortOrder.value = 'desc'
  }
}

// 幻灯片脚本逻辑已移除

// 获取设备状态信息（预留函数，目前前端不再生成模拟数据，直接使用后端返回的字段）
async function fetchDeviceStatus() {
  return { temperature: null, signal: null, voltage: null }
}

// 将运行总时长（秒）格式化为人类可读的字符串
function formatRuntime(seconds?: number | null) {
  if (seconds == null || Number.isNaN(seconds)) return '--'
  const total = Math.max(0, Math.floor(seconds))
  const days = Math.floor(total / 86400)
  const hours = Math.floor((total % 86400) / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const secs = total % 60

  const parts: string[] = []
  if (days) parts.push(`${days}天`)
  if (hours) parts.push(`${hours}小时`)
  if (minutes) parts.push(`${minutes}分`)
  if (!parts.length) parts.push(`${secs}秒`)
  return parts.join('')
}

// 计算统计数据
const stats = computed(() => {
  const total = deviceList.value.length
  const online = deviceList.value.filter(d => d.connected).length
  const offline = total - online

  const today = new Date()
  const todayStr = today.toISOString().slice(0, 10)
  const todayAdded = deviceList.value.filter(d => {
    if (!d.createdAt)
      return false
    const dateStr = new Date(d.createdAt).toISOString().slice(0, 10)
    return dateStr === todayStr
  }).length

  return {
    total,
    online,
    offline,
    todayAdded,
  }
})

// 显示设备详情弹窗
function showDeviceDetail(device: Device) {
  selectedDevice.value = device
  showDetailDialog.value = true
}

// 显示管理弹窗（单用户模式：所有设备均可管理）
function showManage(device: Device) {
  selectedDevice.value = device
  showManageDialog.value = true
}

// 语音转文字
const openVoiceTranscribe = (device: any) => {
  selectedDevice.value = device
  showVoiceDialog.value = true
  loadVoiceRecords()
}

// 短信管理弹窗（单用户模式下权限始终允许）
function openSms() {
  if (!selectedDevice.value) return
  // 有权限时默认进入“读取短信”并加载列表
  smsTab.value = 'read'
  showSmsDialog.value = true
  nextTick(() => {
    loadSmsList()
  })
}

// 打开AT命令弹窗
function openAtCmd() {
  showAtCmdDialog.value = true
}

// 打开配置管理弹窗
async function openConfig() {
  showConfigDialog.value = true
  // 获取配置
  await fetchConfig()
}

// 打开高级配置弹窗
function openAdvanced() {
  showAdvancedDialog.value = true
  
  // 自动读取设备配置
  // 使用 nextTick 确保弹窗已经渲染完成
  nextTick(() => {
    fetchAdvancedConfig()
  })
}

// 切换通知类型
function toggleNotifyType(value: string) {
  const index = notifyTypes.value.indexOf(value)
  if (index > -1) {
    notifyTypes.value.splice(index, 1)
  } else {
    notifyTypes.value.push(value)
  }
}

// 检查认证状态
async function checkAuth() {
  const token = localStorage.getItem('token')
  if (!token) {
    router.push('/login')
    return
  }
  
  try {
    const response = await request.get('/auth/verify') as any
    if (response.success && response.data?.userInfo) {
      // 更新本地用户信息
      localStorage.setItem('userInfo', JSON.stringify(response.data.userInfo))
      userInfo.value = response.data.userInfo
      
      // 检查是否需要激活
      if (response.data.userInfo.needActivation) {
        router.push('/activate')
        return
      }
      
      // 如果是管理员且在首页，可能需要特殊处理
      // 但这里不需要，管理员应该可以访问设备管理页面
    } else {
      router.push('/login')
    }
  } catch (error) {
    console.error('认证验证失败:', error)
    router.push('/login')
  }
}

// 开始轮询设备列表（已改为仅刷新一次，不再每 30 秒自动刷新）
function startPolling() {
  // 如果已有定时器，先清除
  if (deviceRefreshTimer.value !== null) {
    clearInterval(deviceRefreshTimer.value)
    deviceRefreshTimer.value = null
  }

  // 只在调用时刷新一次设备列表
  fetchDeviceList()
}

// 开始心跳检查
function startHeartbeatCheck() {
  const interval = setInterval(() => {
    // 心跳检查逻辑
  }, 30000)
  
  onUnmounted(() => {
    clearInterval(interval)
  })
}

// 开始设备状态轮询
function startDeviceStatusPolling() {
  const interval = setInterval(() => {
    // 设备状态轮询逻辑
  }, 10000)
  
  onUnmounted(() => {
    clearInterval(interval)
  })
}

// 解析Lua配置字符串（参考旧版本完整实现）
function parseLuaConfig(configText: string) {
  console.log('开始解析Lua配置，配置内容长度:', configText.length)
  console.log('原始配置内容:', configText)
  
  const configObj: Record<string, any> = {}
  const lines = configText.split('\n')
  let currentKey = ''
  let currentValue = ''
  let inMultiLineValue = false
  
  for (const line of lines) {
    const trimmedLine = line.trim()
    
    // 跳过空行和模块声明
    if (!trimmedLine || trimmedLine.startsWith('module(')) {
      continue
    }
    
    // 处理多行值的情况
    if (inMultiLineValue) {
      if (trimmedLine === '}' || trimmedLine === ']') {
        processConfigValue(currentKey, currentValue, configObj)
        currentKey = ''
        currentValue = ''
        inMultiLineValue = false
      } else {
        currentValue += '\n' + trimmedLine
      }
      continue
    }
    
    // 匹配配置行: KEY = value
    const match = trimmedLine.match(/^([A-Z_]+)\s*=\s*(.+)$/)
    if (match) {
      const key = match[1]
      let value = match[2].trim()
      
      // 检查是否为多行值的开始
      if (value.startsWith('{') || value.startsWith('[')) {
        currentKey = key
        currentValue = value
        inMultiLineValue = !value.endsWith('}') && !value.endsWith(']')
        if (!inMultiLineValue) {
          processConfigValue(key, value, configObj)
        }
      } else {
        processConfigValue(key, value, configObj)
      }
    }
  }
  
  // 处理配置值
  function processConfigValue(key: string, value: string, configObj: Record<string, any>) {
    // 将Lua配置键名转换为驼峰格式
    const camelCaseKey = key.toLowerCase().replace(/_([a-z])/g, (_, letter) => letter.toUpperCase())
    
    // 移除字符串的引号
    let cleanValue = value.replace(/^['"]|['"]$/g, '')
    
    // 根据键名处理不同类型的数据
    switch (key) {
      case 'NOTIFY_TYPE':
      case 'SMS_CONTROL_WHITELIST_NUMBERS':
        // 处理数组类型
        if (value.startsWith('{') && value.endsWith('}')) {
          try {
            const arrayContent = value.substring(1, value.length - 1)
            const items = arrayContent.split(',').map(item => item.trim().replace(/^['"]|['"]$/g, ''))
            configObj[camelCaseKey] = items.filter(item => item.length > 0)
          } catch (error) {
            console.warn(`解析数组 ${key} 失败:`, error)
            configObj[camelCaseKey] = []
          }
        }
        break
        
      case 'BOOT_NOTIFY':
      case 'NOTIFY_APPEND_MORE_INFO':
      case 'VOICE_SEND_ENABLE':
      case 'RNDIS_ENABLE':
      case 'LED_ENABLE':
        // 处理布尔值
        configObj[camelCaseKey] = value.toLowerCase() === 'true' || value === '1'
        break
      
      case 'record_enable':
        // 处理录音启用（小写）
        recordEnable.value = value.toLowerCase() === 'true' || value === '1'
        break
        
      case 'AUDIO_VOLUME':
      case 'CALL_VOLUME':
      case 'MIC_VOLUME':
      case 'SMS_TTS':
      case 'CALL_IN_ACTION':
      case 'GOTIFY_PRIORITY':
      case 'NOTIFY_RETRY_MAX':
      case 'QUERY_TRAFFIC_INTERVAL':
      case 'NEXT_SMTP_PROXY_PORT':
      case 'WECOM_APP_SAFE':
        // 处理数字类型
        const numValue = parseInt(cleanValue)
        configObj[camelCaseKey] = isNaN(numValue) ? 0 : numValue
        break
      
      case 'record_format':
      case 'record_quality':
      case 'record_max_time':
      case 'call_max_time':
        // 处理录音相关数字配置（小写）
        const recordNumValue = parseInt(cleanValue)
        if (key === 'record_format') recordFormat.value = isNaN(recordNumValue) ? 3 : recordNumValue
        if (key === 'record_quality') recordQuality.value = isNaN(recordNumValue) ? 1 : recordNumValue
        if (key === 'record_max_time') recordMaxTime.value = isNaN(recordNumValue) ? 50 : recordNumValue
        if (key === 'call_max_time') callMaxTime.value = isNaN(recordNumValue) ? 300 : recordNumValue
        break
        
      default:
        // 处理字符串类型
        configObj[camelCaseKey] = cleanValue
        break
    }
    
    console.log(`处理配置项 ${key}: ${value} =>`, configObj[camelCaseKey])
  }
  
  console.log('解析后的配置对象:', configObj)
  
  // 更新所有响应式变量
  if (configObj.notifyType) notifyTypes.value = configObj.notifyType
  if (configObj.customPostUrl !== undefined) customPostUrl.value = configObj.customPostUrl
  if (configObj.customPostContentType !== undefined) customPostContentType.value = configObj.customPostContentType
  if (configObj.customPostBodyTable !== undefined) customPostBodyTable.value = configObj.customPostBodyTable
  if (configObj.telegramApi !== undefined) telegramApi.value = configObj.telegramApi
  if (configObj.telegramChatId !== undefined) telegramChatId.value = configObj.telegramChatId
  if (configObj.pushdeerApi !== undefined) pushdeerApi.value = configObj.pushdeerApi
  if (configObj.pushdeerKey !== undefined) pushdeerKey.value = configObj.pushdeerKey
  if (configObj.barkApi !== undefined) barkApi.value = configObj.barkApi
  if (configObj.barkKey !== undefined) barkKey.value = configObj.barkKey
  if (configObj.dingtalkWebhook !== undefined) dingtalkWebhook.value = configObj.dingtalkWebhook
  if (configObj.dingtalkSecret !== undefined) dingtalkSecret.value = configObj.dingtalkSecret
  if (configObj.feishuWebhook !== undefined) feishuWebhook.value = configObj.feishuWebhook
  if (configObj.wecomWebhook !== undefined) wecomWebhook.value = configObj.wecomWebhook
  if (configObj.wecomCorpid !== undefined) wecomCorpid.value = configObj.wecomCorpid
  if (configObj.wecomCorpsecret !== undefined) wecomCorpsecret.value = configObj.wecomCorpsecret
  if (configObj.wecomAgentid !== undefined) wecomAgentid.value = configObj.wecomAgentid
  if (configObj.wecomAppTouser !== undefined) wecomAppTouser.value = configObj.wecomAppTouser
  if (configObj.wecomAppSafe !== undefined) wecomAppSafe.value = configObj.wecomAppSafe
  if (configObj.pushoverApiToken !== undefined) pushoverApiToken.value = configObj.pushoverApiToken
  if (configObj.pushoverUserKey !== undefined) pushoverUserKey.value = configObj.pushoverUserKey
  if (configObj.inotifyApi !== undefined) inotifyApi.value = configObj.inotifyApi
  if (configObj.nextSmtpProxyApi !== undefined) nextSmtpProxyApi.value = configObj.nextSmtpProxyApi
  if (configObj.nextSmtpProxyUser !== undefined) nextSmtpProxyUser.value = configObj.nextSmtpProxyUser
  if (configObj.nextSmtpProxyPassword !== undefined) nextSmtpProxyPassword.value = configObj.nextSmtpProxyPassword
  if (configObj.nextSmtpProxyHost !== undefined) nextSmtpProxyHost.value = configObj.nextSmtpProxyHost
  if (configObj.nextSmtpProxyPort !== undefined) nextSmtpProxyPort.value = configObj.nextSmtpProxyPort
  if (configObj.nextSmtpProxyFormName !== undefined) nextSmtpProxyFormName.value = configObj.nextSmtpProxyFormName
  if (configObj.nextSmtpProxyToEmail !== undefined) nextSmtpProxyToEmail.value = configObj.nextSmtpProxyToEmail
  if (configObj.nextSmtpProxySubject !== undefined) nextSmtpProxySubject.value = configObj.nextSmtpProxySubject
  if (configObj.gotifyApi !== undefined) gotifyApi.value = configObj.gotifyApi
  if (configObj.gotifyTitle !== undefined) gotifyTitle.value = configObj.gotifyTitle
  if (configObj.gotifyPriority !== undefined) gotifyPriority.value = configObj.gotifyPriority
  if (configObj.gotifyToken !== undefined) gotifyToken.value = configObj.gotifyToken
  if (configObj.gotifyClientToken !== undefined) gotifyClientToken.value = configObj.gotifyClientToken
  // 兼容设备现有配置中的键名 WXPUSHER_APPTOKEN（注意没有下划线）
  if (configObj.wxpusherApptoken !== undefined) wxpusherAppToken.value = configObj.wxpusherApptoken
  if (configObj.wxpusherUids !== undefined) wxpusherUids.value = configObj.wxpusherUids
  if (configObj.wxpusherSummary !== undefined) wxpusherSummary.value = configObj.wxpusherSummary
  if (configObj.wxpusherContentType !== undefined) wxpusherContentType.value = configObj.wxpusherContentType
  if (configObj.serverchanTitle !== undefined) serverchanTitle.value = configObj.serverchanTitle
  if (configObj.serverchanApi !== undefined) serverchanApi.value = configObj.serverchanApi
  if (configObj.pushplusToken !== undefined) pushplusToken.value = configObj.pushplusToken
  if (configObj.pushplusTitle !== undefined) pushplusTitle.value = configObj.pushplusTitle
  if (configObj.websocketUrl !== undefined) websocketUrl.value = configObj.websocketUrl
  if (configObj.queryTrafficInterval !== undefined) trafficQueryInterval.value = configObj.queryTrafficInterval
  if (configObj.bootNotify !== undefined) bootNotify.value = configObj.bootNotify
  if (configObj.voiceSendEnable !== undefined) voiceSendEnable.value = configObj.voiceSendEnable
  if (configObj.notifyAppendMoreInfo !== undefined) appendMoreInfo.value = configObj.notifyAppendMoreInfo
  if (configObj.notifyRetryMax !== undefined) maxRetryCount.value = configObj.notifyRetryMax
  if (configObj.smsControlWhitelistNumbers) smsControlWhitelistNumbers.value = configObj.smsControlWhitelistNumbers
  if (configObj.smsTts !== undefined) smsTts.value = configObj.smsTts
  if (configObj.ttsText !== undefined) ttsText.value = configObj.ttsText
  if (configObj.callInAction !== undefined) callInAction.value = configObj.callInAction
  if (configObj.audioVolume !== undefined) audioVolume.value = configObj.audioVolume
  if (configObj.callVolume !== undefined) callVolume.value = configObj.callVolume
  if (configObj.micVolume !== undefined) micVolume.value = configObj.micVolume
  if (configObj.rndisEnable !== undefined) rndisEnable.value = configObj.rndisEnable
  if (configObj.ledEnable !== undefined) ledEnable.value = configObj.ledEnable
  if (configObj.pinCode !== undefined) pinCode.value = configObj.pinCode
  if (configObj.uploadUrl !== undefined) uploadUrl.value = configObj.uploadUrl
}

// 读取高级配置
async function fetchAdvancedConfig() {
  if (!selectedDevice.value?.imei) return
  showToast('正在读取配置...')
  try {
    const response = await request.post('/executeTask', {
      imei: selectedDevice.value.imei,
      task: 'get_config',
    }) as any
    
    if (response.success && response.result) {
      console.log('原始配置内容:', response.result)
      
      // 使用完整的Lua配置解析器
      parseLuaConfig(response.result)
      
      // 等待DOM更新后，确保所有条件渲染的输入框都已显示
      await nextTick()
      
      console.log('解析后的配置:', {
        notifyTypes: notifyTypes.value,
        gotifyApi: gotifyApi.value,
        telegramApi: telegramApi.value,
        smsControlWhitelistNumbers: smsControlWhitelistNumbers.value,
        smsTts: smsTts.value,
        callInAction: callInAction.value,
        audioVolume: audioVolume.value,
        callVolume: callVolume.value,
        micVolume: micVolume.value,
        rndisEnable: rndisEnable.value,
        ledEnable: ledEnable.value,
        bootNotify: bootNotify.value,
        pinCode: pinCode.value,
        trafficQueryInterval: trafficQueryInterval.value,
        maxRetryCount: maxRetryCount.value,
        appendMoreInfo: appendMoreInfo.value,
        websocketUrl: websocketUrl.value
      })
      
      showToast('读取配置成功')
    } else {
      showToast(response.message || '读取配置失败')
    }
  } catch (error: any) {
    showToast(error?.message || '读取配置失败')
    console.error('读取配置错误:', error)
  }
}

// 将配置对象转换为Lua配置字符串
function configToLua(): string {
  let luaConfig = 'module(...)\n\n'

  // 添加功能说明注释
  luaConfig += `-------------------------------------------------- 功能及使用说明 --------------------------------------------------\n\n`
  luaConfig += `-- 本项目支持外接扬声器和麦克风, 可以实现接打电话等功能, 推荐连接后使用\n\n`
  luaConfig += `-- 连接扬声器后, 可以通过短按/双击/长按 POWERKEY 来切换选择菜单项\n`
  luaConfig += `-- 菜单项包含: 扬声器音量/通话音量/麦克音量/回拨电话/测试通知/网卡/短信播报/历史短信/来电动作/开机通知/查询流量/查询温度/查询时间/查询信号/查询内存/查询电压/状态指示灯/切换卡槽/重启/关机\n`
  luaConfig += `-- 连接扬声器后, 可以播放: 通知发送成功提示音/来电铃声/通话外放声/短信验证码/短信内容\n`
  luaConfig += `-- 来电动作配置为无操作时, 如果来电话, 可以通过短按/长按 POWERKEY 来手动接听/挂断电话\n\n`
  luaConfig += `-- 支持虚拟U盘来存储历史短信, 需要使用 core 目录下的底层固件\n\n`
  luaConfig += `-- 下面配置文件编辑时注意删除注释 (两个短横杠--是lua的注释), 推荐使用 VSCode 代码编辑器\n\n`

  // 通知相关配置
  luaConfig += `-------------------------------------------------- 通知相关配置 --------------------------------------------------\n\n`
  luaConfig += `-- 通知类型, 支持配置多个\n`
  luaConfig += `-- NOTIFY_TYPE = { "custom_post", "telegram", "pushdeer", "bark", "dingtalk", "feishu", "wecom", "wecom_app", "pushover", "inotify", "next-smtp-proxy", "gotify", "serverchan", "pushplus" }\n`
  luaConfig += `NOTIFY_TYPE = { ${notifyTypes.value && notifyTypes.value.length > 0 ? notifyTypes.value.map(t => `"${t}"`).join(', ') : ''} }\n\n`

  // 各种通知服务配置
  // custom_post 通知配置, 自定义 POST 请求
  luaConfig += `-- custom_post 通知配置, 自定义 POST 请求\n`
  luaConfig += `-- CUSTOM_POST_CONTENT_TYPE 支持 application/x-www-form-urlencoded 和 application/json\n`
  luaConfig += `-- CUSTOM_POST_BODY_TABLE 中的 {msg} 会被替换为通知内容\n`
  luaConfig += `-- CUSTOM_POST_URL = "https://sctapi.ftqq.com/<SENDKEY>.send"\n`
  luaConfig += `CUSTOM_POST_URL = "${customPostUrl.value || ''}"\n`
  luaConfig += `CUSTOM_POST_CONTENT_TYPE = "${customPostContentType.value || ''}"\n`
  luaConfig += `CUSTOM_POST_BODY_TABLE = ${customPostBodyTable.value || '{}'}\n\n`

  // telegram 通知配置
  luaConfig += `-- telegram 通知配置, https://github.com/0wQ/telegram-notify 或者自行反代\n`
  luaConfig += `-- TELEGRAM_API = "https://api.telegram.org/bot{token}/sendMessage"\n`
  luaConfig += `TELEGRAM_API = "${telegramApi.value || ''}"\n`
  luaConfig += `TELEGRAM_CHAT_ID = "${telegramChatId.value || ''}"\n\n`

  // pushdeer 通知配置
  luaConfig += `-- pushdeer 通知配置, https://www.pushdeer.com/\n`
  luaConfig += `PUSHDEER_API = "${pushdeerApi.value || ''}"\n`
  luaConfig += `PUSHDEER_KEY = "${pushdeerKey.value || ''}"\n\n`

  // bark 通知配置
  luaConfig += `-- bark 通知配置, https://github.com/Finb/Bark\n`
  luaConfig += `BARK_API = "${barkApi.value || ''}"\n`
  luaConfig += `BARK_KEY = "${barkKey.value || ''}"\n\n`

  // dingtalk 通知配置
  luaConfig += `-- dingtalk 通知配置, https://open.dingtalk.com/document/robots/custom-robot-access\n`
  luaConfig += `-- 自定义关键词方式可填写 ":" "#" "号码"\n`
  luaConfig += `-- 如果是加签方式, 请填写 DINGTALK_SECRET, 否则留空为自定义关键词方式, https://open.dingtalk.com/document/robots/customize-robot-security-settings\n`
  luaConfig += `DINGTALK_WEBHOOK = "${dingtalkWebhook.value || ''}"\n`
  luaConfig += `DINGTALK_SECRET = "${dingtalkSecret.value || ''}"\n\n`

  luaConfig += `-- feishu 通知配置, https://open.feishu.cn/document/ukTMukTMukTM/ucTM5YjL3ETO24yNxkjN\n`
  luaConfig += `FEISHU_WEBHOOK = "${feishuWebhook.value || ''}"\n\n`

  luaConfig += `-- wecom 通知配置, https://developer.work.weixin.qq.com/document/path/91770\n`
  luaConfig += `WECOM_WEBHOOK = "${wecomWebhook.value || ''}"\n\n`

  luaConfig += `-- wecom 应用通知配置, https://developer.work.weixin.qq.com/document/path/90236\n`
  luaConfig += `-- 请求方式：POST（HTTPS）\n`
  luaConfig += `-- 请求地址：https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=ACCESS_TOKEN\n`
  luaConfig += `WECOM_CORPID = "${wecomCorpid.value || ''}"\n`
  luaConfig += `WECOM_CORPSECRET = "${wecomCorpsecret.value || ''}"\n`
  luaConfig += `WECOM_AGENTID = "${wecomAgentid.value || ''}"\n`
  luaConfig += `WECOM_APP_TOUSER = "${wecomAppTouser.value || ''}"\n`
  luaConfig += `WECOM_APP_SAFE = ${wecomAppSafe.value || 0}\n\n`

  luaConfig += `-- pushover 通知配置, https://pushover.net/api\n`
  luaConfig += `PUSHOVER_API_TOKEN = "${pushoverApiToken.value || ''}"\n`
  luaConfig += `PUSHOVER_USER_KEY = "${pushoverUserKey.value || ''}"\n`
  luaConfig += `\n`

  luaConfig += `-- inotify 通知配置, https://github.com/xpnas/Inotify 或者使用合宙提供的 https://push.luatos.org\n`
  luaConfig += `INOTIFY_API = "${inotifyApi.value || ''}"\n\n`

  luaConfig += `-- next-smtp-proxy 通知配置, https://github.com/0wQ/next-smtp-proxy\n`
  luaConfig += `NEXT_SMTP_PROXY_API = "${nextSmtpProxyApi.value || ''}"\n`
  luaConfig += `NEXT_SMTP_PROXY_USER = "${nextSmtpProxyUser.value || ''}"\n`
  luaConfig += `NEXT_SMTP_PROXY_PASSWORD = "${nextSmtpProxyPassword.value || ''}"\n`
  luaConfig += `NEXT_SMTP_PROXY_HOST = "${nextSmtpProxyHost.value || ''}"\n`
  luaConfig += `NEXT_SMTP_PROXY_PORT = ${nextSmtpProxyPort.value || 587}\n`
  luaConfig += `NEXT_SMTP_PROXY_FORM_NAME = "${nextSmtpProxyFormName.value || ''}"\n`
  luaConfig += `NEXT_SMTP_PROXY_TO_EMAIL = "${nextSmtpProxyToEmail.value || ''}"\n`
  luaConfig += `NEXT_SMTP_PROXY_SUBJECT = "${nextSmtpProxySubject.value || ''}"\n`
  luaConfig += `\n`

  luaConfig += `-- gotify 通知配置, https://gotify.net/\n`
  luaConfig += `-- GOTIFY_API = "http://127.0.0.1:8080"\n`
  luaConfig += `GOTIFY_API = "${gotifyApi.value || ''}"\n`
  luaConfig += `-- gotify 标题\n`
  luaConfig += `GOTIFY_TITLE = "${gotifyTitle.value || ''}"\n`
  luaConfig += `GOTIFY_PRIORITY = ${gotifyPriority.value || 8}\n`
  luaConfig += `-- gotify token为创建的apps的token(需注意，需在gotify上创建一个名为"sms"的app)\n`
  luaConfig += `GOTIFY_TOKEN = "${gotifyToken.value || ''}"\n`
  luaConfig += `-- gotify 客户端token(即为配置好的client的token)\n`
  luaConfig += `GOTIFY_CLIENT_TOKEN="${gotifyClientToken.value || ''}"\n\n`

  luaConfig += `WEBSOCKET_URL="${websocketUrl.value || ''}"\n\n`

  luaConfig += `-- serverchan 通知配置\n`
  luaConfig += `SERVERCHAN_TITLE = "${serverchanTitle.value || ''}"\n`
  luaConfig += `SERVERCHAN_API = "${serverchanApi.value || ''}"\n\n`

  luaConfig += `-- pushplus 通知配置, https://www.pushplus.plus/\n`
  luaConfig += `PUSHPLUS_TOKEN = "${pushplusToken.value || ''}"\n`
  luaConfig += `PUSHPLUS_TITLE = "${pushplusTitle.value || ''}"\n\n`

  luaConfig += `-- WxPusher 通知配置, https://wxpusher.zjiecode.com\n`
  luaConfig += `-- WXPUSHER_APPTOKEN = "你的AppToken"\n`
  luaConfig += `-- WXPUSHER_UIDS = "uid1,uid2"\n`
  luaConfig += `WXPUSHER_APPTOKEN = "${wxpusherAppToken.value || ''}"\n`
  luaConfig += `WXPUSHER_UIDS = "${wxpusherUids.value || ''}"\n`
  luaConfig += `WXPUSHER_SUMMARY = "${wxpusherSummary.value || ''}"\n`
  luaConfig += `WXPUSHER_CONTENT_TYPE = ${wxpusherContentType.value || 1}\n\n`

  luaConfig += `-- 定时查询流量间隔, 单位毫秒, 设置为 0 关闭 (建议检查 util_mobile.lua 文件中运营商号码和查询流量代码是否正确, 以免发错短信导致扣费)\n`
  luaConfig += `QUERY_TRAFFIC_INTERVAL = ${trafficQueryInterval.value || 0}\n`
  luaConfig += `-- 开机通知\nBOOT_NOTIFY = ${bootNotify.value !== undefined ? bootNotify.value : true}\n`
  luaConfig += `-- 通知内容追加更多信息\nNOTIFY_APPEND_MORE_INFO = ${appendMoreInfo.value !== undefined ? appendMoreInfo.value : true}\n`
  luaConfig += `-- 通知最大重发次数\nNOTIFY_RETRY_MAX = ${maxRetryCount.value || 100}\n`
  luaConfig += `-- 发送语音消息(仅企业微信支持)\nVOICE_SEND_ENABLE = ${voiceSendEnable.value !== undefined ? voiceSendEnable.value : false}\n\n`

  // 录音上传配置
  luaConfig += `-------------------------------------------------- 录音上传配置 --------------------------------------------------\n\n`
  luaConfig += `-- 是否启用录音功能\n`
  luaConfig += `record_enable = ${recordEnable.value !== undefined ? recordEnable.value : true}\n`
  luaConfig += `-- 录音格式: 3 = amrnb\n`
  luaConfig += `record_format = ${recordFormat.value || 3}\n`
  luaConfig += `-- 录音质量: 1-7\n`
  luaConfig += `record_quality = ${recordQuality.value || 1}\n`
  luaConfig += `-- 最大录音时间(秒)\n`
  luaConfig += `record_max_time = ${recordMaxTime.value || 50}\n`
  luaConfig += `-- 最大通话时间(秒)\n`
  luaConfig += `call_max_time = ${callMaxTime.value || 300}\n\n`
  luaConfig += `-- 腾讯云 COS / 阿里云 OSS / AWS S3 等对象存储上传地址, 以下为腾讯云 COS 示例, 请自行修改\n`
  luaConfig += `-- 存储桶需设置为: <私有读写>\n`
  luaConfig += `-- 存储桶 Policy 权限: <用户类型: 所有用户> <授权资源: xxx-123456/{录音文件目录}/*> <授权操作: PutObject,GetObject>\n`
  luaConfig += `-- 提示: 本项目未使用签名认证上传, 请勿泄露自己的地址及目录名\n`
  luaConfig += `-- 当注释掉或者为空则不启用上传, 并且会将来电动作配置项覆盖为: 接听 -> 接听后挂断\n`
  luaConfig += `UPLOAD_URL = "${uploadUrl.value || ''}"\n\n`

  // 短信来电配置
  luaConfig += `-------------------------------------------------- 短信来电配置 --------------------------------------------------\n\n`
  luaConfig += `-- 允许发短信控制设备的号码, 如果注释掉或者为空, 则禁止所有号码, 短信格式示例:\n`
  luaConfig += `-- 拨打电话 CALL,10086\n`
  luaConfig += `-- 发送短信 SMS,10086,查询流量\n`
  luaConfig += `-- 查询所有呼转状态 CCFC,?\n`
  luaConfig += `-- 设置无条件呼转 CCFC,18888888888\n`
  luaConfig += `-- 关闭所有呼转 CCFC,18888888888\n`
  luaConfig += `-- 切换卡槽优先级 SIMSWITCH\n`
  luaConfig += `-- SMS_CONTROL_WHITELIST_NUMBERS = { "18xxxxxxx", "18xxxxxxx", "18xxxxxxx" }\n`
  luaConfig += `SMS_CONTROL_WHITELIST_NUMBERS = { ${smsControlWhitelistNumbers.value && smsControlWhitelistNumbers.value.length > 0 ? smsControlWhitelistNumbers.value.map(n => `"${n}"`).join(', ') : ''} }\n\n`
  luaConfig += `-- 扬声器 TTS 播放短信内容, 0:关闭(默认), 1:仅验证码, 2:全部\n`
  luaConfig += `SMS_TTS = ${smsTts.value || 0}\n`
  luaConfig += `-- 电话接通后 TTS 语音内容, 在播放完后开始录音, 如果注释掉或者为空则播放 audio_pickup_record.amr 或 audio_pickup_hangup.amr 文件\n`
  luaConfig += `TTS_TEXT = "${ttsText.value || ''}"\n`
  luaConfig += `-- 来电动作, 0:无操作, 1:自动接听(默认), 2:挂断, 3:自动接听后挂断, 4:等待30秒后自动接听\n`
  luaConfig += `-- 无操作 / 等待30秒后自动接听, 可以长按 POWERKEY 来手动接听挂断电话\n`
  luaConfig += `CALL_IN_ACTION = ${callInAction.value || 0}\n\n`

  // 其他配置
  luaConfig += `-------------------------------------------------- 其他配置 --------------------------------------------------\n\n`
  luaConfig += `-- 扬声器音量, 0-7\n`
  luaConfig += `AUDIO_VOLUME = ${audioVolume.value || 1}\n`
  luaConfig += `-- 通话音量 0-7\n`
  luaConfig += `CALL_VOLUME = ${callVolume.value || 0}\n`
  luaConfig += `-- 麦克音量 0-7\n`
  luaConfig += `MIC_VOLUME = ${micVolume.value || 7}\n`
  luaConfig += `-- 开启 RNDIS 网卡\n`
  luaConfig += `RNDIS_ENABLE = ${rndisEnable.value !== undefined ? rndisEnable.value : false}\n`
  luaConfig += `-- 状态指示灯开关\n`
  luaConfig += `LED_ENABLE = ${ledEnable.value !== undefined ? ledEnable.value : true}\n`
  luaConfig += `-- SIM 卡 pin 码\n`
  luaConfig += `PIN_CODE = "${pinCode.value || ''}"\n`

  return luaConfig
}

// 保存高级配置
async function saveAdvancedConfig() {
  if (!selectedDevice.value?.imei) return
  
  try {
    // 添加确认对话框
    await showConfirmDialog({
      title: '确认保存',
      message: '确定要保存配置吗？设备将重启应用新配置。',
    })
  } catch {
    // 用户取消
    return
  }
  
  loading.value = true
  try {
    // 生成Lua配置文本
    const luaConfig = configToLua()
    
    console.log('生成的Lua配置长度:', luaConfig.length)
    console.log('生成的Lua配置（前500字符）:', luaConfig.substring(0, 500))
    console.log('请求参数:', {
      imei: selectedDevice.value.imei,
      task: 'set_config',
      configTextLength: luaConfig.length
    })
    
    const response = await request.post('/executeTask', {
      imei: selectedDevice.value.imei,
      task: 'set_config',
      configText: luaConfig,
    }) as any
    
    console.log('保存配置响应:', response)
    
    if (response.success) {
      showToast('保存成功')
      showAdvancedDialog.value = false
    } else {
      console.error('保存配置失败，响应:', response)
      showToast(response.message || '保存失败')
    }
  } catch (error: any) {
    console.error('保存配置异常:', error)
    console.error('错误详情:', {
      message: error?.message,
      response: error?.response,
      data: error?.response?.data
    })
    showToast(error?.response?.data?.message || error?.message || '保存失败')
  } finally {
    loading.value = false
  }
}

// 下发配置到其他设备
async function deployConfigToOtherDevices() {
  if (!selectedDevice.value?.imei) return
  
  try {
    // 获取设备列表
    const response = await request.get<Device[]>('/userPool')
    if (!Array.isArray(response)) {
      showToast('获取设备列表失败')
      return
    }
    
    // 过滤掉当前设备
    const otherDevices = response.filter((d: Device) => d.imei !== selectedDevice.value?.imei)
    
    if (otherDevices.length === 0) {
      showToast('没有其他设备可下发配置')
      return
    }
    
    // 显示设备选择对话框
    const selectedDevices = await showDeviceSelectionDialog(otherDevices)
    
    if (selectedDevices.length === 0) {
      showToast('未选择任何设备')
      return
    }
    
    // 确认下发
    await showConfirmDialog({
      title: '确认批量下发',
      message: `确定要将当前配置下发到 ${selectedDevices.length} 个设备吗？此操作会覆盖目标设备的配置。`,
    })
    
    loading.value = true
    
    // 生成Lua配置文本
    const luaConfig = configToLua()
    
    // 批量下发配置到选中的设备
    let successCount = 0
    let failCount = 0
    
    for (const targetDevice of selectedDevices) {
      try {
        console.log(`正在下发配置到设备: ${targetDevice.imei}`)
        const resp = await request.post('/executeTask', {
          imei: targetDevice.imei,
          task: 'set_config',
          configText: luaConfig,
        }) as any
        
        console.log(`设备 ${targetDevice.imei} 响应:`, resp)
        
        if (resp.success) {
          successCount++
          console.log(`设备 ${targetDevice.imei} 下发成功`)
        } else {
          failCount++
          console.error(`设备 ${targetDevice.imei} 下发失败:`, resp.message || '未知错误')
        }
      } catch (error) {
        failCount++
        console.error(`下发配置到设备 ${targetDevice.imei} 失败:`, error)
      }
    }
    
    if (failCount === 0) {
      showToast(`配置已成功下发到 ${successCount} 个设备`)
    } else {
      showToast(`配置下发完成: ${successCount} 成功, ${failCount} 失败`)
    }
    
  } catch (error: any) {
    console.error('下发配置失败:', error)
    if (error?.message !== '用户取消选择') {
      showToast('下发配置失败')
    }
  } finally {
    loading.value = false
  }
}

// 创建设备选择对话框
function showDeviceSelectionDialog(devices: Device[]): Promise<Device[]> {
  return new Promise((resolve, reject) => {
    // 创建设备选择项的HTML
    const deviceItems = devices.map(device => {
      const phoneText = device.phone ? `${device.phone} (${device.imei})` : `未设置手机号 (${device.imei})`
      return `
        <div style="margin-bottom: 10px; display: flex; align-items: center;">
          <input type="checkbox" id="device_${device.imei}" checked="checked" style="margin-right: 8px;">
          <label for="device_${device.imei}" style="flex: 1;">${phoneText}</label>
        </div>
      `
    }).join('')
    
    showDialog({
      title: '选择下发设备',
      message: `
        <div style="max-height: 300px; overflow-y: auto;">
          <div style="margin-bottom: 15px; font-weight: bold; color: #1989fa;">
            已选择 ${devices.length} 个设备（默认全选）
          </div>
          ${deviceItems}
        </div>
      `,
      width: '90%',
      showCancelButton: true,
      confirmButtonText: '确认下发',
      cancelButtonText: '取消',
      confirmButtonColor: '#3b82f6',
      cancelButtonColor: '#6b7280',
      allowHtml: true,
      beforeClose: (action) => {
        if (action === 'confirm') {
          // 在对话框关闭前获取选中的设备
          const selectedDevices: Device[] = []
          devices.forEach(device => {
            const checkbox = document.getElementById(`device_${device.imei}`) as HTMLInputElement
            if (checkbox && checkbox.checked) {
              selectedDevices.push(device)
            }
          })
          
          // 延迟resolve，确保在对话框关闭后执行
          setTimeout(() => {
            resolve(selectedDevices)
          }, 100)
          return true
        } else {
          // 用户点击取消
          setTimeout(() => {
            reject(new Error('用户取消选择'))
          }, 100)
          return true
        }
      }
    })
  })
}

// 切换目标设备选择
function toggleBatchDeployTarget(imei: string) {
  const index = batchDeployTargetDevices.value.indexOf(imei)
  if (index > -1) {
    batchDeployTargetDevices.value.splice(index, 1)
  } else {
    batchDeployTargetDevices.value.push(imei)
  }
}

// 全选/取消全选目标设备
function toggleAllBatchDeployTargets() {
  if (!batchDeploySourceDevice.value) return
  
  const availableDevices = deviceList.value.filter(d => d.imei !== batchDeploySourceDevice.value?.imei)
  
  if (batchDeployTargetDevices.value.length === availableDevices.length) {
    // 全部已选，则取消全选
    batchDeployTargetDevices.value = []
  } else {
    // 全选
    batchDeployTargetDevices.value = availableDevices.map(d => d.imei)
  }
}

// 执行批量下发配置
async function executeBatchDeploy() {
  if (!batchDeploySourceDevice.value) {
    showToast('请选择源设备')
    return
  }
  
  if (batchDeployTargetDevices.value.length === 0) {
    showToast('请至少选择一个目标设备')
    return
  }
  
  try {
    // 确认下发
    await showConfirmDialog({
      title: '确认批量下发',
      message: `确定要将设备 ${batchDeploySourceDevice.value.phone || batchDeploySourceDevice.value.imei} 的配置下发到 ${batchDeployTargetDevices.value.length} 个设备吗？此操作会覆盖目标设备的配置。`,
    })
    
    batchDeployLoading.value = true
    
    // 先获取源设备的配置
    const configResponse = await request.post('/executeTask', {
      imei: batchDeploySourceDevice.value.imei,
      task: 'get_config',
    }) as any
    
    if (!configResponse.success || !configResponse.result) {
      showToast('获取源设备配置失败')
      return
    }
    
    const sourceConfig = configResponse.result
    
    // 批量下发配置到目标设备
    let successCount = 0
    let failCount = 0
    
    for (const targetImei of batchDeployTargetDevices.value) {
      try {
        const resp = await request.post('/executeTask', {
          imei: targetImei,
          task: 'set_config',
          configText: sourceConfig,
        }) as any
        
        if (resp.success) {
          successCount++
        } else {
          failCount++
        }
      } catch (error) {
        failCount++
        console.error(`下发配置到设备 ${targetImei} 失败:`, error)
      }
    }
    
    if (failCount === 0) {
      showToast(`配置已成功下发到 ${successCount} 个设备`)
      showBatchDeployDialog.value = false
    } else {
      showToast(`配置下发完成: ${successCount} 成功, ${failCount} 失败`)
    }
    
  } catch (error: any) {
    console.error('批量下发配置失败:', error)
    if (error?.message !== '用户取消') {
      showToast('批量下发配置失败')
    }
  } finally {
    batchDeployLoading.value = false
  }
}

// 获取配置
async function fetchConfig() {
  if (!selectedDevice.value?.imei) return
  configLoading.value = true
  try {
    const response = await request.post('/executeTask', {
      imei: selectedDevice.value.imei,
      task: 'get_config',
    }) as any
    if (response.success) {
      configText.value = response.result || ''
      showToast('配置获取成功')
    }
    else {
      showToast('获取配置失败')
    }
  }
  catch (error) {
    showToast('获取配置失败')
  }
  finally {
    configLoading.value = false
  }
}

// 手动读取配置（别名）
const loadConfig = fetchConfig

// 保存配置
async function saveConfig() {
  if (!selectedDevice.value?.imei) return
  configLoading.value = true
  try {
    const response = await request.post('/executeTask', {
      imei: selectedDevice.value.imei,
      task: 'set_config',
      configText: configText.value,
    }) as any
    if (response && response.success) {
      showToast('保存成功')
      showConfigDialog.value = false
    }
    else {
      const errorMsg = response?.message || response?.error || '保存失败'
      showToast(errorMsg)
    }
  }
  catch (error: any) {
    const errorMsg = error?.response?.data?.message || error?.message || '保存失败'
    showToast(errorMsg)
  }
  finally {
    configLoading.value = false
  }
}

// 执行AT命令
async function executeAtCmd() {
  if (!selectedDevice.value?.imei) return
  if (!atCommand.value.trim()) {
    showToast('请输入AT命令')
    return
  }
  
  atLoading.value = true
  atResult.value = '执行中...\n'

  // 分割多条指令（按换行符分割）
  const commands = atCommand.value.split('\n').filter(cmd => cmd.trim() !== '')

  if (commands.length === 0) {
    atLoading.value = false
    return
  }

  // 顺序执行每条指令
  for (let i = 0; i < commands.length; i++) {
    const command = commands[i].trim()
    if (!command) continue

    // 显示当前执行的指令
    atResult.value += `$ ${command}\n`

    try {
      console.log('发送AT命令:', command)
      const response = await request.post('/executeTask', {
        imei: selectedDevice.value.imei,
        task: 'at_cmd',
        command: command,
      }) as any

      console.log('AT命令响应:', response)
      console.log('response.result:', response.result)
      console.log('response.data:', response.data)
      console.log('完整响应对象:', JSON.stringify(response, null, 2))

      if (response.success) {
        // 尝试多种方式获取结果
        let result = ''
        
        if (response.result) {
          result = response.result
        } else if (response.data) {
          // 尝试从data字段获取
          if (typeof response.data === 'string') {
            result = response.data
          } else if (response.data.result) {
            result = response.data.result
          } else if (response.data.response) {
            result = response.data.response
          } else {
            result = JSON.stringify(response.data, null, 2)
          }
        } else if (response.message) {
          result = response.message
        } else {
          result = '⚠️ 指令已发送，但未收到设备响应数据\n请查看浏览器控制台的完整响应日志'
        }
        
        atResult.value += result + '\n\n'
      }
      else {
        const errorMsg = `错误: ${response.message || '执行失败'}`
        atResult.value += errorMsg + '\n\n'
      }
    }
    catch (error: any) {
      console.error('AT命令执行错误:', error)
      const errorMsg = `错误: ${error?.response?.data?.message || error?.message || error?.toString() || '网络请求失败'}`
      atResult.value += errorMsg + '\n\n'
    }

    // 在指令之间添加短暂延迟
    if (i < commands.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 500))
    }
  }

  atLoading.value = false
  showToast('执行完成')
}

// 发送短信
async function sendSms() {
  if (!selectedDevice.value?.imei) return
  if (!smsPhone.value) {
    showToast('请输入收件人手机号')
    return
  }
  if (!smsContent.value) {
    showToast('请输入短信内容')
    return
  }

  smsLoading.value = true
  try {
    const response = await request.post<any>('/executeTask', {
      imei: selectedDevice.value.imei,
      task: 'send_sms',
      rcv_phone: smsPhone.value,
      content: smsContent.value,
    }) as any

    if (response && response.success) {
      showToast('发送成功')
      showSmsDialog.value = false
      // 清空输入
      smsPhone.value = ''
      smsContent.value = ''
    }
    else {
      const errorMsg = response?.message || '发送失败'
      showToast(errorMsg)
    }
  }
  catch (error: any) {
    const errorMsg = error?.response?.data?.message || error?.message || '发送失败'
    showToast(errorMsg)
    console.error('发送失败:', error)
  }
  finally {
    smsLoading.value = false
  }
}

// 从短信记录快速回复：点击一条短信自动切到发送页面并带入号码
function replySms(item: any) {
  const targetNumber = item?.sender || item?.receiver || item?.phone || item?.number
  if (!targetNumber) {
    showToast('无法识别号码')
    return
  }
  smsPhone.value = String(targetNumber)
  smsTab.value = 'send'
}

// 读取短信
async function loadSmsList() {
  if (!selectedDevice.value?.imei) return

  smsListLoading.value = true
  try {
    const response = await readSms(selectedDevice.value.imei) as any
    
    if (response && response.success) {
      smsList.value = response.result || []
      if (smsList.value.length === 0) {
        showToast('暂无短信记录')
      }
    } else {
      const errorMsg = response?.message || '读取短信失败'
      showToast(errorMsg)
      smsList.value = []
    }
  } catch (error: any) {
    const errorMsg = error?.response?.data?.message || error?.message || '读取短信失败'
    showToast(errorMsg)
    console.error('读取短信失败:', error)
    smsList.value = []
  } finally {
    smsListLoading.value = false
  }
}

// 加载录音列表
async function loadVoiceRecords() {
  voiceLoading.value = true
  try {
    const response = await getVoiceRecords() as any
    
    if (response && response.success) {
      voiceRecords.value = response.data || []
    } else {
      const errorMsg = response?.message || '获取录音列表失败'
      showToast(errorMsg)
      voiceRecords.value = []
    }
  } catch (error) {
    console.error('获取录音列表失败:', error)
    const errorMsg = error?.response?.data?.message || error?.message || '获取录音列表失败'
    showToast(errorMsg)
    voiceRecords.value = []
  } finally {
    voiceLoading.value = false
  }
}

// 语音转文字
async function handleTranscribe(record: any) {
  if (transcribingIds.value.has(record.id.toString())) {
    showToast('正在转换中，请稍候...')
    return
  }

  transcribingIds.value.add(record.id.toString())
  
  try {
    const response = await transcribeVoice(record.id.toString()) as any
    
    if (response && response.success) {
      showToast('语音转文字任务已开始')
      // 定期检查转换状态
      const checkInterval = setInterval(async () => {
        await loadVoiceRecords()
        const updatedRecord = voiceRecords.value.find(r => r.id === record.id)
        if (updatedRecord && (updatedRecord.status === 'completed' || updatedRecord.status === 'failed')) {
          clearInterval(checkInterval)
          transcribingIds.value.delete(record.id.toString())
          if (updatedRecord.status === 'completed') {
            showToast('语音转文字完成')
          } else {
            showToast('语音转文字失败')
          }
        }
      }, 3000)
    } else {
      const errorMsg = response?.message || '语音转文字失败'
      showToast(errorMsg)
      transcribingIds.value.delete(record.id.toString())
    }
  } catch (error: any) {
    const errorMsg = error?.response?.data?.message || error?.message || '语音转文字失败'
    showToast(errorMsg)
    console.error('语音转文字失败:', error)
    transcribingIds.value.delete(record.id.toString())
  }
}

// 再次语音转文字
async function handleReTranscribe(record: any) {
  if (transcribingIds.value.has(record.id.toString())) {
    showToast('正在转换中，请稍候...')
    return
  }

  // 确认对话框
  if (!confirm('确定要重新转换这条录音吗？这将覆盖之前的转换结果。')) {
    return
  }

  transcribingIds.value.add(record.id.toString())
  
  try {
    const response = await transcribeVoice(record.id.toString()) as any
    
    if (response && response.success) {
      showToast('重新转换任务已开始')
      // 定期检查转换状态
      const checkInterval = setInterval(async () => {
        await loadVoiceRecords()
        const updatedRecord = voiceRecords.value.find(r => r.id === record.id)
        if (updatedRecord && (updatedRecord.status === 'completed' || updatedRecord.status === 'failed')) {
          clearInterval(checkInterval)
          transcribingIds.value.delete(record.id.toString())
          if (updatedRecord.status === 'completed') {
            showToast('重新转换完成')
          } else {
            showToast('重新转换失败')
          }
        }
      }, 3000)
    } else {
      const errorMsg = response?.message || '重新转换失败'
      showToast(errorMsg)
      transcribingIds.value.delete(record.id.toString())
    }
  } catch (error: any) {
    const errorMsg = error?.response?.data?.message || error?.message || '重新转换失败'
    showToast(errorMsg)
    console.error('重新转换失败:', error)
    transcribingIds.value.delete(record.id.toString())
  }
}

// 删除录音记录
async function handleDeleteRecord(record: any) {
  // 确认对话框
  if (!confirm(`确定要删除这条录音记录吗？\n\n呼叫号码: ${record.caller_number}\n时间: ${record.timestamp}\n\n此操作不可撤销！`)) {
    return
  }

  try {
    const response = await deleteVoiceRecord(record.id.toString()) as any
    
    if (response && response.success) {
      showToast('录音记录已删除')
      // 重新加载录音列表
      await loadVoiceRecords()
    } else {
      const errorMsg = response?.message || '删除失败'
      showToast(errorMsg)
    }
  } catch (error: any) {
    const errorMsg = error?.response?.data?.message || error?.message || '删除失败'
    showToast(errorMsg)
    console.error('删除录音记录失败:', error)
  }
}

// 下载录音文件
async function handleDownload(record: any) {
  try {
    const response = await downloadVoiceRecord(record.id.toString()) as any
    
    // 创建下载链接
    const blob = new Blob([response], { type: 'audio/amr' })
    const url = window.URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = record.original_filename || `recording_${record.id}.amr`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    window.URL.revokeObjectURL(url)
    
    showToast('下载开始')
  } catch (error: any) {
    const errorMsg = error?.response?.data?.message || error?.message || '下载失败'
    showToast(errorMsg)
    console.error('下载失败:', error)
  }
}

// 获取状态文本
function getStatusText(status: string) {
  const statusMap = {
    'uploaded': '已上传',
    'transcribing': '转换中',
    'completed': '已完成',
    'failed': '转换失败'
  }
  return statusMap[status] || status
}

// 获取状态颜色
function getStatusColor(status: string) {
  const colorMap = {
    'uploaded': 'text-blue-600',
    'transcribing': 'text-orange-600',
    'completed': 'text-green-600',
    'failed': 'text-red-600'
  }
  return colorMap[status] || 'text-gray-600'
}

// 计算剩余保留时间
function getRemainingTime(expiresAt: string) {
  if (!expiresAt) return '未知'
  
  const now = new Date()
  const expires = new Date(expiresAt)
  const diff = expires.getTime() - now.getTime()
  
  if (diff <= 0) return '已过期'
  
  const days = Math.floor(diff / (1000 * 60 * 60 * 24))
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60))
  
  if (days > 0) {
    return `${days}天${hours}小时后过期`
  } else if (hours > 0) {
    return `${hours}小时后过期`
  } else {
    return '即将过期'
  }
}

// 获取剩余时间颜色
function getRemainingTimeColor(expiresAt: string) {
  if (!expiresAt) return 'text-gray-500'
  
  const now = new Date()
  const expires = new Date(expiresAt)
  const diff = expires.getTime() - now.getTime()
  
  if (diff <= 0) return 'text-red-600'
  if (diff <= 24 * 60 * 60 * 1000) return 'text-orange-600' // 24小时内
  if (diff <= 3 * 24 * 60 * 60 * 1000) return 'text-yellow-600' // 3天内
  return 'text-green-600'
}

// 手动清理过期录音
async function handleCleanupExpired() {
  try {
    await showConfirmDialog({
      title: '确认清理',
      message: '确定要清理所有过期的录音文件吗？此操作不可撤销。'
    })
    
    const response = await cleanupExpiredRecords() as any
    
    if (response && response.success) {
      showToast(`清理完成，删除了 ${response.data.deletedCount} 个录音文件`)
      await loadVoiceRecords()
    } else {
      const errorMsg = response?.message || '清理失败'
      showToast(errorMsg)
    }
  } catch (error: any) {
    if (error.message !== 'cancel') {
      const errorMsg = error?.response?.data?.message || error?.message || '清理失败'
      showToast(errorMsg)
      console.error('清理失败:', error)
    }
  }
}

// 批量转换录音
async function handleBatchTranscribe() {
  try {
    await showConfirmDialog({
      title: '确认批量转换',
      message: '确定要批量转换所有待转换的录音吗？这可能需要一些时间并产生API调用费用。'
    })
    
    const response = await batchTranscribeRecords() as any
    
    if (response && response.success) {
      showToast(`批量转换已开始，将处理 ${response.data.processed} 个录音`)
      // 定期刷新列表以显示转换进度
      const refreshInterval = setInterval(async () => {
        await loadVoiceRecords()
        const pendingCount = voiceRecords.value.filter(r => r.status === 'transcribing').length
        if (pendingCount === 0) {
          clearInterval(refreshInterval)
          showToast('批量转换已完成')
        }
      }, 5000)
    } else {
      const errorMsg = response?.message || '批量转换失败'
      showToast(errorMsg)
    }
  } catch (error: any) {
    if (error.message !== 'cancel') {
      const errorMsg = error?.response?.data?.message || error?.message || '批量转换失败'
      showToast(errorMsg)
      console.error('批量转换失败:', error)
    }
  }
}

// 手动输入IMEI（暂未使用，扫码功能开发中）
// function manualInputImei() {
//   closeScanDialog()
//   // 焦点回到输入框
//   showToast('请在输入框中输入IMEI')
// }

// 全选/取消全选设备
function toggleSelectAll() {
  if (selectedDevices.value.length === filteredDevices.value.length) {
    selectedDevices.value = []
  } else {
    selectedDevices.value = filteredDevices.value.map(d => d.imei)
  }
}

// 切换单个设备选择
function toggleDeviceSelect(imei: string) {
  const index = selectedDevices.value.indexOf(imei)
  if (index > -1) {
    selectedDevices.value.splice(index, 1)
  } else {
    selectedDevices.value.push(imei)
  }
}

// 打开编辑手机号弹窗
function editDevicePhone(device: Device) {
  editPhoneTarget.value = device
  const old = device.phone || ''
  editPhoneValue.value = old.startsWith('+86') ? old.substring(3) : old
  showEditPhoneDialog.value = true
}

// 确认保存手机号并写入到 SIM 卡
async function handleConfirmEditPhone() {
  if (!editPhoneTarget.value)
    return

  const phone = editPhoneValue.value.trim()

  if (!phone) {
    showToast('请输入手机号')
    return
  }

  if (!/^\d{11}$/.test(phone)) {
    showToast('手机号必须为11位数字')
    return
  }

  const fullNumber = `+86${phone}`
  const device = editPhoneTarget.value

  try {
    editPhoneLoading.value = true
    showToast('正在写入手机号...')

    // 1. 选择号码本
    await request.post('/executeTask', {
      imei: device.imei,
      task: 'at_cmd',
      command: 'AT+CPBS="ON"',
    }, {
      timeout: 30000,
    })

    // 2. 写入号码到位置1
    await request.post('/executeTask', {
      imei: device.imei,
      task: 'at_cmd',
      command: `AT+CPBW=1,"${fullNumber}",145`,
    }, {
      timeout: 30000,
    })

    const target = deviceList.value.find(d => d.imei === device.imei)
    if (target)
      target.phone = fullNumber

    showToast('手机号已更新，设备即将重启')
    showEditPhoneDialog.value = false

    // 3. 重启设备（后台发送，不阻塞界面）
    request.post('/executeTask', {
      imei: device.imei,
      task: 'at_cmd',
      command: 'AT+RESET',
    }, {
      timeout: 30000,
    }).catch((error: any) => {
      console.error('设备重启命令发送失败:', error)
    })
  } catch (error: any) {
    console.error('更新手机号失败:', error)
    showToast(error?.message || '更新手机号失败')
  } finally {
    editPhoneLoading.value = false
  }
}


// 批量重启设备
async function handleRestartDevices() {
  if (selectedDevices.value.length === 0) {
    showToast('请选择要重启的设备')
    return
  }
  
  try {
    await showConfirmDialog({
      title: '确认重启',
      message: `确定要重启 ${selectedDevices.value.length} 个设备吗？设备将执行AT+RESET命令进行重启。`,
    })
    
    restartLoading.value = true
    
    let successCount = 0
    let failCount = 0
    
    // 逐个重启设备
    for (const imei of selectedDevices.value) {
      try {
        const response = await request.post('/executeTask', {
          imei: imei,
          task: 'at_cmd',
          command: 'AT+RESET',
        }) as any
        
        if (response.success) {
          successCount++
        } else {
          failCount++
          console.error(`设备 ${imei} 重启失败:`, response.message)
        }
      } catch (error) {
        failCount++
        console.error(`设备 ${imei} 重启失败:`, error)
      }
      
      // 添加短暂延迟，避免请求过快
      await new Promise(resolve => setTimeout(resolve, 300))
    }
    
    if (failCount === 0) {
      showToast(`成功重启 ${successCount} 个设备`)
    } else {
      showToast(`成功 ${successCount} 个，失败 ${failCount} 个`)
    }
    
    selectedDevices.value = []
  } catch {
    // 用户取消
  } finally {
    restartLoading.value = false
  }
}
// 打开账号设置
function openAccountSettings() {
  accountForm.value = {
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
    email: userInfo.value?.email || '',
  }
  showAccountDialog.value = true
}

// 保存账号设置
async function handleSaveAccount() {
  // 验证密码
  if (accountForm.value.newPassword) {
    if (!accountForm.value.currentPassword) {
      showToast('请输入当前密码')
      return
    }
    if (accountForm.value.newPassword.length < 6) {
      showToast('新密码长度不能少于6位')
      return
    }
    if (accountForm.value.newPassword !== accountForm.value.confirmPassword) {
      showToast('两次密码输入不一致')
      return
    }
  }

  try {
    const response = await request.post('/admin/account/update', {
      currentPassword: accountForm.value.currentPassword,
      newPassword: accountForm.value.newPassword,
      email: accountForm.value.email,
    }) as any

    if (response.success) {
      showToast('保存成功')
      showAccountDialog.value = false
      
      // 更新本地用户信息
      if (userInfo.value) {
        userInfo.value.email = accountForm.value.email
        localStorage.setItem('userInfo', JSON.stringify(userInfo.value))
      }
      
      // 如果修改了密码，提示重新登录
      if (accountForm.value.newPassword) {
        showToast('密码已修改，请重新登录')
        setTimeout(() => {
          handleLogout()
        }, 1500)
      }
    } else {
      showToast(response.message || '保存失败')
    }
  } catch (error: any) {
    showToast(error?.message || '保存失败')
  }
}

// 退出登录
function handleLogout() {
  localStorage.removeItem('token')
  localStorage.removeItem('userInfo')
  router.push('/login')
}

// 格式化到期日期
function formatExpireDate(dateStr: string) {
  if (!dateStr) return ''
  const date = new Date(dateStr)
  const now = new Date()
  const diffDays = Math.ceil((date.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
  
  if (diffDays < 0) {
    return '已过期'
  } else if (diffDays === 0) {
    return '今天到期'
  } else if (diffDays <= 7) {
    return `${diffDays}天后到期`
  } else if (diffDays <= 30) {
    return `${diffDays}天后到期`
  } else {
    // 超过30天，显示具体到期日期
    const formattedDate = date.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' })
    return `到期: ${formattedDate}`
  }
}

// 获取设备列表
async function fetchDeviceList() {
  loading.value = true
  try {
    const response = await request.get<Device[]>('/userPool')
    if (Array.isArray(response)) {
      // 直接使用后端返回的设备字段，仅补充 is_whitelisted 默认值
      deviceList.value = response.map(device => ({
        ...device,
        is_whitelisted: device.is_whitelisted ?? false,
      }))
      console.log('✅ 获取设备列表成功，设备数量:', response.length)
    } else {
      deviceList.value = []
      console.warn('⚠️ 设备列表返回格式不正确:', response)
    }
  }
  catch (error: any) {
    showToast('获取设备列表失败')
    console.error('❌ 获取设备列表失败:', error)
    console.error('错误详情:', {
      message: error?.message,
      status: error?.response?.status,
      data: error?.response?.data
    })
    deviceList.value = []
  }
  finally {
    loading.value = false
  }
}

// 避免 TS6133 未使用报错：这些函数在模板中使用或保留扩展
void (commonAtCommands)
void (fetchDeviceStatus)
void (showDeviceDetail)
void (openVoiceTranscribe)
void (openSms)
void (openAtCmd)
void (openConfig)
void (openAdvanced)
void (loadConfig)
void (saveConfig)
void (executeAtCmd)
void (sendSms)
void (toggleSelectAll)

onMounted(async () => {
  await checkAuth()
  startPolling()
  startHeartbeatCheck()
  startDeviceStatusPolling()
  // 获取用户信息
  const userInfoStr = localStorage.getItem('userInfo')
  if (userInfoStr) {
    userInfo.value = JSON.parse(userInfoStr)
    console.log('📋 用户信息:', userInfo.value)
    console.log('📅 有效期:', userInfo.value?.expiresAt)
  }
  
  fetchDeviceList()
  // 加载Logo配置
  await loadLogoConfig()
})

// 组件卸载时清理定时器
onUnmounted(() => {
  // 清理设备列表轮询
  if (deviceRefreshTimer.value !== null) {
    clearInterval(deviceRefreshTimer.value)
    deviceRefreshTimer.value = null
  }
})
</script>

<template>
  <div class="min-h-screen bg-gray-50">
    <!-- 顶部导航栏 -->
    <div class="bg-white border-b border-gray-200">
      <div class="px-4 py-3 sm:container-responsive sm:py-4">
        <div class="flex items-center justify-between gap-3">
          <!-- 左侧：标题 -->
          <div class="flex items-center gap-2 flex-1 min-w-0">
            <div v-if="logoConfig.websiteLogo" class="w-8 h-8 sm:w-12 sm:h-12 flex-shrink-0">
              <img 
                :src="logoConfig.websiteLogo" 
                alt="Logo"
                class="w-full h-full object-contain"
                @error="(e) => { (e.target as HTMLImageElement).src = '/images/logo-default.svg' }"
              />
            </div>
            <div v-else class="i-carbon:devices text-lg sm:text-3xl text-blue-500 flex-shrink-0" />
            <div class="flex flex-col min-w-0">
              <h1 class="text-base sm:text-2xl font-semibold text-gray-900 truncate">{{ logoConfig.websiteTitle || '设备管理系统' }}</h1>
              <div class="flex items-center gap-2 text-xs sm:hidden">
                <span class="text-gray-500 truncate">{{ userInfo?.username || 'Guest' }}</span>
                <span v-if="userInfo?.expiresAt" class="flex items-center gap-0.5 text-orange-600 font-medium flex-shrink-0">
                  <div class="i-carbon:time text-[10px] sm:text-xs" />
                  {{ formatExpireDate(userInfo.expiresAt) }}
                </span>
              </div>
            </div>
          </div>
          
          <!-- 右侧：操作按钮 -->
          <div class="flex items-center gap-1.5 sm:gap-3 flex-shrink-0">
            <!-- 管理控制台按钮改为账号设置弹窗入口（单用户模式） -->
            <button
              v-if="userInfo?.role === 'admin'"
              @click="openAccountSettings"
              class="p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
              title="账号设置"
            >
              <div class="i-carbon:user-admin text-lg sm:text-xl" />
            </button>
            
            <!-- 账号设置按钮 -->
            <button
              v-if="userInfo && userInfo.role !== 'admin'"
              @click="openAccountSettings"
              class="flex items-center gap-1.5 px-3 py-2 text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
              title="账号设置"
            >
              <div class="i-carbon:user-settings text-base sm:text-lg" />
              <span class="text-sm font-medium hidden sm:inline">账号设置</span>
            </button>
            
            <!-- 用户信息（仅桌面端显示） -->
            <div class="hidden lg:flex items-center gap-2 px-3 py-1.5 bg-gray-50 rounded-lg">
              <div class="i-carbon:user-avatar text-base sm:text-lg text-gray-500" />
              <div class="flex flex-col">
                <div class="flex items-center gap-2">
                  <span class="text-sm font-medium text-gray-700">{{ userInfo?.name || userInfo?.username }}</span>
                  <span
                    v-if="userInfo?.role"
                    class="px-2 py-0.5 text-xs rounded-full"
                    :class="userInfo.role === 'admin' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'"
                  >
                    {{ userInfo.role === 'admin' ? '管理员' : '用户' }}
                  </span>
                </div>
                <div v-if="userInfo?.expiresAt" class="flex items-center gap-1 mt-0.5">
                  <div class="i-carbon:time text-[10px] sm:text-xs text-orange-600" />
                  <span class="text-xs font-medium text-orange-600">
                    {{ formatExpireDate(userInfo.expiresAt) }}
                  </span>
                </div>
              </div>
            </div>
            
            <!-- 退出登录按钮 -->
            <button
              @click="handleLogout"
              class="p-2 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
              title="退出登录"
            >
              <div class="i-carbon:logout text-lg sm:text-xl" />
            </button>
          </div>
        </div>
      </div>
    </div>

    

    <!-- 统计卡片 -->
    <div class="px-4 py-3 sm:container-responsive sm:py-5">
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-2 gap-2 sm:gap-4">
        <!-- 在线设备 -->
        <div class="bg-white p-3 sm:p-6 border border-gray-200 rounded-lg sm:rounded-xl shadow-sm">
          <div class="flex-between flex-col sm:flex-row gap-2 sm:gap-0">
            <div class="w-full sm:w-auto">
              <p class="text-xs sm:text-base text-gray-500 mb-1 sm:mb-3 font-medium">在线设备</p>
              <p class="text-2xl sm:text-4xl font-bold text-gray-900">{{ stats.online }}</p>
              <p class="text-xs sm:text-sm text-gray-400 mt-1 sm:mt-2 hidden sm:block">最近在线: {{ stats.total > 0 ? '21:56' : '-' }}</p>
            </div>
            <div class="w-8 h-8 sm:w-16 sm:h-16 rounded bg-green-50 flex-center">
              <div class="i-carbon:wifi text-xl sm:text-4xl text-green-500" />
            </div>
          </div>
        </div>

      

        <div
          class="bg-white p-3 sm:p-6 border border-gray-200 rounded-lg sm:rounded-xl shadow-sm"
        >
          <div class="flex-between flex-col sm:flex-row gap-2 sm:gap-0">
            <div class="w-full sm:w-auto">
              <p class="text-xs sm:text-base text-gray-500 mb-1 sm:mb-3 font-medium">批量下发配置</p>
              <p class="text-2xl sm:text-4xl font-bold text-gray-900">{{ selectedDevices.length || stats.total }}</p>
              <p class="text-xs sm:text-sm text-gray-400 mt-1 sm:mt-2 hidden sm:block">
                已选设备优先，未选则对全部设备
              </p>
            </div>
            <button
              class="w-10 h-10 sm:w-16 sm:h-16 rounded bg-blue-500 hover:bg-blue-600 transition-colors flex-center disabled:opacity-60 disabled:cursor-not-allowed"
              @click="showBatchDeployDialog = true"
              :disabled="stats.total === 0"
              title="批量下发配置"
            >
              <div class="i-carbon:deploy text-base sm:text-4xl text-white" />
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- 设备列表区域 -->
    <div class="px-4 pb-4 sm:container-responsive sm:pb-6">
      <div class="bg-white border border-gray-200 rounded-xl shadow-sm">
        <!-- 列表头部 -->
        <div class="px-4 py-4 sm:px-6 sm:py-5 border-b border-gray-200">
          <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
            <div class="flex items-center gap-2 sm:gap-3">
              <h2 class="text-lg sm:text-xl font-semibold text-gray-900">设备列表</h2>
              <span class="text-sm sm:text-base text-gray-500">{{ stats.total }} 台</span>
            </div>
            <div class="flex items-center gap-2 sm:gap-3 flex-wrap">
              <div class="relative flex-1 sm:flex-initial">
                <input 
                  v-model="searchQuery"
                  type="text"
                  placeholder="搜索IMEI或手机号"
                  class="w-full sm:w-80 pl-11 pr-4 py-2.5 text-base border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
                <div class="i-carbon:search absolute left-3.5 top-1/2 transform -translate-y-1/2 text-gray-400 text-lg sm:text-xl" />
              </div>
           
              <button 
                class="px-3 py-2 sm:px-5 sm:py-2.5 bg-gray-500 text-white text-sm sm:text-base font-medium hover:bg-gray-600 transition-colors flex items-center gap-1.5 sm:gap-2 whitespace-nowrap rounded-lg"
                @click="fetchDeviceList"
                :disabled="loading"
              >
                <div class="i-carbon:renew text-base sm:text-xl" :class="{ 'animate-spin': loading }" />
                <span class="hidden sm:inline">刷新</span>
              </button>
              <!-- 单用户模式：移除批量加入白名单按钮 -->
              <button 
                v-if="selectedDevices.length > 0"
                class="px-3 py-2 sm:px-5 sm:py-2.5 bg-green-500 text-white text-sm sm:text-base font-medium hover:bg-green-600 transition-colors flex items-center gap-1.5 sm:gap-2 whitespace-nowrap rounded-lg"
                @click="handleRestartDevices"
                :disabled="restartLoading"
              >
                <div class="i-carbon:restart text-base sm:text-xl" />
                <span class="hidden sm:inline">重启 ({{ selectedDevices.length }})</span>
                <span class="sm:hidden">重启</span>
              </button>
             
            </div>
          </div>
        </div>

        <!-- 加载状态 -->
        <div v-if="loading" class="flex-center py-16">
          <div class="i-carbon:loading animate-spin text-3xl text-gray-400" />
        </div>
<!-- ... -->
        
        <div v-else-if="filteredDevices.length > 0">
          <!-- 移动端卡片列表 -->
          <div class="md:hidden">
            <div class="divide-y divide-gray-200">
              <div
                v-for="device in sortedDevices"
                :key="device.imei"
                class="p-4 hover:bg-gray-50 active:bg-gray-100 transition-colors cursor-pointer"
                @click="showManage(device)"
              >
                <div class="flex items-start gap-3">
                  <!-- 选择框 -->
                  <input
                    type="checkbox"
                    class="mt-1 w-4 h-4 rounded border-gray-300 cursor-pointer flex-shrink-0"
                    :checked="selectedDevices.includes(device.imei)"
                    @change="toggleDeviceSelect(device.imei)"
                    @click.stop
                  />

                  <!-- 设备信息 -->
                  <div class="flex-1 min-w-0 space-y-2">
                    <!-- 第一行：IMEI / 手机号 / 在线状态 -->
                    <div class="flex items-center justify-between gap-2">
                      <div class="flex flex-col gap-1 min-w-0">
                        <div class="flex items-center gap-2 min-w-0">
                          <span class="font-mono text-sm font-semibold text-gray-900 truncate">{{ device.imei }}</span>
                          <span class="text-gray-400">|</span>
                          <button
                            type="button"
                            class="text-sm text-gray-700 font-medium truncate underline decoration-dotted"
                            @click.stop="editDevicePhone(device)"
                          >
                            {{ device.phone || '未设置' }}
                          </button>
                        </div>
                        
                      </div>
                      <span
                        class="text-xs font-medium px-2 py-0.5 rounded-full"
                        :class="device.connected ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'"
                      >
                        {{ device.connected ? '在线' : '离线' }}
                      </span>
                    </div>

                    <!-- 温度 / 信号 / 电压 / 运行时长 单元格 -->
                    <div class="flex flex-wrap items-center gap-2 text-xs">
                      <span class="inline-flex items-center px-2 py-0.5 rounded bg-blue-50 text-blue-700">
                        温度：{{ device.temperature != null ? `${device.temperature}°C` : '--' }}
                      </span>
                      <span class="inline-flex items-center px-2 py-0.5 rounded bg-green-50 text-green-700">
                        信号：{{ device.signal != null ? `${device.signal} dBm` : '--' }}
                      </span>
                      <span class="inline-flex items-center px-2 py-0.5 rounded bg-orange-50 text-orange-700">
                        电压：{{ device.voltage != null ? `${device.voltage}V` : '--' }}
                      </span>
                      <span class="inline-flex items-center px-2 py-0.5 rounded bg-purple-50 text-purple-700">
                        运行时长：{{ formatRuntime(device.runtime) }}
                      </span>
                    </div>

                    <!-- 最后在线时间 -->
                    <div class="text-xs text-gray-500">
                      最后在线：
                      <span>
                        {{ device.connected ? '当前在线' : (device.lastSeen ? new Date(device.lastSeen).toLocaleString() : '--') }}
                      </span>
                    </div>

                    
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div class="hidden md:block">
            <div class="overflow-x-auto">
              <table class="min-w-full divide-y divide-gray-200 text-sm">
                <thead class="bg-gray-50">
                  <tr>
                    <!-- 多选框列 -->
                    <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      <input
                        type="checkbox"
                        class="w-4 h-4 rounded border-gray-300 cursor-pointer"
                        :checked="selectedDevices.length === filteredDevices.length && filteredDevices.length > 0"
                        @change="toggleSelectAll"
                      />
                    </th>
                    <!-- IMEI -->
                    <th
                      class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer"
                      @click="toggleSort('imei')"
                    >
                      IMEI
                    </th>
                    <!-- 手机号 -->
                    <th
                      class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer"
                      @click="toggleSort('phone')"
                    >
                      手机号
                    </th>
                    <!-- 状态 -->
                    <th
                      class="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer"
                      @click="toggleSort('connected')"
                    >
                      状态
                    </th>
                    <!-- 运行时长 -->
                    <th
                      class="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer"
                      @click="toggleSort('runtime')"
                    >
                      运行时长
                    </th>
                    <!-- 设备温度 -->
                    <th
                      class="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer"
                      @click="toggleSort('temperature')"
                    >
                      设备温度
                    </th>
                    <!-- 运营商 -->
                    <th
                      class="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer"
                      @click="toggleSort('operator')"
                    >
                      运营商
                    </th>
                    <!-- 信号强度 -->
                    <th
                      class="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer"
                      @click="toggleSort('signal')"
                    >
                      信号强度
                    </th>
                    <!-- 设备电压 -->
                    <th
                      class="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer"
                      @click="toggleSort('voltage')"
                    >
                      设备电压
                    </th>
                    <!-- 系统版本 -->
                    <th
                      class="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer"
                      @click="toggleSort('ver')"
                    >
                      系统版本
                    </th>
                    <!-- IP 地址 -->
                    <th
                      class="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer"
                      @click="toggleSort('ip')"
                    >
                      IP地址
                    </th>
                    <!-- 操作 -->
                    <th class="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">操作</th>
                  </tr>
                </thead>
                <tbody class="bg-white divide-y divide-gray-100">
                  <tr
                    v-for="device in sortedDevices"
                    :key="device.imei"
                    class="hover:bg-gray-50"
                  >
                    <!-- 多选框 -->
                    <td class="px-4 py-3">
                      <input
                        type="checkbox"
                        class="w-4 h-4 rounded border-gray-300 cursor-pointer"
                        :checked="selectedDevices.includes(device.imei)"
                        @change="toggleDeviceSelect(device.imei)"
                      />
                    </td>
                    <!-- IMEI -->
                    <td class="px-4 py-3 font-mono text-sm font-semibold text-gray-900">
                      {{ device.imei }}
                    </td>
                    <!-- 手机号，可编辑 -->
                    <td class="px-4 py-3">
                      <button
                        type="button"
                        class="text-xs text-gray-700 underline decoration-dotted"
                        @click.stop="editDevicePhone(device)"
                      >
                        {{ device.phone || '未设置' }}
                      </button>
                    </td>
                    <!-- 状态 -->
                    <td class="px-4 py-3 text-center">
                      <span
                        class="inline-flex items-center justify-center px-2 py-0.5 rounded-full text-xs font-medium"
                        :class="device.connected ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'"
                      >
                        {{ device.connected ? '在线' : '离线' }}
                      </span>
                    </td>
                    <!-- 运行时长 -->
                    <td class="px-4 py-3 text-center text-xs text-gray-700">
                      {{ formatRuntime(device.runtime) }}
                    </td>
                    <!-- 设备温度 -->
                    <td class="px-4 py-3 text-center">
                      <span class="inline-flex items-center justify-center px-2 py-0.5 rounded text-xs font-medium bg-blue-50 text-blue-700">
                        {{ device.temperature != null ? `${device.temperature}°C` : 'N/A' }}
                      </span>
                    </td>
                    <!-- 运营商 -->
                    <td class="px-4 py-3 text-center text-xs text-gray-700">
                      {{ device.operator || 'N/A' }}
                    </td>
                    <!-- 信号强度 -->
                    <td class="px-4 py-3 text-center">
                      <span class="inline-flex items-center justify-center px-2 py-0.5 rounded text-xs font-medium bg-green-50 text-green-700">
                        {{ device.signal != null ? `${device.signal} dBm` : 'N/A' }}
                      </span>
                    </td>
                    <!-- 设备电压 -->
                    <td class="px-4 py-3 text-center">
                      <span class="inline-flex items-center justify-center px-2 py-0.5 rounded text-xs font-medium bg-orange-50 text-orange-700">
                        {{ device.voltage != null ? `${device.voltage}V` : 'N/A' }}
                      </span>
                    </td>
                    <!-- 系统版本 -->
                    <td class="px-4 py-3 text-center text-xs text-gray-700">
                      {{ device.ver || 'N/A' }}
                    </td>
                    <!-- IP 地址 -->
                    <td class="px-4 py-3 text-center text-xs text-gray-700">
                      {{ device.ip || '--' }}
                    </td>
                    <!-- 操作 -->
                    <td class="px-4 py-3 text-right">
                      <div class="flex items-center justify-end gap-2">
                        <button
                          type="button"
                          class="px-2 py-1 text-xs rounded border border-blue-500 text-blue-600 hover:bg-blue-50"
                          @click="showManage(device)"
                        >
                          管理
                        </button>
                      </div>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 设备管理弹窗（统一入口） -->
    <van-popup 
      v-model:show="showManageDialog" 
      position="center" 
      round
      :style="{ width: '90%', maxWidth: '500px', background: 'rgba(255, 255, 255, 0.85)', backdropFilter: 'blur(20px)' }"
    >
      <div class="p-6 backdrop-blur-xl bg-white/85" v-if="selectedDevice">
        <div class="flex-between mb-6">
          <h3 class="text-xl font-semibold text-gray-900">设备管理</h3>
          <button @click="showManageDialog = false" class="text-gray-400 hover:text-gray-600">
            <div class="i-carbon:close text-2xl" />
          </button>
        </div>
        
        <div class="mb-4 p-4 bg-gray-50 rounded-lg">
          <div class="flex items-center gap-2 mb-2">
            <div class="i-carbon:chip text-lg text-gray-600" />
            <span class="font-mono text-sm text-gray-900">{{ selectedDevice.imei }}</span>
          </div>
          <div class="flex items-center gap-2">
            <div class="i-carbon:phone text-lg text-gray-600" />
            <button
              v-if="selectedDevice"
              type="button"
              class="text-sm text-gray-700 underline decoration-dotted"
              @click="editDevicePhone(selectedDevice)"
            >
              {{ selectedDevice.phone || '未设置' }}
            </button>
            <span 
              class="ml-auto inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium"
              :class="selectedDevice.connected ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'"
            >
              {{ selectedDevice.connected ? '在线' : '离线' }}
            </span>
          </div>
        </div>
        
        <div class="grid grid-cols-2 gap-3">
          <button 
            class="p-4 border border-gray-200 hover:border-blue-500 hover:bg-blue-50 transition-all rounded-lg flex flex-col items-center gap-2"
            @click="showManageDialog = false; openAtCmd()"
          >
            <div class="i-carbon:terminal text-3xl text-blue-500" />
            <span class="text-base font-medium text-gray-900">AT命令</span>
            <span class="text-xs text-gray-500">远程执行指令</span>
          </button>
          
          <button 
            class="p-4 border border-gray-200 hover:border-blue-500 hover:bg-blue-50 transition-all rounded-lg flex flex-col items-center gap-2"
            @click="showManageDialog = false; openConfig()"
          >
            <div class="i-carbon:settings text-3xl text-blue-500" />
            <span class="text-base font-medium text-gray-900">配置管理</span>
            <span class="text-xs text-gray-500">修改设备配置</span>
          </button>
          
          <button 
            class="p-4 border border-gray-200 hover:border-blue-500 hover:bg-blue-50 transition-all rounded-lg flex flex-col items-center gap-2"
            @click="showManageDialog = false; openSms()"
          >
            <div class="i-carbon:chat text-3xl text-blue-500" />
            <span class="text-base font-medium text-gray-900">短信管理</span>
            <span class="text-xs text-gray-500">发送和读取短信</span>
          </button>
          
          <button 
            v-if="userPermissions.voice_transcribe"
            class="p-4 border border-gray-200 hover:border-blue-500 hover:bg-blue-50 transition-all rounded-lg flex flex-col items-center gap-2"
            @click="showManageDialog = false; openVoiceTranscribe(selectedDevice)"
          >
            <div class="i-carbon:microphone text-3xl text-blue-500" />
            <span class="text-base font-medium text-gray-900">语音转文字</span>
            <span class="text-xs text-gray-500">录音识别与管理</span>
          </button>
          
          
          
          <button 
            class="p-4 border border-gray-200 hover:border-blue-500 hover:bg-blue-50 transition-all rounded-lg flex flex-col items-center gap-2"
            @click="showManageDialog = false; openAdvanced()"
          >
            <div class="i-carbon:tool-box text-3xl text-blue-500" />
            <span class="text-base font-medium text-gray-900">高级配置</span>
            <span class="text-xs text-gray-500">更多设置选项</span>
          </button>
        </div>
        
        <div class="mt-6">
          <button 
            class="w-full px-4 py-2.5 bg-white border border-gray-300 text-gray-700 text-base font-medium hover:bg-gray-50 transition-colors rounded-lg"
            @click="showManageDialog = false"
          >
            关闭
          </button>
        </div>
      </div>
    </van-popup>

    

    <!-- 短信管理弹窗 -->
    <van-popup
      v-model:show="showSmsDialog"
      position="center"
      round
      :style="{ width: '95%', maxWidth: '480px', maxHeight: '80vh' }"
    >
      <div class="p-4 space-y-4">
        <div class="flex items-center justify-between">
          <div>
            <div class="text-xs text-gray-500 mb-1">当前设备</div>
            <div class="font-mono text-sm font-semibold text-gray-900">{{ selectedDevice?.imei || '未知设备' }}</div>
            <div class="text-xs text-gray-500 mt-0.5">{{ selectedDevice?.phone || '未设置手机号' }}</div>
          </div>
          <button class="p-2 text-gray-400 hover:text-gray-600" @click="showSmsDialog = false">
            <div class="i-carbon:close text-xl" />
          </button>
        </div>

        <van-tabs v-model:active="smsTab" type="card" class="text-sm">
          <van-tab title="发送短信" name="send">
            <div class="space-y-3 mt-2">
              <van-field
                v-model="smsPhone"
                label="手机号"
                placeholder="请输入接收号码"
                type="tel"
                clearable
              />
              <van-field
                v-model="smsContent"
                type="textarea"
                rows="3"
                label="内容"
                placeholder="请输入短信内容"
              />
              <van-button
                block
                type="primary"
                :loading="smsLoading"
                @click="sendSms"
              >
                发送短信
              </van-button>
            </div>
          </van-tab>

          <van-tab title="读取短信" name="read">
            <div class="mt-2 space-y-3">
              <div class="flex justify-between items-center">
                <span class="text-xs text-gray-500">短信列表</span>
                <van-button size="small" type="primary" @click="loadSmsList" :loading="smsListLoading">
                  刷新
                </van-button>
              </div>
              <div class="border rounded-lg max-h-64 overflow-y-auto">
                <div v-if="smsListLoading" class="flex items-center justify-center py-8 text-gray-400 text-sm">
                  加载中...
                </div>
                <div v-else-if="smsList.length === 0" class="flex items-center justify-center py-8 text-gray-400 text-sm">
                  暂无短信记录
                </div>
                <div v-else class="divide-y divide-gray-100">
                  <div
                    v-for="(item, index) in smsList"
                    :key="index"
                    class="p-3 space-y-1 cursor-pointer hover:bg-gray-50"
                    @click="replySms(item)"
                  >
                    <div class="flex justify-between text-xs text-gray-500">
                      <span>{{ item.sender || item.receiver || item.phone || item.number || '未知号码' }}</span>
                      <span>{{ item.datetime || item.time || item.date || '' }}</span>
                    </div>
                    <div class="text-sm text-gray-800 whitespace-pre-wrap">{{ item.content || item.text || '' }}</div>
                  </div>
                </div>
              </div>
            </div>
          </van-tab>
        </van-tabs>
      </div>
    </van-popup>

    <!-- 编辑手机号弹窗 -->
    <van-popup
      v-model:show="showEditPhoneDialog"
      position="center"
      round
      :style="{ width: '90%', maxWidth: '420px', maxHeight: '80vh', background: 'rgba(255, 255, 255, 0.95)', backdropFilter: 'blur(16px)' }"
    >
      <div class="p-5 space-y-4">
        <div class="flex items-center justify-between">
          <div>
            <h3 class="text-base font-semibold text-gray-900">编辑设备手机号</h3>
            <p class="mt-1 text-xs text-gray-500">手机号将写入设备 SIM 卡号码本位置 1，并自动重启设备生效。</p>
          </div>
          <button class="p-1 text-gray-400 hover:text-gray-600" @click="showEditPhoneDialog = false" :disabled="editPhoneLoading">
            <div class="i-carbon:close text-xl" />
          </button>
        </div>

        <div class="space-y-2">
          <div class="flex items-center gap-2 text-xs text-gray-500">
            <span class="inline-flex items-center px-2 py-0.5 rounded-full bg-gray-100 text-gray-700">
              <span class="font-mono mr-1">IMEI</span>{{ editPhoneTarget?.imei || '未知设备' }}
            </span>
          </div>
          <van-field
            v-model="editPhoneValue"
            type="tel"
            maxlength="11"
            label="手机号"
            placeholder="请输入 11 位手机号，不含 +86 前缀"
            :disabled="editPhoneLoading"
            clearable
          />
          
        </div>

        <div class="flex gap-3 pt-2">
          <button
            class="flex-1 px-4 py-2.5 bg-white border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
            @click="showEditPhoneDialog = false"
            :disabled="editPhoneLoading"
          >
            取消
          </button>
          <button
            class="flex-1 px-4 py-2.5 bg-blue-500 text-white text-sm font-semibold rounded-lg hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            @click="handleConfirmEditPhone"
            :disabled="editPhoneLoading"
          >
            <div v-if="editPhoneLoading" class="i-carbon:loading text-base animate-spin" />
            <span>{{ editPhoneLoading ? '写入中...' : '保存并下发' }}</span>
          </button>
        </div>
      </div>
    </van-popup>

    <!-- AT 命令弹窗 -->
    <van-popup
      v-model:show="showAtCmdDialog"
      position="center"
      round
      :style="{ width: '95%', maxWidth: '480px', maxHeight: '80vh' }"
    >
      <div class="p-4 space-y-3">
        <div class="flex items-center justify-between">
          <div>
            <div class="text-xs text-gray-500 mb-1">当前设备</div>
            <div class="font-mono text-sm font-semibold text-gray-900">{{ selectedDevice?.imei || '未知设备' }}</div>
          </div>
          <button class="p-2 text-gray-400 hover:text-gray-600" @click="showAtCmdDialog = false">
            <div class="i-carbon:close text-xl" />
          </button>
        </div>

        <van-field
          v-model="atCommand"
          label="AT命令"
          placeholder="例如：AT+CSQ"
          clearable
        />

        <!-- 常用 AT 指令快捷选择 -->
        <div class="mt-1 flex flex-wrap gap-2">
          <button
            v-for="item in commonAtCommands"
            :key="item.command"
            type="button"
            class="px-2 py-1 text-[11px] rounded border border-gray-300 text-gray-700 hover:bg-gray-50 flex items-center gap-1"
            @click="atCommand = item.command"
          >
            <span class="font-mono">{{ item.command }}</span>
            <span class="text-gray-400">{{ item.desc }}</span>
          </button>
        </div>

        <van-button
          block
          type="primary"
          :loading="atLoading"
          @click="executeAtCmd"
        >
          执行命令
        </van-button>

        <div class="mt-2">
          <div class="text-xs text-gray-500 mb-1">返回结果</div>
          <div class="border rounded-lg bg-gray-50 p-2 max-h-48 overflow-y-auto text-xs font-mono whitespace-pre-wrap">
            {{ atResult || '暂无输出' }}
          </div>
        </div>
      </div>
    </van-popup>

    <!-- 配置管理弹窗（基础配置文本模式） -->
    <van-popup
      v-model:show="showConfigDialog"
      position="center"
      round
      :style="{ width: '95%', maxWidth: '900px', maxHeight: '85vh' }"
    >
      <div class="flex flex-col h-full max-h-[85vh]">
        <div class="flex items-center justify-between px-4 py-3 border-b border-gray-200">
          <div>
            <div class="text-sm font-semibold text-gray-900">配置管理</div>
            <div class="text-xs text-gray-500 mt-0.5">{{ selectedDevice?.imei }} · {{ selectedDevice?.phone || '未设置手机号' }}</div>
          </div>
          <button class="p-2 text-gray-400 hover:text-gray-600" @click="showConfigDialog = false">
            <div class="i-carbon:close text-xl" />
          </button>
        </div>

        <div class="flex-1 overflow-hidden flex flex-col">
          <div class="flex items-center justify-between px-4 py-2 border-b border-gray-100 bg-gray-50">
            <div class="space-x-2">
              <van-button size="small" type="primary" @click="fetchConfig" :loading="configLoading">
                读取配置
              </van-button>
              <van-button size="small" type="success" @click="saveConfig" :loading="configLoading">
                保存配置
              </van-button>
            </div>
            <span class="text-xs text-gray-400">直接编辑 Lua 配置文本，高级配置可在“高级配置”弹窗中使用图形界面</span>
          </div>
          <div class="flex-1 overflow-auto p-4">
            <textarea
              v-model="configText"
              class="w-full h-full min-h-[300px] border border-gray-300 rounded-lg text-xs font-mono p-3 focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="设备配置内容 (Lua)"
            />
          </div>
        </div>
      </div>
    </van-popup>

    <!-- 语音转文字弹窗 -->
    <van-popup 
      v-model:show="showVoiceDialog" 
      position="center" 
      round
      :style="{ width: '95%', maxWidth: '900px', maxHeight: '85vh', background: 'rgba(255, 255, 255, 0.85)', backdropFilter: 'blur(20px)' }"
    >
      <div class="p-6 backdrop-blur-xl bg-white/85">
        <div class="flex-between mb-6">
          <h3 class="text-xl font-semibold text-gray-900">语音转文字</h3>
          <button @click="showVoiceDialog = false" class="text-gray-400 hover:text-gray-600">
            <div class="i-carbon:close text-2xl" />
          </button>
        </div>
        
        <!-- 刷新按钮和清理按钮 -->
        <div class="flex justify-between mb-4">
          <div class="flex gap-2">
            <button 
              class="px-4 py-2 bg-red-500 text-white text-sm font-medium hover:bg-red-600 transition-colors rounded-lg flex items-center gap-2"
              @click="handleCleanupExpired"
            >
              <div class="i-carbon:trash-can text-lg" />
              <span>清理过期</span>
            </button>
            
            <button 
              v-if="isAdmin || userPermissions.voice_transcribe"
              class="px-4 py-2 bg-purple-500 text-white text-sm font-medium hover:bg-purple-600 transition-colors rounded-lg flex items-center gap-2"
              @click="handleBatchTranscribe"
            >
              <div class="i-carbon:document-multiple text-lg" />
              <span>批量转换</span>
            </button>
          </div>
          
          <button 
            class="px-4 py-2 bg-blue-500 text-white text-sm font-medium hover:bg-blue-600 transition-colors rounded-lg flex items-center gap-2"
            @click="loadVoiceRecords"
            :disabled="voiceLoading"
          >
            <div class="i-carbon:refresh text-lg" />
            <span>{{ voiceLoading ? '刷新中...' : '刷新列表' }}</span>
          </button>
        </div>
        
        <!-- 录音列表 -->
        <div class="border border-gray-200 rounded-lg max-h-96 overflow-y-auto">
          <div v-if="voiceLoading" class="flex-center py-12">
            <div class="i-carbon:loading animate-spin text-4xl text-blue-500" />
          </div>
          
          <div v-else-if="voiceRecords.length === 0" class="text-center py-12 text-gray-500">
            <div class="i-carbon:microphone text-4xl mb-2" />
            <span>暂无录音记录</span>
          </div>
          
          <div v-else class="divide-y divide-gray-200">
            <div 
              v-for="record in voiceRecords" 
              :key="record.id"
              class="p-4 hover:bg-gray-50 transition-colors"
            >
              <div class="flex justify-between items-start mb-3">
                <div class="flex items-center gap-3">
                  <div class="i-carbon:microphone text-blue-500 text-lg" />
                  <div>
                    <div class="font-medium text-gray-900">设备: {{ record.imei }}</div>
                    <div class="text-sm text-gray-500">呼叫: {{ record.caller_number }}</div>
                  </div>
                </div>
                <div class="text-right">
                  <div class="text-xs text-gray-500">{{ record.upload_time }}</div>
                  <div class="text-xs font-medium" :class="getStatusColor(record.status)">
                    {{ getStatusText(record.status) }}
                  </div>
                  <div class="text-xs font-medium mt-1" :class="getRemainingTimeColor(record.expires_at)">
                    {{ getRemainingTime(record.expires_at) }}
                  </div>
                </div>
              </div>
              
              <!-- 转换后的文字 -->
              <div v-if="record.transcribed_text" class="mb-3 p-3 bg-gray-50 rounded-lg">
                <div class="text-sm font-medium text-gray-700 mb-1">转换结果:</div>
                <div class="text-sm text-gray-600 whitespace-pre-wrap">{{ record.transcribed_text }}</div>
              </div>
              
              <!-- 操作按钮 -->
              <div class="flex gap-2 flex-wrap">
                <button 
                  v-if="record.status === 'uploaded' && (isAdmin || userPermissions.voice_transcribe)"
                  class="px-3 py-1.5 bg-blue-500 text-white text-xs font-medium hover:bg-blue-600 transition-colors rounded flex items-center gap-1"
                  @click="handleTranscribe(record)"
                  :disabled="transcribingIds.has(record.id.toString())"
                >
                  <div class="i-carbon:document-text text-sm" />
                  <span>{{ transcribingIds.has(record.id.toString()) ? '转换中...' : '转文字' }}</span>
                </button>
                
                <!-- 再次转换按钮 -->
                <button 
                  v-if="(record.status === 'completed' || record.status === 'failed') && (isAdmin || userPermissions.voice_transcribe)"
                  class="px-3 py-1.5 bg-orange-500 text-white text-xs font-medium hover:bg-orange-600 transition-colors rounded flex items-center gap-1"
                  @click="handleReTranscribe(record)"
                  :disabled="transcribingIds.has(record.id.toString())"
                >
                  <div class="i-carbon:reset text-sm" />
                  <span>{{ transcribingIds.has(record.id.toString()) ? '转换中...' : '再次转换' }}</span>
                </button>
                
                <!-- 删除按钮 -->
                <button 
                  v-if="isAdmin"
                  class="px-3 py-1.5 bg-red-500 text-white text-xs font-medium hover:bg-red-600 transition-colors rounded flex items-center gap-1"
                  @click="handleDeleteRecord(record)"
                >
                  <div class="i-carbon:trash-can text-sm" />
                  <span>删除</span>
                </button>
                
                <button 
                  class="px-3 py-1.5 bg-gray-500 text-white text-xs font-medium hover:bg-gray-600 transition-colors rounded flex items-center gap-1"
                  @click="handleDownload(record)"
                >
                  <div class="i-carbon:download text-sm" />
                  <span>下载</span>
                </button>
              </div>
            </div>
          </div>
        </div>
        
        <div class="mt-6">
          <button 
            class="w-full px-4 py-2.5 bg-white border border-gray-300 text-gray-700 text-base font-medium hover:bg-gray-50 transition-colors rounded-lg"
            @click="showVoiceDialog = false"
          >
            关闭
          </button>
        </div>
      </div>
    </van-popup>

    <!-- 高级配置弹窗 -->
    <van-popup 
      v-model:show="showAdvancedDialog" 
      position="center"
      round
      :style="{ width: '90%', maxWidth: '900px', maxHeight: '85vh' }"
      class="advanced-config-popup"
    >
      <div class="flex flex-col overflow-hidden" style="max-height: 85vh;">
        <!-- 头部 -->
        <div class="bg-gradient-to-r from-blue-500 to-blue-600" style="background: linear-gradient(to right, #3b82f6, #2563eb) !important;">
          <div class="flex-between px-6 py-4">
            <div class="flex items-center gap-2 text-white">
              <div class="i-carbon:settings-adjust text-2xl" />
              <h3 class="text-lg font-semibold text-white">高级配置</h3>
            </div>
            <button @click="showAdvancedDialog = false" class="text-white/80 hover:text-white transition-colors">
              <div class="i-carbon:close text-2xl" />
            </button>
          </div>
          <!-- 设备信息和读取配置按钮 -->
          <div class="px-6 pb-4">
            <div class="flex gap-3">
              <!-- 左侧：设备信息 -->
              <div class="flex-1 bg-white/95 backdrop-blur-sm rounded-lg p-3 space-y-2 border border-white shadow-md">
                <div class="flex items-center justify-between">
                  <div class="flex items-center gap-2">
                    <div class="i-carbon:phone text-blue-600 text-sm" />
                    <span class="text-xs font-medium" style="color: #4b5563 !important;">手机号</span>
                  </div>
                  <span class="text-xs font-semibold" style="color: #111827 !important;">{{ selectedDevice?.phone || '未知' }}</span>
                </div>
                <div class="h-px bg-gray-200" />
                <div class="flex items-center justify-between">
                  <div class="flex items-center gap-2">
                    <div class="i-carbon:chip text-blue-600 text-sm" />
                    <span class="text-xs font-medium" style="color: #4b5563 !important;">IMEI</span>
                  </div>
                  <span class="text-xs font-mono font-semibold" style="color: #111827 !important;">{{ selectedDevice?.imei }}</span>
                </div>
                <div class="h-px bg-gray-200" />
                <div class="flex items-center justify-between">
                  <div class="flex items-center gap-2">
                    <div class="i-carbon:connection-signal text-blue-600 text-sm" />
                    <span class="text-xs font-medium" style="color: #4b5563 !important;">状态</span>
                  </div>
                  <div class="flex items-center gap-1.5">
                    <div 
                      class="w-1.5 h-1.5 rounded-full"
                      :class="selectedDevice?.connected ? 'bg-green-500 animate-pulse shadow-lg shadow-green-500/50' : 'bg-red-500 shadow-lg shadow-red-500/50'"
                    />
                    <span class="text-xs font-semibold" :style="{ color: selectedDevice?.connected ? '#16a34a !important' : '#dc2626 !important' }">
                      {{ selectedDevice?.connected ? '在线' : '离线' }}
                    </span>
                  </div>
                </div>
              </div>
              
              <!-- 右侧：读取按钮 -->
              <div class="flex items-center">
                <van-button 
                  type="primary" 
                  size="normal"
                  class="!bg-gradient-to-r !from-blue-500 !to-blue-600 !border-none !h-full !px-4"
                  @click="fetchAdvancedConfig"
                >
                  <div class="flex flex-col items-center justify-center gap-1">
                    <div class="i-carbon:download text-xl" />
                    <span class="text-xs whitespace-nowrap">读取配置</span>
                  </div>
                </van-button>
              </div>
            </div>
          </div>
        </div>
        
        <!-- 标签页内容 -->
        <van-tabs v-model:active="advancedTab" class="flex-1 overflow-hidden" color="#3b82f6" title-active-color="#3b82f6">
          <!-- 通知配置 -->
          <van-tab title="通知配置" name="notification">
            <div class="p-5 space-y-4 overflow-y-auto bg-gray-50 pb-24" style="max-height: 60vh">
              <!-- 通知类型选择 -->
              <div class="bg-white p-4 rounded-lg shadow-sm border border-blue-100">
                <div class="flex items-center gap-2 mb-4">
                  <div class="i-carbon:notification text-blue-500 text-lg" />
                  <div class="text-sm font-semibold text-gray-800">选择通知方式</div>
                </div>
                
                <!-- 语音发送开关 -->
                <div class="mb-4 p-3 bg-blue-50 rounded-lg border border-blue-200">
                  <div class="flex items-center justify-between">
                    <div class="flex items-center gap-2">
                      <div class="i-carbon:microphone text-blue-600 text-lg" />
                      <div>
                        <div class="text-sm font-semibold text-gray-800">发送语音消息</div>
                        <div class="text-xs text-gray-500 mt-0.5">开启后将录音以语音形式发送到企业微信</div>
                      </div>
                    </div>
                    <van-switch v-model="voiceSendEnable" size="22" active-color="#3b82f6" />
                  </div>
                </div>
                
                <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                  <div 
                    v-for="option in notifyTypeOptions" 
                    :key="option.value"
                    @click="toggleNotifyType(option.value)"
                    class="flex items-center gap-2 p-3 rounded-lg border-2 transition-all cursor-pointer hover:shadow-md"
                    :class="notifyTypes.includes(option.value) 
                      ? 'border-blue-500 bg-blue-50' 
                      : 'border-gray-200 bg-white hover:border-blue-300'"
                  >
                    <div 
                      class="w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all flex-shrink-0"
                      :class="notifyTypes.includes(option.value) 
                        ? 'border-blue-500 bg-blue-500' 
                        : 'border-gray-300'"
                    >
                      <div v-if="notifyTypes.includes(option.value)" class="i-carbon:checkmark text-white text-xs" />
                    </div>
                    <div :class="option.icon" class="text-lg flex-shrink-0" :style="{ color: notifyTypes.includes(option.value) ? '#3b82f6' : '#6b7280' }" />
                    <span class="text-sm font-medium truncate" :class="notifyTypes.includes(option.value) ? 'text-blue-700' : 'text-gray-700'">
                      {{ option.label }}
                    </span>
                  </div>
                </div>
              </div>
              
              
              
              <!-- Gotify配置 -->
              <van-cell-group v-if="notifyTypes.includes('gotify')" inset title="Gotify">
                <van-field v-model="gotifyApi" label="API地址" placeholder="http://127.0.0.1:8080" />
                <van-field v-model="gotifyTitle" label="标题" placeholder="通知标题" />
                <van-field v-model="gotifyToken" label="应用Token" placeholder="应用Token" />
                <van-field v-model="gotifyClientToken" label="客户端Token" placeholder="客户端Token" />
                <van-field v-model="gotifyPriority" label="优先级 (0-10)" type="number" placeholder="5" />
              </van-cell-group>
              
              <!-- PushPlus配置 -->
              <van-cell-group v-if="notifyTypes.includes('pushplus')" inset title="PushPlus">
                <van-field v-model="pushplusToken" label="Token" placeholder="PushPlus Token" />
                <van-field v-model="pushplusTitle" label="标题" placeholder="通知标题" />
              </van-cell-group>

              <!-- WxPusher 配置 -->
              <van-cell-group v-if="notifyTypes.includes('wxpusher')" inset title="WxPusher">
                <van-field v-model="wxpusherAppToken" label="AppToken" placeholder="应用的 AppToken" />
                <van-field v-model="wxpusherUids" label="UID 列表" type="textarea" placeholder="多个 UID 用英文逗号分隔" />
                <van-field v-model="wxpusherSummary" label="摘要" placeholder="例如：来自 Air724UG 的通知" />
                <van-field v-model="wxpusherContentType" label="内容类型" type="number" placeholder="1" />
              </van-cell-group>
              
              <!-- Telegram配置 -->
              <van-cell-group v-if="notifyTypes.includes('telegram')" inset title="Telegram">
                <van-field v-model="telegramApi" label="Bot Token" placeholder="Bot Token" />
                <van-field v-model="telegramChatId" label="Chat ID" placeholder="Chat ID" />
              </van-cell-group>
              
              <!-- PushDeer配置 -->
              <van-cell-group v-if="notifyTypes.includes('pushdeer')" inset title="PushDeer">
                <van-field v-model="pushdeerKey" label="Push Key" placeholder="Push Key" />
                <van-field v-model="pushdeerApi" label="服务器地址" placeholder="https://api2.pushdeer.com" />
              </van-cell-group>
              
              <!-- Bark配置 -->
              <van-cell-group v-if="notifyTypes.includes('bark')" inset title="Bark">
                <van-field v-model="barkKey" label="设备Key" placeholder="设备Key" />
                <van-field v-model="barkApi" label="服务器地址" placeholder="https://api.day.app" />
              </van-cell-group>
              
              <!-- 钉钉配置 -->
              <van-cell-group v-if="notifyTypes.includes('dingtalk')" inset title="钉钉">
                <van-field v-model="dingtalkWebhook" label="Webhook地址" placeholder="Webhook地址" />
                <van-field v-model="dingtalkSecret" label="加签密钥" placeholder="加签密钥(可选)" />
              </van-cell-group>
              
              <!-- 飞书配置 -->
              <van-cell-group v-if="notifyTypes.includes('feishu')" inset title="飞书">
                <van-field v-model="feishuWebhook" label="Webhook地址" placeholder="Webhook地址" />
                <van-field label="签名密钥" placeholder="签名密钥(可选)" />
              </van-cell-group>
              
              <!-- 企业微信配置 -->
              <van-cell-group v-if="notifyTypes.includes('wecom')" inset title="企业微信">
                <van-field v-model="wecomWebhook" label="Webhook地址" placeholder="Webhook地址" />
              </van-cell-group>
              
              <!-- ServerChan配置 -->
              <van-cell-group v-if="notifyTypes.includes('serverchan')" inset title="ServerChan">
                <van-field v-model="serverchanApi" label="SendKey" placeholder="SendKey" />
              </van-cell-group>
              
              <!-- 自定义POST配置 -->
              <van-cell-group v-if="notifyTypes.includes('custom_post')" inset title="自定义POST">
                <van-field v-model="customPostUrl" label="POST地址" placeholder="https://example.com/api" />
                <van-field v-model="customPostContentType" label="请求头" type="textarea" placeholder='{"Content-Type": "application/json"}' />
              </van-cell-group>
              
              <!-- 企业微信应用配置 -->
              <van-cell-group v-if="notifyTypes.includes('wecom_app')" inset title="企业微信应用">
                <van-field v-model="wecomCorpid" label="企业ID" placeholder="企业ID" />
                <van-field v-model="wecomCorpsecret" label="应用密钥" placeholder="应用密钥" />
                <van-field v-model="wecomAgentid" label="应用ID" placeholder="应用ID" />
                <van-field v-model="wecomAppTouser" label="接收人" placeholder="@all表示全部" />
                <van-field name="wecomAppSafe" label="安全级别" label-class="!text-gray-700">
                  <template #input>
                    <van-radio-group v-model="wecomAppSafe" direction="horizontal">
                      <van-radio :name="0">普通</van-radio>
                      <van-radio :name="1">加密</van-radio>
                    </van-radio-group>
                  </template>
                </van-field>
              </van-cell-group>
              
              <!-- Pushover配置 -->
              <van-cell-group v-if="notifyTypes.includes('pushover')" inset title="Pushover">
                <van-field v-model="pushoverUserKey" label="User Key" placeholder="User Key" />
                <van-field v-model="pushoverApiToken" label="API Token" placeholder="API Token" />
                <van-field label="优先级 (-2到2)" type="number" placeholder="0" />
              </van-cell-group>
              
              <!-- Inotify配置 -->
              <van-cell-group v-if="notifyTypes.includes('inotify')" inset title="Inotify">
                <van-field v-model="inotifyApi" label="服务器地址" placeholder="https://inotify.example.com" />
                <van-field label="Token" placeholder="Token" />
              </van-cell-group>
              
              <!-- Next SMTP Proxy配置 -->
              <van-cell-group v-if="notifyTypes.includes('next-smtp-proxy')" inset title="Next SMTP Proxy">
                <van-field v-model="nextSmtpProxyHost" label="服务器地址" placeholder="smtp.example.com" />
                <van-field v-model="nextSmtpProxyPort" label="端口" type="number" placeholder="25" />
                <van-field v-model="nextSmtpProxyFormName" label="发件人" placeholder="sender@example.com" />
                <van-field v-model="nextSmtpProxyToEmail" label="收件人" placeholder="receiver@example.com" />
              </van-cell-group>
              
              </div>
          </van-tab>
          
          <!-- 短信来电 -->
          <van-tab title="短信来电" name="sms">
            <div class="p-5 space-y-4 overflow-y-auto bg-gray-50" style="max-height: calc(85vh - 180px)">
              <van-cell-group inset class="!rounded-lg shadow-sm">
                <van-cell>
                  <template #title>
                    <div class="text-xs text-gray-600 space-y-1">
                      <div>允许发短信控制设备的号码，如果注释掉或者为空，则禁止所有号码。</div>
                      <div class="text-[11px] text-gray-500">短信格式示例：</div>
                      <div class="text-[11px] text-gray-500">· 拨打电话：CALL,10086</div>
                      <div class="text-[11px] text-gray-500">· 发送短信：SMS,10086,查询流量</div>
                      <div class="text-[11px] text-gray-500">· 查询所有呼转状态：CCFC,?</div>
                      <div class="text-[11px] text-gray-500">· 设置无条件呼转：CCFC,18888888888</div>
                      <div class="text-[11px] text-gray-500">· 关闭所有呼转：CCFC,18888888888</div>
                      <div class="text-[11px] text-gray-500">· 切换卡槽优先级：SIMSWITCH</div>
                    </div>
                  </template>
                </van-cell>
                <van-field 
                  :model-value="smsControlWhitelistNumbers.join(',')" 
                  @update:model-value="smsControlWhitelistNumbers = $event.split(',').map((s: string) => s.trim()).filter((s: string) => s)"
                  label="控制白名单" 
                  placeholder="18888888888,13999999999"
                  label-class="!text-gray-700"
                  input-class="!text-gray-900"
                />
                <!--van-field name="smsTts" label="短信播报" label-class="!text-gray-700">
                  <template #input>
                    <van-radio-group v-model="smsTts" direction="horizontal">
                      <van-radio :name="0">关闭</van-radio>
                      <van-radio :name="1">仅验证码</van-radio>
                      <van-radio :name="2">全部</van-radio>
                    </van-radio-group>
                  </template>
                </van-field-->
                <van-field 
                  v-model="ttsText" 
                  label="TTS 语音内容" 
                  type="textarea"
                  rows="2"
                  placeholder="电话接通后播放的语音内容，留空则播放默认音频文件"
                  label-class="!text-gray-700"
                  input-class="!text-gray-900"
                />
                <van-field name="callInAction" label="来电动作" label-class="!text-gray-700">
                  <template #input>
                    <van-radio-group v-model="callInAction" direction="horizontal">
                      <van-radio :name="0">无操作</van-radio>
                      <van-radio :name="1">自动接听</van-radio>
                      <van-radio :name="2">挂断</van-radio>
                    </van-radio-group>
                  </template>
                </van-field>
              </van-cell-group>
            </div>
          </van-tab>
          
          <!-- 设备设置 -->
          <van-tab title="设备设置" name="device">
            <div class="p-5 space-y-4 overflow-y-auto bg-gray-50" style="max-height: calc(85vh - 180px)">
              <van-cell-group inset class="!rounded-lg shadow-sm">
                <van-cell title="扬声器音量">
                  <template #value>
                    <div class="flex items-center gap-3 w-full">
                      <van-slider v-model="audioVolume" :min="0" :max="7" :step="1" bar-height="4px" active-color="#3b82f6" class="flex-1" />
                      <span class="min-w-6 text-center font-semibold text-blue-600 text-sm">{{ audioVolume }}</span>
                    </div>
                  </template>
                </van-cell>
                
                <van-cell title="通话音量">
                  <template #value>
                    <div class="flex items-center gap-3 w-full">
                      <van-slider v-model="callVolume" :min="0" :max="7" :step="1" bar-height="4px" active-color="#3b82f6" class="flex-1" />
                      <span class="min-w-6 text-center font-semibold text-blue-600 text-sm">{{ callVolume }}</span>
                    </div>
                  </template>
                </van-cell>
                
                <van-cell title="麦克风音量">
                  <template #value>
                    <div class="flex items-center gap-3 w-full">
                      <van-slider v-model="micVolume" :min="0" :max="7" :step="1" bar-height="4px" active-color="#3b82f6" class="flex-1" />
                      <span class="min-w-6 text-center font-semibold text-blue-600 text-sm">{{ micVolume }}</span>
                    </div>
                  </template>
                </van-cell>
                
                <van-cell title="开启 RNDIS 网卡">
                  <template #right-icon>
                    <van-switch v-model="rndisEnable" size="20" active-color="#3b82f6" />
                  </template>
                </van-cell>
                
                <van-cell title="状态指示灯">
                  <template #right-icon>
                    <van-switch v-model="ledEnable" size="20" active-color="#3b82f6" />
                  </template>
                </van-cell>
                
                <van-cell title="开机通知">
                  <template #right-icon>
                    <van-switch v-model="bootNotify" size="20" active-color="#3b82f6" />
                  </template>
                </van-cell>
                
                <van-cell title="通知追加更多信息">
                  <template #right-icon>
                    <van-switch v-model="appendMoreInfo" size="20" active-color="#3b82f6" />
                  </template>
                </van-cell>
                
                <van-field 
                  v-model="pinCode" 
                  label="SIM卡PIN码" 
                  placeholder="留空表示无PIN码"
                  label-class="!text-gray-700"
                  input-class="!text-gray-900"
                />
                <van-field 
                  v-model="maxRetryCount" 
                  label="通知最大重试次数" 
                  type="number" 
                  placeholder="100"
                  label-class="!text-gray-700"
                  input-class="!text-gray-900"
                />
                <van-field 
                  v-model="trafficQueryInterval" 
                  label="流量查询间隔(ms)" 
                  type="number" 
                  placeholder="0"
                  label-class="!text-gray-700"
                  input-class="!text-gray-900"
                />
              </van-cell-group>
            </div>
          </van-tab>
          
          <!-- 服务器连接设置 -->
          <van-tab title="服务器连接设置" name="websocket">
            <div class="p-5 space-y-4 overflow-y-auto bg-gray-50" style="max-height: calc(85vh - 180px)">
              <!-- WebSocket配置 -->
              <van-cell-group inset title="WebSocket连接" class="!rounded-lg shadow-sm">
                <van-field 
                  v-model="websocketUrl" 
                  label="WebSocket地址" 
                  placeholder="ws://example.com:9527/websocket"
                  label-class="!text-gray-700"
                  input-class="!text-gray-900"
                />
              </van-cell-group>
              
              <!-- 录音上传配置 -->
              <van-cell-group inset title="录音上传" class="!rounded-lg shadow-sm">
                <van-field 
                  v-model="uploadUrl" 
                  label="上传地址" 
                  placeholder="https://your-server.com/upload"
                  label-class="!text-gray-700"
                  input-class="!text-gray-900"
                >
                  <template #right-icon>
                    <div class="i-carbon:information text-gray-400 text-sm" title="录音文件上传到自定义服务器地址" />
                  </template>
                </van-field>
                <van-cell>
                  <template #title>
                    <div class="flex items-center gap-2">
                      <div class="i-carbon:warning text-orange-500 text-sm" />
                      <span class="text-xs text-gray-600">支持腾讯云COS、阿里云OSS等对象存储</span>
                    </div>
                  </template>
                </van-cell>
              </van-cell-group>
            </div>
          </van-tab>
        </van-tabs>
        
        <!-- 底部按钮 -->
        <div class="p-3 bg-white border-t border-gray-200 shadow-lg">
          <div class="flex gap-2">
            <van-button 
              type="primary" 
              block 
              size="normal"
              class="!bg-gradient-to-r !from-blue-500 !to-blue-600 !border-none flex-1"
              @click="saveAdvancedConfig"
            >
              <div class="flex items-center justify-center gap-1">
                <div class="i-carbon:save text-base" />
                <span class="text-sm">保存配置</span>
              </div>
            </van-button>
            <van-button 
              type="warning" 
              block 
              size="normal"
              class="!bg-gradient-to-r !from-orange-500 !to-orange-600 !border-none flex-1"
              @click="deployConfigToOtherDevices"
            >
              <div class="flex items-center justify-center gap-1">
                <div class="i-carbon:deploy text-base" />
                <span class="text-sm">批量下发</span>
              </div>
            </van-button>
          </div>
        </div>
      </div>
    </van-popup>

    

        

    <!-- 账号设置弹窗 -->
    <van-popup 
      v-model:show="showAccountDialog" 
      position="bottom"
      :style="{ height: '60%' }"
      round
    >
      <div class="flex flex-col h-full">
        <!-- 标题栏 -->
        <div class="flex items-center justify-between p-4 border-b border-gray-200">
          <h3 class="text-lg font-semibold text-gray-900">账号设置</h3>
          <button 
            @click="showAccountDialog = false"
            class="p-1 hover:bg-gray-100 rounded-full transition-colors"
          >
            <div class="i-carbon:close text-xl text-gray-500" />
          </button>
        </div>

        <!-- 内容区域 -->
        <div class="flex-1 p-5 space-y-4 overflow-y-auto">
        
          <van-cell-group inset>
            <van-field
              v-model="accountForm.currentPassword"
              type="password"
              label="当前密码"
              placeholder="修改密码时必填"
              clearable
            />
            <van-field
              v-model="accountForm.newPassword"
              type="password"
              label="新密码"
              placeholder="不修改请留空"
              clearable
            />
            <van-field
              v-model="accountForm.confirmPassword"
              type="password"
              label="确认密码"
              placeholder="再次输入新密码"
              clearable
            />
          </van-cell-group>

          <div class="text-xs text-gray-500 space-y-1 px-4">
            <p>• 修改密码后需要重新登录</p>
            <p>• 密码长度不能少于6位</p>
          </div>
        </div>

        <!-- 底部按钮 -->
        <div class="p-4 bg-white border-t border-gray-200 space-y-2">
          <van-button 
            type="primary" 
            block 
            size="large"
            @click="handleSaveAccount"
            class="!bg-gradient-to-r !from-blue-500 !to-blue-600 !border-none"
          >
            <div class="flex items-center justify-center gap-2">
              <div class="i-carbon:save text-lg" />
              <span>保存设置</span>
            </div>
          </van-button>
          <van-button 
            type="danger" 
            block 
            size="large"
            @click="handleLogout"
            class="!bg-gradient-to-r !from-red-500 !to-red-600 !border-none"
          >
            <div class="flex items-center justify-center gap-2">
              <div class="i-carbon:logout text-lg" />
              <span>退出登录</span>
            </div>
          </van-button>
        </div>
      </div>
    </van-popup>

    <!-- 批量下发配置弹窗 -->
    <van-popup 
      v-model:show="showBatchDeployDialog" 
      position="center"
      round
      :style="{ width: '90%', maxWidth: '700px', maxHeight: '80vh' }"
    >
      <div class="flex flex-col overflow-hidden" style="max-height: 80vh;">
        <!-- 头部 -->
        <div class="bg-gradient-to-r from-orange-500 to-orange-600 p-6" style="background: linear-gradient(to right, #f97316, #ea580c) !important;">
          <div class="flex-between">
            <div class="flex items-center gap-2 text-white">
              <div class="i-carbon:deploy text-2xl" />
              <h3 class="text-lg font-semibold text-white">批量下发配置</h3>
            </div>
            <button @click="showBatchDeployDialog = false" class="text-white/80 hover:text-white transition-colors">
              <div class="i-carbon:close text-2xl" />
            </button>
          </div>
        </div>
        
        <!-- 内容 -->
        <div class="flex-1 p-6 space-y-6 overflow-y-auto">
          <!-- 选择源设备 -->
          <div>
            <label class="block text-sm font-semibold text-gray-700 mb-3">1. 选择源设备（配置来源）</label>
            <div class="space-y-2 max-h-48 overflow-y-auto border border-gray-200 rounded-lg p-3">
              <div 
                v-for="device in deviceList" 
                :key="device.imei"
                @click="batchDeploySourceDevice = device; batchDeployTargetDevices = []"
                class="flex items-center gap-3 p-3 rounded-lg border-2 transition-all cursor-pointer hover:shadow-md"
                :class="batchDeploySourceDevice?.imei === device.imei 
                  ? 'border-orange-500 bg-orange-50' 
                  : 'border-gray-200 bg-white hover:border-orange-300'"
              >
                <div 
                  class="w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all flex-shrink-0"
                  :class="batchDeploySourceDevice?.imei === device.imei 
                    ? 'border-orange-500 bg-orange-500' 
                    : 'border-gray-300'"
                >
                  <div v-if="batchDeploySourceDevice?.imei === device.imei" class="i-carbon:checkmark text-white text-xs" />
                </div>
                <div class="flex-1">
                  <div class="font-medium text-gray-900">{{ device.phone || '未设置手机号' }}</div>
                  <div class="text-xs text-gray-500 font-mono">{{ device.imei }}</div>
                </div>
                <div 
                  class="px-2 py-1 rounded-full text-xs font-medium"
                  :class="device.connected ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'"
                >
                  {{ device.connected ? '在线' : '离线' }}
                </div>
              </div>
            </div>
          </div>
          
          <!-- 选择目标设备 -->
          <div v-if="batchDeploySourceDevice">
            <div class="flex-between mb-3">
              <label class="text-sm font-semibold text-gray-700">2. 选择目标设备（接收配置）</label>
              <button 
                @click="toggleAllBatchDeployTargets"
                class="text-sm text-orange-600 hover:text-orange-700 font-medium"
              >
                {{ batchDeployTargetDevices.length === deviceList.filter(d => d.imei !== batchDeploySourceDevice?.imei).length ? '取消全选' : '全选' }}
              </button>
            </div>
            <div class="space-y-2 max-h-64 overflow-y-auto border border-gray-200 rounded-lg p-3">
              <div 
                v-for="device in deviceList.filter(d => d.imei !== batchDeploySourceDevice?.imei)" 
                :key="device.imei"
                @click="toggleBatchDeployTarget(device.imei)"
                class="flex items-center gap-3 p-3 rounded-lg border-2 transition-all cursor-pointer hover:shadow-md"
                :class="batchDeployTargetDevices.includes(device.imei) 
                  ? 'border-orange-500 bg-orange-50' 
                  : 'border-gray-200 bg-white hover:border-orange-300'"
              >
                <div 
                  class="w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all flex-shrink-0"
                  :class="batchDeployTargetDevices.includes(device.imei) 
                    ? 'border-orange-500 bg-orange-500' 
                    : 'border-gray-300'"
                >
                  <div v-if="batchDeployTargetDevices.includes(device.imei)" class="i-carbon:checkmark text-white text-xs" />
                </div>
                <div class="flex-1">
                  <div class="font-medium text-gray-900">{{ device.phone || '未设置手机号' }}</div>
                  <div class="text-xs text-gray-500 font-mono">{{ device.imei }}</div>
                </div>
                <div 
                  class="px-2 py-1 rounded-full text-xs font-medium"
                  :class="device.connected ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'"
                >
                  {{ device.connected ? '在线' : '离线' }}
                </div>
              </div>
              <div v-if="deviceList.filter(d => d.imei !== batchDeploySourceDevice?.imei).length === 0" class="text-center py-8 text-gray-500">
                没有其他设备可选择
              </div>
            </div>
            <div v-if="batchDeployTargetDevices.length > 0" class="mt-3 text-sm text-gray-600">
              已选择 <span class="font-semibold text-orange-600">{{ batchDeployTargetDevices.length }}</span> 个目标设备
            </div>
          </div>
        </div>
        
        <!-- 底部按钮 -->
        <div class="p-6 border-t border-gray-200 space-y-3">
          <button 
            class="w-full px-4 py-3 bg-gradient-to-r from-orange-500 to-orange-600 text-white text-base font-semibold hover:from-orange-600 hover:to-orange-700 transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg"
            style="background: linear-gradient(to right, #f97316, #ea580c) !important; color: white !important;"
            @click="executeBatchDeploy"
            :disabled="!batchDeploySourceDevice || batchDeployTargetDevices.length === 0 || batchDeployLoading"
          >
            <div v-if="batchDeployLoading" class="i-carbon:loading animate-spin text-lg" style="color: white !important;" />
            <div v-else class="i-carbon:deploy text-lg" style="color: white !important;" />
            <span style="color: white !important;">{{ batchDeployLoading ? '下发中...' : '开始批量下发' }}</span>
          </button>
          <button 
            class="w-full px-4 py-3 bg-white border border-gray-300 text-gray-700 text-base font-medium hover:bg-gray-50 transition-colors rounded-lg"
            @click="showBatchDeployDialog = false"
            :disabled="batchDeployLoading"
          >
            取消
          </button>
        </div>
      </div>
    </van-popup>

  </div>
</template>

<route lang="json5">
{
  name: 'home',
  meta: {
    title: '设备列表',
  },
}
</route>

<style scoped>
/* 修复高级配置弹窗中所有字段的文字颜色和背景色 */

/* 字段标签 - 深灰色 */
:deep(.advanced-config-popup .van-field__label) {
  color: #374151 !important; /* text-gray-700 */
}

/* 字段输入控制器 - 黑色 */
:deep(.advanced-config-popup .van-field__control) {
  color: #111827 !important; /* text-gray-900 */
  background-color: #ffffff !important; /* 白色背景 */
}

/* 单元格标题 - 深灰色 */
:deep(.advanced-config-popup .van-cell__title) {
  color: #374151 !important; /* text-gray-700 */
}

/* 单元格值 - 黑色 */
:deep(.advanced-config-popup .van-cell__value) {
  color: #111827 !important; /* text-gray-900 */
}

/* 所有输入框 - 黑色文字，白色背景 */
:deep(.advanced-config-popup input) {
  color: #111827 !important; /* text-gray-900 */
  background-color: #ffffff !important; /* 白色背景 */
}

/* 所有文本域 - 黑色文字，白色背景 */
:deep(.advanced-config-popup textarea) {
  color: #111827 !important; /* text-gray-900 */
  background-color: #ffffff !important; /* 白色背景 */
}

/* 占位符文字 - 灰色 */
:deep(.advanced-config-popup .van-field__placeholder) {
  color: #9ca3af !important; /* text-gray-400 */
}

/* van-field 整体背景 - 白色 */
:deep(.advanced-config-popup .van-field) {
  background-color: #ffffff !important;
}

/* van-cell 整体背景 - 白色 */
:deep(.advanced-config-popup .van-cell) {
  background-color: #ffffff !important;
}

/* van-cell-group 标题 - 深灰色 */
:deep(.advanced-config-popup .van-cell-group__title) {
  color: #374151 !important; /* text-gray-700 */
  background-color: transparent !important;
}

/* 单选框标签 - 黑色 */
:deep(.advanced-config-popup .van-radio__label) {
  color: #111827 !important; /* text-gray-900 */
}

/* 确保所有文字都可见 */
:deep(.advanced-config-popup) {
  color: #111827 !important; /* text-gray-900 */
}

/* 强制覆盖所有可能的白色文字 */
:deep(.advanced-config-popup *) {
  color: inherit !important;
}

/* 特别处理 Vant 组件的内部元素 */
:deep(.advanced-config-popup .van-field__body) {
  background-color: #ffffff !important;
}

:deep(.advanced-config-popup .van-cell__title span) {
  color: #374151 !important;
}

:deep(.advanced-config-popup .van-field__label span) {
  color: #374151 !important;
}

/* 标签页内容区域 */
:deep(.advanced-config-popup .van-tab__panel) {
  color: #111827 !important;
}

/* 确保输入框内的文字可见 */
:deep(.advanced-config-popup input::placeholder) {
  color: #9ca3af !important;
  opacity: 1 !important;
}

:deep(.advanced-config-popup textarea::placeholder) {
  color: #9ca3af !important;
  opacity: 1 !important;
}
</style>
