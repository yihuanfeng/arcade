<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import type { GestureEngine } from '../core/GestureEngine'
import type { PoseFrame } from '../core/types'
import { drawPoseFrames } from '../core/poseRender'

const props = defineProps<{
  gesture: GestureEngine
}>()

const canvasRef = ref<HTMLCanvasElement | null>(null)
let raf = 0
let offPose: (() => void) | null = null
let frames: PoseFrame[] = []
/** 内部固定渲染尺寸（小窗） */
const W = 240
const H = 180

function draw() {
  const cv = canvasRef.value
  if (cv) {
    const ctx = cv.getContext('2d')!
    ctx.clearRect(0, 0, W, H)
    // 统一外观：半透明深色底 + 霓虹骨架（摄像头与 Mock 不做区别，无边框）
    ctx.fillStyle = 'rgba(6,10,14,0.45)'
    ctx.fillRect(0, 0, W, H)
    drawPoseFrames(ctx, frames, W, H, { lineWidth: 3, drawPoints: true, filterVisible: true })
  }
  raf = requestAnimationFrame(draw)
}

onMounted(() => {
  offPose = props.gesture.onPose((f) => {
    frames = f
  })
  raf = requestAnimationFrame(draw)
})

onUnmounted(() => {
  cancelAnimationFrame(raf)
  offPose?.()
})
</script>

<template>
  <div class="pose-window">
    <canvas ref="canvasRef" :width="W" :height="H"></canvas>
  </div>
</template>

<style scoped>
.pose-window {
  position: fixed;
  right: clamp(14px, 2vw, 32px);
  bottom: clamp(14px, 2vw, 32px);
  z-index: 70;
  border-radius: 12px;
  overflow: hidden;
  pointer-events: none;
}

.pose-window canvas {
  display: block;
  width: min(240px, 24vw);
  aspect-ratio: 4 / 3;
}
</style>
