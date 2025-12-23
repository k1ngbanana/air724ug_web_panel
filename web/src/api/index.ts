import request from '@/utils/request'

export async function queryProse(): Promise<any> {
  return request('/prose')
}

// 读取设备短信
export async function readSms(imei: string): Promise<any> {
  return request('/executeTask', {
    method: 'POST',
    data: {
      imei,
      task: 'read_sms'
    }
  })
}

// 获取录音列表
export async function getVoiceRecords(): Promise<any> {
  return request('/records')
}

// 语音转文字
export async function transcribeVoice(recordId: string): Promise<any> {
  return request(`/records/${recordId}/transcribe`, {
    method: 'POST'
  })
}

// 下载录音文件
export async function downloadVoiceRecord(recordId: string): Promise<any> {
  return request(`/records/${recordId}/download`, {
    method: 'GET',
    responseType: 'blob'
  })
}

// 删除录音记录
export async function deleteVoiceRecord(recordId: string): Promise<any> {
  return request(`/records/${recordId}`, {
    method: 'DELETE'
  })
}

// 清理过期录音
export async function cleanupExpiredRecords(): Promise<any> {
  return request('/cleanup/expired', {
    method: 'POST'
  })
}

// 清理指定设备的旧录音
export async function cleanupDeviceRecords(imei: string, olderThanDays: number = 7): Promise<any> {
  return request(`/cleanup/device/${imei}`, {
    method: 'POST',
    data: { olderThanDays }
  })
}

// 获取即将过期的录音统计
export async function getExpiringRecords(days: number = 1): Promise<any> {
  return request(`/expiring?days=${days}`)
}

// 批量转换待转换的录音
export async function batchTranscribeRecords(limit: number = 5): Promise<any> {
  return request('/transcribe/batch', {
    method: 'POST',
    data: { limit }
  })
}

// 获取当前用户权限
export async function getMyPermissions(): Promise<any> {
  return request('/permissions/my-permissions')
}

// 获取所有用户权限列表（管理员）
export async function getAllUserPermissions(): Promise<any> {
  return request('/permissions/all-users')
}

// 授予用户权限（管理员）
export async function grantUserPermission(username: string, permissionType: string): Promise<any> {
  return request('/permissions/grant', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    data: { username, permissionType }
  })
}

// 撤销用户权限（管理员）
export async function revokeUserPermission(username: string, permissionType: string): Promise<any> {
  return request('/permissions/revoke', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    data: { username, permissionType }
  })
}

// 批量设置权限（管理员）
export async function batchSetPermissions(permissions: Array<{username: string, permission_type: string, granted: boolean}>): Promise<any> {
  return request('/permissions/batch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    data: { permissions }
  })
}

// 获取设备白名单（管理员）
export async function getDeviceWhitelist(): Promise<any> {
  return request('/admin/device-whitelist')
}

// 添加设备白名单条目（管理员，按 IMEI 管理，mac 由后端使用占位符处理）
export async function addDeviceWhitelistEntry(payload: { imei: string; remark?: string }): Promise<any> {
  return request('/admin/device-whitelist', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    data: payload
  })
}

// 删除设备白名单条目（管理员）
export async function deleteDeviceWhitelistEntry(id: number): Promise<any> {
  return request(`/admin/device-whitelist/${id}`, {
    method: 'DELETE'
  })
}

// 按 IMEI 添加到白名单（管理员，从设备列表勾选使用）
export async function addDeviceWhitelistByImei(payload: { imei: string; mac?: string; remark?: string }): Promise<any> {
  return request('/admin/device-whitelist/by-imei', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    data: payload
  })
}

// 按 IMEI 从白名单移除（管理员，从设备列表取消勾选使用）
export async function removeDeviceWhitelistByImei(imei: string): Promise<any> {
  return request(`/admin/device-whitelist/by-imei/${imei}`, {
    method: 'DELETE'
  })
}
