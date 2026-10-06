<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue'
import type { GameResult } from '../core/types'
import type { ScoreStore } from '../core/ScoreStore'
import type { GestureEngine } from '../core/GestureEngine'
import { createGestureUiNav } from '../core/gestureUi'

const props = defineProps<{
  result: GameResult | null
  gameId: string
  scores: ScoreStore
  gesture: GestureEngine
}>()

const emit = defineEmits<{
  (e: 'replay'): void
  (e: 'back'): void
}>()

const btnBack = ref<HTMLElement | null>(null)
const btnReplay = ref<HTMLElement | null>(null)
const focusIdx = ref(-1)
const progress = ref(0)
const cursorStyle = ref({ left: '-100px', top: '-100px', visible: false })
let nav: ReturnType<typeof createGestureUiNav> | null = null

/** 每玩家的历史：最高分 / 总场次（每次结算重新读取，统一存储） */
const bests = ref<number[]>([])
const plays = ref<number[]>([])

watch(
  () => props.result,
  (r) => {
    if (r) {
      bests.value = r.scores.map((s) => props.scores.load(props.gameId, s.player).best)
      plays.value = r.scores.map((s) => props.scores.load(props.gameId, s.player).plays)
    }
  },
  { immediate: true }
)

onMounted(() => {
  // 全局 UI 交互（hold-to-confirm）：光标停在按钮上加载满才触发
  nav = createGestureUiNav({
    gesture: props.gesture,
    targets: () => [btnBack.value, btnReplay.value].filter((x): x is HTMLElement => !!x),
    keyOf: (el) => (el === btnReplay.value ? 'replay' : 'back'),
    onActivate: (key) => {
      if (key === 'back') emit('back')
      else if (key === 'replay') emit('replay')
    },
    onStateChange: (s) => {
      cursorStyle.value = { left: `${s.x}px`, top: `${s.y}px`, visible: s.visible }
      focusIdx.value = s.key === 'back' ? 0 : s.key === 'replay' ? 1 : -1
      progress.value = s.progress
    },
  })
})

onUnmounted(() => {
  nav?.stop()
})
</script>

<template>
  <div class="overlay" id="result">
    <div class="panel">
      <div class="emoji-bg" aria-hidden="true">🐭</div>
      <h1>游戏结束</h1>
      <div v-if="result" class="rows">
        <div
          v-for="(s, i) in result.scores"
          :key="i"
          class="row"
          :class="`p${i + 1}`"
        >
          <div class="tag">玩家 {{ i + 1 }}</div>
          <div class="score mono">{{ s.score }}</div>
          <div class="meta">
            <span v-if="s.score >= bests[i] && s.score > 0" class="record">新纪录！</span>
            <span>历史最高 {{ bests[i] }}</span>
            <span>共 {{ plays[i] }} 场</span>
            <span v-for="st in s.stats ?? []" :key="st.label">{{ st.label }} {{ st.value }}</span>
          </div>
        </div>
      </div>
      <div class="btns">
        <button ref="btnBack" class="btn ghost" :class="{ focus: focusIdx === 0 }" @click="emit('back')">返回大厅</button>
        <button ref="btnReplay" class="btn" :class="{ focus: focusIdx === 1 }" @click="emit('replay')">再来一次</button>
      </div>
    </div>

    <!-- 手势光标：圆形进度条，加载满才触发 -->
    <div
      id="result-cursor"
      :class="{ active: focusIdx >= 0 }"
      :style="{ left: cursorStyle.left, top: cursorStyle.top, visibility: cursorStyle.visible ? 'visible' : 'hidden' }"
    >
      <svg class="cursor-ring" viewBox="0 0 100 100" :style="{ opacity: focusIdx >= 0 ? 1 : 0.35 }">
        <circle class="ring-bg" cx="50" cy="50" r="44"></circle>
        <circle
          class="ring-fill"
          cx="50"
          cy="50"
          r="44"
          :stroke-dasharray="`${(progress * 276.5).toFixed(1)} 276.5`"
        ></circle>
      </svg>
    </div>
  </div>
</template>

<style scoped>
.overlay {
  background:
    radial-gradient(ellipse at 28% 18%, rgba(0, 168, 232, 0.12), transparent 55%),
    radial-gradient(ellipse at 72% 26%, rgba(255, 45, 85, 0.1), transparent 55%),
    rgba(5, 9, 14, 0.86);
}

.panel {
  position: relative;
  overflow: hidden;
  background: linear-gradient(165deg, rgba(24, 34, 48, 0.95), rgba(9, 13, 21, 0.96));
  border: 1px solid rgba(255, 255, 255, 0.09);
  border-radius: 22px;
  box-shadow:
    0 0 70px rgba(0, 168, 232, 0.14),
    0 18px 40px rgba(0, 0, 0, 0.45);
}

.panel > *:not(.emoji-bg) {
  position: relative;
  z-index: 1;
}

.emoji-bg {
  position: absolute;
  right: -5%;
  bottom: -16%;
  font-size: clamp(120px, 28vh, 240px);
  opacity: 0.06;
  pointer-events: none;
  user-select: none;
  animation: emojiSway 8s ease-in-out infinite alternate;
}

@keyframes emojiSway {
  from { transform: rotate(-7deg); }
  to { transform: rotate(7deg); }
}

h1 {
  margin: 0 0 10px;
  font-size: var(--fs-hero);
  font-weight: 900;
  letter-spacing: 0.04em;
  background: linear-gradient(90deg, #bff1ff 0%, #00a8e8 45%, #ff2d55 100%);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  filter: drop-shadow(0 0 18px rgba(0, 168, 232, 0.35));
  animation: titleFloat 2.6s ease-in-out infinite;
}

@keyframes titleFloat {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-6px); }
}

.rows {
  display: flex;
  flex-direction: row;
  gap: clamp(14px, 2vw, 24px);
  margin: 20px 0 28px;
  align-items: stretch;
}

.row {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: clamp(16px, 2vw, 24px);
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.07);
}

.row.p1 {
  border-top: 5px solid var(--p1);
  box-shadow: inset 0 0 26px rgba(0, 168, 232, 0.07);
}

.row.p2 {
  border-top: 5px solid var(--p2);
  box-shadow: inset 0 0 26px rgba(255, 45, 85, 0.07);
}

.row.p3 {
  border-top: 5px solid var(--p3);
  box-shadow: inset 0 0 26px rgba(189, 0, 255, 0.07);
}

.row.p4 {
  border-top: 5px solid var(--p4);
  box-shadow: inset 0 0 26px rgba(57, 255, 20, 0.07);
}

.row .tag {
  font-size: var(--fs-note);
  color: var(--sub);
}

.row .score {
  font-size: var(--fs-hero);
  font-weight: 900;
  line-height: 1.1;
}

.row.p1 .score { color: var(--p1); }
.row.p2 .score { color: var(--p2); }
.row.p3 .score { color: var(--p3); }
.row.p4 .score { color: var(--p4); }

.row .meta {
  font-size: var(--fs-note);
  color: var(--sub);
  display: flex;
  gap: 12px 18px;
  flex-wrap: wrap;
}

.row .record {
  color: var(--accent2);
  font-weight: 700;
}

.btns {
  margin-top: 8px;
}

#result-cursor {
  position: fixed;
  width: 110px;
  height: 110px;
  margin: -55px 0 0 -55px;
  border-radius: 999px;
  z-index: 90;
  pointer-events: none;
}
#result-cursor .cursor-ring {
  width: 100%;
  height: 100%;
  transform: rotate(-90deg);
}
#result-cursor .ring-bg {
  fill: none;
  stroke: rgba(255, 255, 255, 0.18);
  stroke-width: 7;
}
#result-cursor .ring-fill {
  fill: none;
  stroke: var(--accent2);
  stroke-width: 7;
  stroke-linecap: round;
}
</style>
