<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import type { GameEngine } from '../core/GameEngine'
import { READY_SECONDS } from '../core/GameEngine'
import type { GestureEngine } from '../core/GestureEngine'
import type { PoseFrame } from '../core/types'
import { drawPoseFrames } from '../core/poseRender'

const props = defineProps<{
  engine: GameEngine
  gesture: GestureEngine
}>()

const emit = defineEmits<{
  (e: 'cancel'): void
}>()

const progress = ref(0)
const playersOk = ref<boolean[]>([])
const previewRef = ref<HTMLCanvasElement | null>(null)
let raf = 0
let offPose: (() => void) | null = null
let latestFrames: PoseFrame[] = []

function draw() {
  const cv = previewRef.value
  if (cv) {
    const ctx = cv.getContext('2d')!
    const w = cv.width
    const h = cv.height
    ctx.clearRect(0, 0, w, h)
    // 背景：摄像头画面（真机）或深色底（Mock）
    const video = props.gesture.previewVideo
    if (video && video.readyState >= 2 && video.videoWidth > 0) {
      ctx.save()
      ctx.scale(-1, 1) // 照镜子
      const vw = video.videoWidth
      const vh = video.videoHeight
      const scale = Math.max(w / vw, h / vh)
      const dw = vw * scale
      const dh = vh * scale
      ctx.drawImage(video, -dw + (w - dw) / 2, (h - dh) / 2, dw, dh)
      ctx.restore()
    } else {
      ctx.fillStyle = 'rgba(10,16,22,0.85)'
      ctx.fillRect(0, 0, w, h)
    }
    // 站位状态：每玩家一帧，腕可见 = 该玩家已就位
    const expected = props.engine.match.playerCount
    playersOk.value = Array.from({ length: expected }, (_, p) => {
      const f = latestFrames.find((x) => x.player === p)
      return !!f?.wristVisible
    })
    // 方形站位区（画在人形下层）：默认白框，识别到人 = 绿框
    const n = expected
    const seg = 1 / n
    for (let p = 0; p < n; p++) {
      const ok = playersOk.value[p]
      const cx = (p + 0.5) * seg * w
      const bw = seg * w * 0.62
      const bh = h * 0.72
      const bx = cx - bw / 2
      const by = h * 0.2
      ctx.save()
      ctx.strokeStyle = ok ? '#58d68d' : '#ffffff'
      ctx.globalAlpha = ok ? 0.95 : 0.55
      ctx.lineWidth = Math.max(3, w * 0.006)
      ctx.strokeRect(bx, by, bw, bh)
      ctx.restore()
    }
    drawPoseFrames(ctx, latestFrames, w, h, { filterVisible: true })
  }
  progress.value = props.engine.readyTime / READY_SECONDS
  raf = requestAnimationFrame(draw)
}

onMounted(() => {
  offPose = props.gesture.onPose((frames) => {
    latestFrames = frames
  })
  raf = requestAnimationFrame(draw)
})

onUnmounted(() => {
  cancelAnimationFrame(raf)
  offPose?.()
})
</script>

<template>
  <div class="overlay" id="ready">
    <div class="panel">
      <h1>请站好，保持姿势</h1>
      <div class="players">
        <div
          v-for="(ok, i) in playersOk"
          :key="i"
          class="player"
          :class="{ ok }"
        >
          <span class="mark">{{ ok ? '✓' : '○' }}</span> 玩家 {{ i + 1 }}
        </div>
      </div>
      <div class="progress">
        <div class="bar" :style="{ width: Math.round(progress * 100) + '%' }"></div>
      </div>
      <div class="tip">识别到身体后保持 3 秒，游戏自动开始</div>
      <canvas ref="previewRef" class="preview"></canvas>
      <button class="btn ghost" @click="emit('cancel')">返回大厅</button>
    </div>
  </div>
</template>

<style scoped>
#ready .panel {
  text-align: center;
  /* 面板内容压缩进一屏：禁止内部滚动，返回按钮不被挤出 */
  overflow: hidden;
}

#ready h1 {
  font-size: var(--fs-title);
  color: var(--fg);
}

.players {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 12px 24px;
  margin: 8px 0;
}

.player {
  font-size: var(--fs-body);
  padding: 6px 18px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.06);
  color: var(--sub);
  white-space: nowrap;
}

.player .mark {
  display: inline-block;
  width: 1.2em;
  text-align: center;
}

.player.ok {
  background: rgba(88, 214, 141, 0.16);
  color: var(--ok);
}

.progress {
  width: min(460px, 70%);
  height: 16px;
  margin: 8px auto;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.08);
  overflow: hidden;
}

.bar {
  height: 100%;
  border-radius: 999px;
  background: linear-gradient(90deg, var(--ok), #7ce8a9);
  transition: width 0.1s linear;
}

.tip {
  font-size: var(--fs-note);
  color: var(--sub);
  margin-bottom: 8px;
}

.preview {
  display: block;
  /* 高度受视口约束（给标题/进度/按钮留空间），宽度按 4:3 自适应 */
  height: min(calc(100vh - 320px), 300px);
  aspect-ratio: 4 / 3;
  margin: 0 auto 8px;
  border-radius: 14px;
  background: #0a1016;
}

#ready .btn {
  margin-top: 2px;
}
</style>
