// 简化版权限模块：真正单用户模式下，所有权限一律放行

// 权限类型常量（保留枚举，便于前端或其它模块判断）
export const PERMISSION_TYPES = {
  VOICE_TRANSCRIBE: 'voice_transcribe',
  SMS_READ: 'sms_read',
}

// 检查用户是否有特定权限（单用户：始终放行）
export function hasUserPermission(username, permissionType) {
  return true
}

// 获取用户的所有权限（单用户：全部开启，且为 admin）
export function getUserPermissions(username) {
  return {
    [PERMISSION_TYPES.VOICE_TRANSCRIBE]: true,
    [PERMISSION_TYPES.SMS_READ]: true,
    is_admin: true,
  }
}
