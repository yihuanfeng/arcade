<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import type { GestureEngine } from '../core/GestureEngine'
import type { GestureEvent, PoseFrame } from '../core/types'
import { drawPoseFrames } from '../core/poseRender'
import { createGestureUiNav } from '../core/gestureUi'

const props = defineProps<{
  gesture: GestureEngine
  inputSource: string
}>()

const emit = defineEmits<{
  (e: 'back'): void
  (e: 'input-source', src: 'auto' | 'camera' | 'mock'): void
}>()

const previewRef = ref<HTMLCanvasElement | null>(null)
const backBtn = ref<HTMLElement | null>(null)
const focusOnBack = ref(false)
const backProgress = ref(0)
const cursorStyle = ref({ left: '-100px', top: '-100px', visible: false })
const frames = ref<PoseFrame[]>([])
const handInfo = ref<{ player: number; side: 'left' | 'right'; x: number; y: number; visible: boolean }[]>([])
const taps = ref<number[]>([0, 0, 0, 0])
const tapTotal = ref(0)
const lastTapInfo = ref('—')

let raf = 0
let offEvent: (() => void) | null = null
let offPose: (() => void) | null = null
let nav: ReturnType<typeof createGestureUiNav> | null = null

/** 坐标格式化：非有限数显示 —（MediaPipe 低可见度时可能输出 NaN） */
function fmt(v: number): string {
  return Number.isFinite(v) ? v.toFixed(2) : '—'
}

/** 画布像素尺寸跟随窗口（全屏画面） */
function resizeCanvas() {
  const cv = previewRef.value
  if (cv) {
    cv.width = window.innerWidth
    cv.height = window.innerHeight
  }
}

function drawPreview() {
  const cv = previewRef.value
  if (cv) {
    const w = cv.width
    const h = cv.height
    const ctx = cv.getContext('2d')!
    ctx.clearRect(0, 0, w, h)
    const video = props.gesture.previewVideo
    if (video && video.readyState >= 2 && video.videoWidth > 0) {
      // 摄像头画面：照镜子 + cover 铺满全屏（保持比例裁切，无黑边）
      ctx.save()
      ctx.scale(-1, 1)
      const vw = video.videoWidth
      const vh = video.videoHeight
      const scale = Math.max(w / vw, h / vh)
      const dw = vw * scale
      const dh = vh * scale
      ctx.drawImage(video, -dw + (w - dw) / 2, (h - dh) / 2, dw, dh)
      ctx.restore()
    } else {
      // Mock：深色底 + 霓虹网格
      ctx.fillStyle = '#0a1016'
      ctx.fillRect(0, 0, w, h)
      ctx.strokeStyle = 'rgba(0,229,255,0.10)'
      ctx.lineWidth = 1
      for (let gx = 0; gx <= 6; gx++) {
        ctx.beginPath()
        ctx.moveTo((gx / 6) * w, 0)
        ctx.lineTo((gx / 6) * w, h)
        ctx.stroke()
      }
      for (let gy = 0; gy <= 4; gy++) {
        ctx.beginPath()
        ctx.moveTo(0, (gy / 4) * h)
        ctx.lineTo(w, (gy / 4) * h)
        ctx.stroke()
      }
    }
    drawPoseFrames(ctx, frames.value, w, h, { lineWidth: 5, drawPoints: true, filterVisible: true })
  }
  raf = requestAnimationFrame(drawPreview)
}

onMounted(() => {
  resizeCanvas()
  window.addEventListener('resize', resizeCanvas)
  offEvent = props.gesture.onEvent((e: GestureEvent) => {
    if (e.type === 'point' && e.hands.length > 0) {
      handInfo.value = e.hands.map((h) => ({ player: h.player, side: h.side, x: h.x, y: h.y, visible: h.visible }))
    }
    if (e.type === 'tap') {
      taps.value[e.player] = (taps.value[e.player] ?? 0) + 1
      tapTotal.value++
      lastTapInfo.value = `玩家 ${e.player + 1} @ (${e.hand.x.toFixed(2)}, ${e.hand.y.toFixed(2)})`
    }
  })
  offPose = props.gesture.onPose((f) => {
    frames.value = f
  })
  // 返回按钮：全局 UI 交互（hold-to-confirm，光标加载满才触发）
  nav = createGestureUiNav({
    gesture: props.gesture,
    targets: () => (backBtn.value ? [backBtn.value] : []),
    keyOf: () => 'back',
    onActivate: () => emit('back'),
    onStateChange: (s) => {
      cursorStyle.value = { left: `${s.x}px`, top: `${s.y}px`, visible: s.visible }
      focusOnBack.value = s.key === 'back'
      backProgress.value = s.progress
    },
  })
  raf = requestAnimationFrame(drawPreview)
})

onUnmounted(() => {
  cancelAnimationFrame(raf)
  window.removeEventListener('resize', resizeCanvas)
  offEvent?.()
  offPose?.()
  nav?.stop()
})
</script>

<template>
  <div class="test-page" id="gesture-test">
    <!-- 全屏画面：摄像头照镜子 / Mock 网格 + 骨架 -->
    <canvas ref="previewRef" class="preview-full"></canvas>

    <!-- 信息浮层（覆盖在画面上） -->
    <div class="hud">
      <!-- 顶部：输入源切换 -->
      <div class="topbar">
        <span class="src-label">
          输入源：{{ inputSource === 'camera' ? '📷 摄像头' : inputSource === 'mock' ? '🖱 Mock' : '自动' }}
        </span>
        <div class="src-btns">
          <button class="mini" :class="{ on: inputSource === 'auto' }" @click="emit('input-source', 'auto')">自动</button>
          <button class="mini" :class="{ on: inputSource === 'camera' }" @click="emit('input-source', 'camera')">摄像头</button>
          <button class="mini" :class="{ on: inputSource === 'mock' }" @click="emit('input-source', 'mock')">模拟</button>
        </div>
      </div>

      <!-- 左上：识别信息面板 -->
      <div class="info-panel">
        <div class="row">
          <span class="k">识别</span>
          <span class="v" :class="{ ok: frames.length > 0 }">{{ frames.length > 0 ? `${frames.length} 个身体` : '未识别' }}</span>
        </div>
        <div v-for="(f, i) in frames" :key="i" class="row">
          <span class="k">玩家 {{ f.player + 1 }}</span>
          <span class="v" :class="{ ok: f.wristVisible }">{{ f.wristVisible ? '手可见 ✓' : '手不可见 …' }}</span>
        </div>
        <div v-for="(h, i) in handInfo" :key="'h' + i" class="row">
          <span class="k">P{{ h.player + 1 }}-{{ h.side === 'right' ? '右' : '左' }}</span>
          <span class="v mono">{{ h.visible ? `(${fmt(h.x)}, ${fmt(h.y)})` : '不可见' }}</span>
        </div>
        <div class="row">
          <span class="k">下压(tap)</span>
          <span class="v mono">P1 {{ taps[0] }} · P2 {{ taps[1] }} · P3 {{ taps[2] }} · P4 {{ taps[3] }}</span>
        </div>
        <div class="row">
          <span class="k">最近</span>
          <span class="v mono">{{ lastTapInfo }}</span>
        </div>
        <div class="row">
          <span class="k">建议</span>
          <span class="v">站在镜头前、全身入画；挥手应出现骨架跟随</span>
        </div>
      </div>

      <!-- 左下：返回大厅 -->
      <div class="bottom">
        <button
          ref="backBtn"
          class="btn ghost back"
          :class="{ focus: focusOnBack }"
          @click="emit('back')"
        >返回大厅</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.test-page {
  position: fixed;
  inset: 0;
  z-index: 40;
  background: #060a0e;
  overflow: hidden;
}

/* 全屏画面 */
.preview-full {
  position: absolute;
  inset: 0;
  width: 100vw;
  height: 100vh;
  display: block;
  background: #060a0e;
}

/* 信息浮层：只读区域不挡手势，按钮区域可交互 */
.hud {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.hud button {
  pointer-events: auto;
}

/* 顶部：输入源 */
.topbar {
  position: absolute;
  top: clamp(10px, 1.5vh, 18px);
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 8px 18px;
  border-radius: 999px;
  background: rgba(10, 16, 22, 0.55);
  border: 1px solid rgba(255, 255, 255, 0.12);
  backdrop-filter: blur(6px);
}

.src-label {
  color: var(--sub);
  font-size: var(--fs-note);
  white-space: nowrap;
}

.src-btns {
  display: flex;
  gap: 8px;
}

.mini {
  font-size: var(--fs-note);
  padding: 6px 14px;
  border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.18);
  background: rgba(255, 255, 255, 0.06);
  color: var(--sub);
  cursor: pointer;
}

.mini.on {
  border-color: var(--accent);
  color: var(--fg);
  background: rgba(93, 138, 233, 0.22);
}

/* 左上：识别信息面板（紧凑、半透明，不挡画面主体） */
.info-panel {
  position: absolute;
  left: clamp(10px, 1.5vw, 20px);
  top: clamp(56px, 8vh, 88px);
  width: min(460px, 64vw);
  background: rgba(10, 16, 22, 0.55);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 14px;
  padding: 10px 16px;
  backdrop-filter: blur(6px);
}

.info-panel .row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  padding: 4px 0;
  border-bottom: 1px dashed rgba(255, 255, 255, 0.08);
  font-size: var(--fs-note);
}

.info-panel .row:last-child {
  border-bottom: none;
}

.k {
  color: var(--sub);
  white-space: nowrap;
}

.v {
  color: var(--fg);
  text-align: right;
}

.v.ok {
  color: var(--ok);
}

.mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}

/* 左下：返回大厅 */
.bottom {
  position: absolute;
  left: clamp(10px, 1.5vw, 20px);
  bottom: clamp(12px, 2vh, 24px);
}

.back {
  margin: 0;
}
</style>
