import { createRemToPxProcessor } from '@unocss/preset-wind4/utils'

import {
  defineConfig,
  presetAttributify,
  presetIcons,
  presetWind4,
  transformerDirectives,
  transformerVariantGroup,
} from 'unocss'

const BASE_FONT_SIZE = 16

export default defineConfig({
  shortcuts: [
    // 按钮样式
    ['btn', 'px-6 py-3 rounded-4 border-none inline-block bg-blue-500 text-white cursor-pointer outline-hidden hover:bg-blue-600 disabled:cursor-default disabled:bg-gray-400 disabled:opacity-50 transition-all'],
    ['btn-primary', 'bg-blue-500 hover:bg-blue-600 text-white'],
    ['btn-secondary', 'bg-white hover:bg-gray-50 text-blue-600 border border-blue-500'],
    
    // 卡片样式
    ['card', 'bg-white rounded-lg shadow-sm border border-gray-200 p-4'],
    ['card-hover', 'bg-white rounded-lg shadow-sm border border-gray-200 p-4 hover:shadow-md transition-shadow cursor-pointer'],
    
    // 布局容器
    ['container-responsive', 'w-full mx-auto px-6 max-w-[1600px]'],
    ['flex-center', 'flex items-center justify-center'],
    ['flex-between', 'flex items-center justify-between'],
    
    // 状态标签
    ['status-online', 'bg-blue-50 text-blue-600 border border-blue-200'],
    ['status-offline', 'bg-gray-50 text-gray-600 border border-gray-200'],
  ],
  theme: {
    colors: {
      // 蓝白主题配色
      primary: {
        50: '#eff6ff',
        100: '#dbeafe',
        200: '#bfdbfe',
        300: '#93c5fd',
        400: '#60a5fa',
        500: '#3b82f6',  // 主蓝色
        600: '#2563eb',
        700: '#1d4ed8',
        800: '#1e40af',
        900: '#1e3a8a',
      },
    },
  },
  presets: [
    presetWind4({
      preflights: {
        theme: {
          process: createRemToPxProcessor(BASE_FONT_SIZE),
        },
      },
    }),
    presetAttributify(),
    presetIcons({
      scale: 1.2,
      collections: {
        carbon: () => import('@iconify-json/carbon/icons.json').then(i => i.default),
      },
    }),
  ],
  postprocess: [
    createRemToPxProcessor(BASE_FONT_SIZE),
  ],
  transformers: [
    transformerDirectives(),
    transformerVariantGroup(),
  ],
})
