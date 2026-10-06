/* ============ gestureUi：操作界面统一体感交互（hold-to-confirm） ============
   全局定义：光标命中目标后，光标变成圆形进度条，加载满（持续命中 HOLD_SECONDS）才触发点击。
   打地鼠等游戏内"碰到即打"是游戏自定义交互，不走这里。
   组件只需提供目标查询与激活回调，本模块负责：跟随光标、层级命中、进度累计、触发冷却。 */

import type { GestureEngine } from './GestureEngine'
import type { GestureEvent } from './types'

/** UI 点击确认时长（秒）：光标停在目标上加载满即触发 */
export const UI_HOLD_SECONDS = 0.8
/** 触发后冷却（毫秒），防止同目标连触发 */
const ACTIVATE_COOLDOWN = 450

export interface GestureUiState {
  x: number
  y: number
  visible: boolean
  /** 当前命中目标 key（空 = 无命中） */
  key: string
  /** hold 进度 0..1（命中期间累计，离开清零） */
  progress: number
}

export interface GestureUiNavOptions {
  gesture: GestureEngine
  /** 实时返回可命中的目标元素（调用方按层级排序：浮层按钮在前、底层卡片在后） */
  targets: () => HTMLElement[]
  /** 目标元素 → 激活 key */
  keyOf: (el: HTMLElement) => string
  /** 进度填满触发（hold-to-confirm 点击） */
  onActivate: (key: string) => void
  /** 每帧状态变化（组件用于绑定光标样式/进度环） */
  onStateChange: (s: GestureUiState) => void
  holdSeconds?: number
}

export interface GestureUiNav {
  state: GestureUiState
  stop: () => void
}

/** 创建全局 UI 手势导航（组件 onMounted 创建、onUnmounted stop） */
export function createGestureUiNav(opts: GestureUiNavOptions): GestureUiNav {
  const holdSeconds = opts.holdSeconds ?? UI_HOLD_SECONDS
  const state: GestureUiState = { x: -100, y: -100, visible: false, key: '', progress: 0 }
  let latestHand = { x: 0.5, y: 0.5, visible: false, player: 0 }
  let raf = 0
  let lastT = 0
  let activeKey = ''
  let progress = 0
  let lastActivate = 0

  const offEvent = opts.gesture.onEvent((e: GestureEvent) => {
    if (e.type === 'point' && e.hands.length > 0) {
      latestHand = e.hands[0]
      latestHand.visible = e.hands[0].visible
    }
  })

  function hitTest(x: number, y: number): HTMLElement | null {
    for (const el of opts.targets()) {
      if (!el) continue
      const r = el.getBoundingClientRect()
      if (x >= r.left - 20 && x <= r.right + 20 && y >= r.top - 20 && y <= r.bottom + 20) {
        return el
      }
    }
    return null
  }

  function loop(t: number) {
    const dt = Math.min(0.05, lastT ? (t - lastT) / 1000 : 0.016)
    lastT = t
    const h = latestHand
    if (h.visible) {
      // 手坐标已是全区归一化，直接乘视口尺寸 = 实际位置
      state.x = h.x * window.innerWidth
      state.y = h.y * window.innerHeight
      state.visible = true
      const el = hitTest(state.x, state.y)
      const key = el ? opts.keyOf(el) : ''
      state.key = key
      if (key) {
        const now = performance.now()
        if (key !== activeKey) {
          activeKey = key
          progress = 0
        }
        // 触发冷却：触发后短暂不再累计，避免同目标连触发
        if (now - lastActivate > ACTIVATE_COOLDOWN) {
          progress = Math.min(1, progress + dt / holdSeconds)
          if (progress >= 1) {
            opts.onActivate(key)
            progress = 0
            lastActivate = now
          }
        }
      } else {
        activeKey = ''
        progress = 0
      }
      state.progress = progress
    } else {
      state.visible = false
      state.x = -100
      state.y = -100
      state.key = ''
      state.progress = 0
    }
    opts.onStateChange({ ...state })
    raf = requestAnimationFrame(loop)
  }

  raf = requestAnimationFrame(loop)

  return {
    state,
    stop() {
      cancelAnimationFrame(raf)
      offEvent()
    },
  }
}
