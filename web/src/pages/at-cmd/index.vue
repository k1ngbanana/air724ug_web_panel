<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import request from '@/utils/request'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'

// 定义指令类型
interface CommandItem {
  label: string
  command: string
  desc: string
  color?: string
}

const route = useRoute()
const device = ref<any>(route.query.device ? JSON.parse(route.query.device as string) : {})
const cmdText = ref('')
const loading = ref(false)
const responseResult = ref('')
const terminalRef = ref<HTMLElement>()

// 生成随机浅色
function generateRandomLightColor() {
  const colors = [
    '#E3F2FD', '#F3E5F5', '#E8F5E8', '#FFF3E0', '#FCE4EC', '#E0F2F1',
    '#F1F8E9', '#E0F7FA', '#F3E5F5', '#FFF8E1', '#F1F8E9', '#E8EAF6',
    '#E1F5FE', '#F9FBE7', '#E0F2F1', '#FFF3E0', '#FCE4EC', '#E8F5E8',
    '#E3F2FD', '#F3E5F5', '#E0F7FA', '#FFF8E1', '#F1F8E9', '#E8EAF6'
  ]
  return colors[Math.floor(Math.random() * colors.length)]
}

// 常用AT指令标签
const commonCommands = ref<CommandItem[]>([
  { label: 'AT+CNUM', command: 'AT+CNUM', desc: '获取手机号' },
  { label: 'AT+CGSN', command: 'AT+CGSN', desc: '获取IMEI号' },
  { label: 'AT+ICCID', command: 'AT+ICCID', desc: '获取ICCID' },
  { label: 'AT+CPIN?', command: 'AT+CPIN?', desc: '查询SIM卡状态' },
  { label: 'AT+CSQ', command: 'AT+CSQ', desc: '查询信号强度' },
  { label: 'AT+CREG?', command: 'AT+CREG?', desc: '查询网络注册状态' },
  { label: 'AT+RFTEMPERATURE?', command: 'AT+RFTEMPERATURE?', desc: '查询温度' },
  { label: 'AT+RESET', command: 'AT+RESET', desc: '设备重启' },
])

// 为每个指令随机分配颜色
commonCommands.value.forEach(cmd => {
  cmd.color = generateRandomLightColor()
})

let terminal: Terminal
let fitAddon: FitAddon

onMounted(() => {
  initTerminal()
})

function initTerminal() {
  if (!terminalRef.value) return

  terminal = new Terminal({
    theme: {
      background: '#1e1e1e',
      foreground: '#e0e0e0',
      cursor: '#e0e0e0',
      black: '#000000',
      red: '#ff5f56',
      green: '#27ca3f',
      yellow: '#ffbd2e',
      blue: '#007acc',
      magenta: '#ff5f56',
      cyan: '#007acc',
      white: '#e0e0e0',
      brightBlack: '#666666',
      brightRed: '#ff5f56',
      brightGreen: '#27ca3f',
      brightYellow: '#ffbd2e',
      brightBlue: '#007acc',
      brightMagenta: '#ff5f56',
      brightCyan: '#007acc',
      brightWhite: '#ffffff'
    },
    fontFamily: 'Courier New, Monaco, Menlo, monospace',
    fontSize: 14,
    lineHeight: 1.2,
    cursorBlink: true,
    scrollback: 1000
  })

  fitAddon = new FitAddon()
  terminal.loadAddon(fitAddon)
  terminal.open(terminalRef.value)
  fitAddon.fit()

  // 监听窗口大小变化
  window.addEventListener('resize', () => {
    fitAddon.fit()
  })
}

// 点击标签执行指令
function executeCommand(command: string) {
  cmdText.value = command
  submit()
}

// 清空终端（暂未使用）
// function clearTerminal() {
//   if (terminal) {
//     terminal.clear()
//   }
// }

// 清空输入框（暂未使用）
// function clearInput() {
//   cmdText.value = ''
// }

// 保存配置
async function submit() {
  if (!device.value?.imei)
    return
  loading.value = true

  // 分割多条指令（按换行符分割）
  const commands = cmdText.value.split('\n').filter(cmd => cmd.trim() !== '')

  if (commands.length === 0) {
    loading.value = false
    return
  }

  // 顺序执行每条指令
  for (let i = 0; i < commands.length; i++) {
    const command = commands[i].trim()
    if (!command) continue

    // 显示当前执行的指令
    if (terminal) {
      terminal.write(`\r\n$ ${command}\r\n\r\n`)
    }

    try {
      const response = await request.post('/executeTask', {
        imei: device.value.imei,
        task: 'at_cmd',
        command: command,
      }) as any

      if (response.success) {
        const result = response.result || '指令执行成功'
        if (terminal) {
          // 处理结果中的换行符，确保正确显示
          const formattedResult = result.replace(/\n/g, '\r\n')
          terminal.write(formattedResult + '\r\n')
        }
        responseResult.value = result
      }
      else {
        const errorMsg = `错误: ${response.message || '执行失败'}`
        if (terminal) {
          terminal.write('\x1b[31m' + errorMsg + '\x1b[0m\r\n')
        }
        responseResult.value = errorMsg
      }
    }
    catch (error: any) {
      const errorMsg = `错误: ${error?.message || error?.toString() || '网络请求失败'}`
      if (terminal) {
        terminal.write('\x1b[31m' + errorMsg + '\x1b[0m\r\n')
      }
      responseResult.value = errorMsg
    }

    // 在指令之间添加短暂延迟
    if (i < commands.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 500))
    }
  }

  loading.value = false
}

</script>

<template>
  <div class="at-cmd-container">
    <van-field v-model="cmdText" type="textarea" rows="4" placeholder="请输入AT指令，可换行执行多条" class="at-input" />

    <!-- 常用指令标签 -->
    <div class="common-commands">
      <div class="commands-grid">
        <div
          v-for="cmd in commonCommands"
          :key="cmd.command"
          class="command-tag"
          :style="{ backgroundColor: cmd.color }"
          @click="executeCommand(cmd.command)"
        >
          {{ cmd.desc }}
        </div>
      </div>
    </div>

    <van-button type="primary" block :loading="loading" @click="submit" class="submit-btn">
      发送指令
    </van-button>

    <!-- xterm.js 终端展示区域 -->
    <div class="terminal-container">
      <div ref="terminalRef" class="terminal-body"></div>
    </div>
  </div>
</template>

<style scoped>
.at-cmd-container {
  height: calc(100vh - var(--van-nav-bar-height) - 32px);
  display: flex;
  flex-direction: column;
}
.at-input {
  margin-bottom: 16px;
}

.common-commands {
  margin-bottom: 16px;
}

.commands-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.command-tag {
  cursor: pointer;
  transition: all 0.2s ease;
  padding: 6px 12px;
  border-radius: 20px;
  font-size: 12px;
  color: #333;
  border: 1px solid rgba(0, 0, 0, 0.1);
  user-select: none;
}

.command-tag:hover {
  transform: translateY(-1px);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
}

.submit-btn {
  margin-top: 16px;
}

.terminal-container {
  margin-top: 20px;
  border-radius: 8px;
  overflow: hidden;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}

.terminal-body {
  background: #1e1e1e;
  padding: 8px;
  flex: auto;
  max-height: 300px;
}

/* xterm.js 样式覆盖 */
:deep(.xterm) {
  height: 100%;
}

:deep(.xterm-viewport) {
  background-color: #1e1e1e !important;
}

:deep(.xterm-screen) {
  background-color: #1e1e1e !important;
}
</style>

<route lang="json5">
{
  name: 'atCmd',
  meta: {
    title: '远程指令',
  }
}
</route>
