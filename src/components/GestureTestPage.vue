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

/** 预览画布尺寸（固定逻辑分辨率） */
const PW = 640
const PH = 480

/** 坐标格式化：非有限数显示 —（MediaPipe 低可见度时可能输出 NaN） */
function fmt(v: number): string {
  return Number.isFinite(v) ? v.toFixed(2) : '—'
}

function drawPreview() {
  const cv = previewRef.value
  if (cv) {
    const ctx = cv.getContext('2d')!
    ctx.clearRect(0, 0, PW, PH)
    const video = props.gesture.previewVideo
    if (video && video.readyState >= 2 && video.videoWidth > 0) {
      ctx.save()
      ctx.scale(-1, 1) // 照镜子
      const vw = video.videoWidth
      const vh = video.videoHeight
      const scale = Math.max(PW / vw, PH / vh)
      const dw = vw * scale
      const dh = vh * scale
      ctx.drawImage(video, -dw + (PW - dw) / 2, (PH - dh) / 2, dw, dh)
      ctx.restore()
    } else {
      ctx.fillStyle = '#0a1016'
      ctx.fillRect(0, 0, PW, PH)
      // Mock 提示网格
      ctx.strokeStyle = 'rgba(255,255,255,0.10)'
      ctx.lineWidth = 1
      for (let gx = 0; gx <= 4; gx++) {
        ctx.beginPath()
        ctx.moveTo((gx / 4) * PW, 0)
        ctx.lineTo((gx / 4) * PW, PH)
        ctx.stroke()
      }
      for (let gy = 0; gy <= 3; gy++) {
        ctx.beginPath()
        ctx.moveTo(0, (gy / 3) * PH)
        ctx.lineTo(PW, (gy / 3) * PH)
        ctx.stroke()
      }
    }
    drawPoseFrames(ctx, frames.value, PW, PH, { lineWidth: 5, drawPoints: true })
  }
  raf = requestAnimationFrame(drawPreview)
}

onMounted(() => {
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
  offEvent?.()
  offPose?.()
  nav?.stop()
})
</script>

<template>
  <div class="test-page" id="gesture-test">
    <h1>体感测试</h1>
    <div class="src-line">
      <span>输入源：{{ inputSource === 'camera' ? '📷 摄像头' : inputSource === 'mock' ? '🖱 Mock' : '自动' }}</span>
      <div class="src-btns">
        <button class="mini" :class="{ on: inputSource === 'auto' }" @click="emit('input-source', 'auto')">自动</button>
        <button class="mini" :class="{ on: inputSource === 'camera' }" @click="emit('input-source', 'camera')">摄像头</button>
        <button class="mini" :class="{ on: inputSource === 'mock' }" @click="emit('input-source', 'mock')">模拟</button>
      </div>
    </div>

    <div class="grid">
      <div class="stage-box">
        <canvas ref="previewRef" :width="PW" :height="PH"></canvas>
        <div class="hint">
          {{ props.gesture.previewVideo ? '摄像头画面 + 骨架（照镜子）' : 'Mock 双手：鼠标=右手 · WASD=左手' }}
        </div>
      </div>

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
    </div>

    <button
      ref="backBtn"
      class="btn ghost back"
      :class="{ focus: focusOnBack }"
      @click="emit('back')"
    >返回大厅</button>

    <!-- 手势光标：圆形进度条，加载满才触发返回 -->
    <div
      id="test-cursor"
      :class="{ active: focusOnBack }"
      :style="{ left: cursorStyle.left, top: cursorStyle.top, visibility: cursorStyle.visible ? 'visible' : 'hidden' }"
    >
      <svg class="cursor-ring" viewBox="0 0 100 100" :style="{ opacity: focusOnBack ? 1 : 0.35 }">
        <circle class="ring-bg" cx="50" cy="50" r="44"></circle>
        <circle
          class="ring-fill"
          cx="50"
          cy="50"
          r="44"
          :stroke-dasharray="`${(backProgress * 276.5).toFixed(1)} 276.5`"
        ></circle>
      </svg>
    </div>
  </div>
</template>

<style scoped>
.test-page {
  position: fixed;
  inset: 0;
  z-index: 40;
  background: radial-gradient(1200px 600px at 50% -10%, #14222e 0%, #0a1118 55%, #060a0e 100%);
  display: flex;
  flex-direction: column;
  align-items: center;
  /* 体感页面禁止滚动：所有内容压缩进一屏 */
  overflow: hidden;
  padding: clamp(12px, 2vh, 22px) clamp(16px, 3vw, 48px);
  justify-content: flex-start;
}

.test-page h1 {
  font-size: var(--fs-title);
  color: var(--fg);
  margin-bottom: 4px;
}

.src-line {
  display: flex;
  align-items: center;
  gap: 14px;
  color: var(--sub);
  font-size: var(--fs-note);
  margin-bottom: clamp(6px, 1.2vh, 12px);
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
  background: rgba(255, 255, 255, 0.05);
  color: var(--sub);
  cursor: pointer;
}

.mini.on {
  border-color: var(--accent);
  color: var(--fg);
  background: rgba(93, 138, 233, 0.18);
}

.grid {
  display: flex;
  gap: clamp(14px, 2.5vw, 28px);
  /* 不换行：画布与信息面板始终并排，避免撑高 */
  flex-wrap: nowrap;
  align-items: stretch;
  justify-content: center;
  width: 100%;
  max-width: 1080px;
  min-height: 0;
}

.stage-box {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.stage-box canvas {
  display: block;
  /* 高度受视口约束（留出标题/按钮空间），宽度按 4:3 自适应 */
  height: min(calc(100vh - 250px), 470px);
  aspect-ratio: 4 / 3;
  border-radius: 14px;
  background: #0a1016;
  border: 1px solid rgba(255, 255, 255, 0.1);
}

.stage-box .hint {
  font-size: var(--fs-note);
  color: var(--sub);
  text-align: center;
  margin-top: 6px;
}

.info-panel {
  flex: 1;
  min-width: 240px;
  max-width: 400px;
  background: rgba(255, 255, 255, 0.045);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 14px;
  padding: clamp(10px, 1.5vw, 16px);
}

.info-panel .row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
  padding: 5px 0;
  border-bottom: 1px dashed rgba(255, 255, 255, 0.09);
  font-size: var(--fs-sub);
}

.info-panel .row:last-child {
  border-bottom: none;
}

.k {
  color: var(--sub);
}

.v {
  color: var(--fg);
}

.v.ok {
  color: var(--ok);
}

.mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.92em;
}

.back {
  margin-top: clamp(8px, 1.5vh, 16px);
}

#test-cursor {
  position: fixed;
  width: 90px;
  height: 90px;
  margin: -45px 0 0 -45px;
  border-radius: 999px;
  z-index: 90;
  pointer-events: none;
}
#test-cursor .cursor-ring {
  width: 100%;
  height: 100%;
  transform: rotate(-90deg);
}
#test-cursor .ring-bg {
  fill: none;
  stroke: rgba(255, 255, 255, 0.18);
  stroke-width: 7;
}
#test-cursor .ring-fill {
  fill: none;
  stroke: var(--accent2);
  stroke-width: 7;
  stroke-linecap: round;
}
</style>
