<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { GameEngine } from './core/GameEngine'
import { GestureEngine } from './core/GestureEngine'
import { AudioManager } from './core/AudioManager'
import { ScoreStore } from './core/ScoreStore'
import type { EngineEvent, EngineState } from './core/GameEngine'
import type { GestureEvent, GameResult } from './core/types'
import GameCenter from './components/GameCenter.vue'
import ResultOverlay from './components/ResultOverlay.vue'
import ReadyOverlay from './components/ReadyOverlay.vue'
import PoseOverlay from './components/PoseOverlay.vue'
import GestureTestPage from './components/GestureTestPage.vue'
import { whackAMoleSpec } from './games/whack-a-mole/WhackAMoleGame'
import { WHACK_AUDIO_ASSETS } from './games/whack-a-mole/WhackAMoleGame'

/* ---------- 引擎单例装配 ---------- */
const gesture = new GestureEngine()
const audio = new AudioManager()
const scores = new ScoreStore()
const engine = new GameEngine(gesture, audio, scores)
engine.register(whackAMoleSpec)
audio.register(WHACK_AUDIO_ASSETS)

const loading = ref(true)
const bootTip = ref('正在准备…')
const state = ref<EngineState>('lobby')
const result = ref<GameResult | null>(null)
const resultGameId = ref('')
const showRotateTip = ref(false)
/** 大厅视图 / 体感测试页视图 */
const view = ref<'lobby' | 'test'>('lobby')

const gameCanvas = ref<HTMLCanvasElement | null>(null)
const cursorCanvas = ref<HTMLCanvasElement | null>(null)

let cursorRaf = 0
let rotObserver: ResizeObserver | null = null

const inputSource = ref<'auto' | 'camera' | 'mock'>(
  (['auto', 'camera', 'mock'] as const).find((s) => s === new URLSearchParams(location.search).get('src')) ?? 'auto'
)
const effectiveSource = ref<string>('')

onMounted(async () => {
  // 竖屏提示（手机竖屏；横屏/电视正常）
  const checkRotate = () => {
    showRotateTip.value = window.innerWidth < window.innerHeight && window.innerWidth < 900
  }
  rotObserver = new ResizeObserver(checkRotate)
  rotObserver.observe(document.documentElement)
  checkRotate()

  engine.attach(gameCanvas.value!)
  engine.onState((e: EngineEvent) => {
    state.value = e.state
    if (e.state === 'over') {
      result.value = e.result ?? null
      resultGameId.value = e.gameId ?? ''
    }
  })
  // 手势事件 → 路由给当前游戏（tap/point，透传 hand）
  gesture.onEvent((e: GestureEvent) => {
    engine.routeGesture(e)
  })

  bootTip.value = '正在启动体感识别…'
  await gesture.start(1, inputSource.value)
  effectiveSource.value = gesture.effectiveSource === 'camera' ? 'camera' : 'mock'
  loading.value = false

  // 手势光标层（Mock 虚拟手 / 体感提示）
  const drawCursor = () => {
    const cv = cursorCanvas.value
    if (cv) {
      const dpr = window.devicePixelRatio || 1
      const w = window.innerWidth
      const h = window.innerHeight
      if (cv.width !== w * dpr) {
        cv.width = w * dpr
        cv.height = h * dpr
      }
      const ctx = cv.getContext('2d')!
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, w, h)
      if (!loading.value) gesture.renderCursor(ctx, w, h)
    }
    cursorRaf = requestAnimationFrame(drawCursor)
  }
  cursorRaf = requestAnimationFrame(drawCursor)
})

onUnmounted(() => {
  cancelAnimationFrame(cursorRaf)
  rotObserver?.disconnect()
  engine.detach()
  gesture.stop()
  audio.stopAll()
})

/* ---------- 对局控制 ---------- */
function startGame(specId: string, playerCount: number) {
  const spec = engine.games.find((g) => g.id === specId)
  if (!spec) return
  audio.unlock()
  // 同步体感玩家数（P2 键位/识别激活），与对局人数一致
  void gesture.setPlayerCount(playerCount)
  engine.startGame(spec, { playerCount })
}

function replay() {
  audio.unlock()
  engine.replay()
}

function backToLobby() {
  engine.backToLobby()
}

/* ---------- 体感测试页 ---------- */
function openTest() {
  view.value = 'test'
  engine.backToLobby()
}

function closeTest() {
  view.value = 'lobby'
}

/* ---------- 输入源切换（设置） ---------- */
async function setInputSource(src: 'auto' | 'camera' | 'mock') {
  inputSource.value = src
  await gesture.start(gesture.playerCount, src)
  effectiveSource.value = gesture.effectiveSource === 'camera' ? 'camera' : 'mock'
}
</script>

<template>
  <!-- 竖屏提示 -->
  <div id="rotate-tip" :class="{ hidden: !showRotateTip }">
    <div class="icon">📱</div>
    <p>请横置手机或使用投屏电视</p>
  </div>

  <!-- 游戏画布 -->
  <div class="stage">
    <canvas id="game-canvas" ref="gameCanvas"></canvas>
  </div>

  <!-- 手势光标层（Mock 虚拟手等） -->
  <canvas id="hand-cursor-layer" ref="cursorCanvas"></canvas>

  <!-- 游戏中心 -->
  <GameCenter
    v-show="view === 'lobby' && state === 'lobby' && !loading"
    :games="engine.games"
    :gesture="gesture"
    :input-source="effectiveSource"
    @start="startGame"
    @input-source="setInputSource"
    @open-test="openTest"
  />

  <!-- 站位确认（游戏开始前 3 秒） -->
  <ReadyOverlay
    v-show="view === 'lobby' && state === 'ready'"
    :engine="engine"
    :gesture="gesture"
    @cancel="backToLobby"
  />

  <!-- 右下角身体姿态小窗（任何页面常驻，摄像头/Mock 外观一致） -->
  <PoseOverlay :gesture="gesture" />

  <!-- 体感测试页 -->
  <GestureTestPage
    v-show="view === 'test'"
    :gesture="gesture"
    :input-source="effectiveSource"
    @back="closeTest"
    @input-source="setInputSource"
  />

  <!-- 结算 -->
  <ResultOverlay
    v-show="state === 'over'"
    :result="result"
    :game-id="resultGameId"
    :scores="scores"
    :gesture="gesture"
    @replay="replay"
    @back="backToLobby"
  />

  <!-- 加载遮罩 -->
  <div id="loader" v-show="loading">
    <div class="title">Arcade</div>
    <div class="bar"><i></i></div>
    <div class="tip">{{ bootTip }}</div>
  </div>
</template>
