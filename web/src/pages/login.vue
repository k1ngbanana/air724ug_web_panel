<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { showToast } from 'vant'
import request from '@/utils/request'

const router = useRouter()

const username = ref('')
const password = ref('')
const loading = ref(false)

// Logo配置
interface LoginLogoConfig {
  loginTitle: string
  loginSubtitle: string
  loginLogo: string
  copyright?: string
}

const logoConfig = ref<LoginLogoConfig>({
  loginTitle: '短信转发 管理平台',
  loginSubtitle: '设备管理系统',
  loginLogo: '',
})

// 加载Logo配置
async function loadLogoConfig() {
  try {
    // 从localStorage加载Logo配置
    const savedConfig = localStorage.getItem('air724_logo_config')
    if (savedConfig) {
      const config = JSON.parse(savedConfig)
      logoConfig.value = { ...logoConfig.value, ...config }
    }
  } catch (error) {
    console.error('加载Logo配置失败:', error)
  }
}

onMounted(() => {
  loadLogoConfig()
})

// 登录
async function handleLogin() {
  if (!username.value || !password.value) {
    showToast('请输入用户名和密码')
    return
  }

  loading.value = true
  try {
    const response = await request.post('/auth/login', {
      username: username.value,
      password: password.value,
    }) as any

    // 适配响应格式：{ code: 0, data: { token, userInfo }, msg: 'success' }
    if (response.code === 0 || response.success) {
      const token = response.data?.token || response.token
      const userInfo = response.data?.userInfo || response.data?.user || response.data
      
      // 保存token和用户信息
      localStorage.setItem('token', token)
      if (userInfo) {
        // 保存完整的用户信息，包括role和expiresAt
        localStorage.setItem('userInfo', JSON.stringify({
          uid: userInfo.uid,
          name: userInfo.username,
          username: userInfo.username,
          role: userInfo.role,
          email: userInfo.email,
          needActivation: userInfo.needActivation,
          status: userInfo.status,
          expiresAt: userInfo.expiresAt
        }))
      }
      
            
      showToast('登录成功')
      // 单用户模式：登录成功后统一跳转到首页
      router.push('/')
    } else {
      showToast(response.msg || response.message || '登录失败')
    }
  } catch (error: any) {
    showToast(error?.response?.data?.msg || error?.message || '登录失败')
  } finally {
    loading.value = false
  }
}

// 回车提交
function handleKeyPress(event: KeyboardEvent) {
  if (event.key === 'Enter') {
    handleLogin()
  }
}
</script>

<template>
  <div class="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 via-white to-blue-50">
    <!-- 背景装饰 -->
    <div class="absolute inset-0 overflow-hidden pointer-events-none">
      <div class="absolute top-20 left-10 w-72 h-72 bg-blue-200 rounded-full mix-blend-multiply filter blur-xl opacity-30 animate-blob" />
      <div class="absolute top-40 right-10 w-72 h-72 bg-purple-200 rounded-full mix-blend-multiply filter blur-xl opacity-30 animate-blob animation-delay-2000" />
      <div class="absolute -bottom-8 left-20 w-72 h-72 bg-pink-200 rounded-full mix-blend-multiply filter blur-xl opacity-30 animate-blob animation-delay-4000" />
    </div>

    <!-- 登录卡片 -->
    <div class="relative w-full max-w-md mx-4">
      <div class="bg-white/80 backdrop-blur-xl rounded-2xl shadow-2xl p-8 border border-white/20">
        <!-- Logo和标题 -->
        <div class="text-center mb-8">
          <div class="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-br from-blue-500 to-blue-600 rounded-2xl mb-4 shadow-lg" style="background: linear-gradient(to bottom right, #3b82f6, #2563eb) !important;">
            <img 
              v-if="logoConfig.loginLogo" 
              :src="logoConfig.loginLogo" 
              alt="Logo"
              class="w-10 h-10 object-contain"
              @error="(e) => { (e.target as HTMLImageElement).src = '/images/login-logo-default.svg' }"
            />
            <div v-else class="i-carbon:chip text-3xl text-white" style="color: white !important; font-size: 2rem !important;" />
          </div>
          <h1 class="text-3xl font-bold text-gray-900 mb-2">{{ logoConfig.loginTitle || 'Air724UG 管理平台' }}</h1>
          <p class="text-gray-500">{{ logoConfig.loginSubtitle || '设备管理系统' }}</p>
        </div>

        <!-- 登录表单 -->
        <div class="space-y-5">
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-2">用户名</label>
            <div class="relative">
              <div class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <div class="i-carbon:user text-gray-400 text-lg" />
              </div>
              <input
                v-model="username"
                type="text"
                placeholder="请输入用户名"
                @keypress="handleKeyPress"
                class="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
              />
            </div>
          </div>

          <div>
            <label class="block text-sm font-medium text-gray-700 mb-2">密码</label>
            <div class="relative">
              <div class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <div class="i-carbon:password text-gray-400 text-lg" />
              </div>
              <input
                v-model="password"
                type="password"
                placeholder="请输入密码"
                @keypress="handleKeyPress"
                class="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
              />
            </div>
          </div>

          <button
            @click="handleLogin()"
            :disabled="loading"
            class="w-full py-3 bg-gradient-to-r from-blue-500 to-blue-600 text-white font-semibold rounded-lg hover:from-blue-600 hover:to-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-all shadow-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            style="background: linear-gradient(to right, #3b82f6, #2563eb) !important; color: white !important;"
          >
            <div v-if="loading" class="i-carbon:loading animate-spin text-xl" style="color: white !important;" />
            <span style="color: white !important;">{{ loading ? '登录中...' : '登录' }}</span>
          </button>
        </div>

        <!-- 底部信息（单用户模式不再提供注册入口） -->
      </div>

      <!-- 版权信息 -->
      <div class="text-center mt-6 text-sm text-gray-500">
        <p>{{ logoConfig.copyright || '© 2025 Air724UG 管理平台. All rights reserved.' }}</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
@keyframes blob {
  0% {
    transform: translate(0px, 0px) scale(1);
  }
  33% {
    transform: translate(30px, -50px) scale(1.1);
  }
  66% {
    transform: translate(-20px, 20px) scale(0.9);
  }
  100% {
    transform: translate(0px, 0px) scale(1);
  }
}

.animate-blob {
  animation: blob 7s infinite;
}

.animation-delay-2000 {
  animation-delay: 2s;
}

.animation-delay-4000 {
  animation-delay: 4s;
}
</style>

<route lang="json5">
{
  name: 'user-login',
  meta: {
    layout: 'empty',
    requiresAuth: false,
  },
}
</route>
