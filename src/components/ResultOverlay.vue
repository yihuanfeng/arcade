<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
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

/** 每玩家的历史最佳（挂载时取一次） */
const bests = ref<number[]>([])

onMounted(() => {
  if (props.result) {
    bests.value = props.result.scores.map((s) => props.scores.load(props.gameId, s.player).best)
  }
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
      <h1>游戏结束</h1>
      <div v-if="result" class="rows">
        <div
          v-for="(s, i) in result.scores"
          :key="i"
          class="row"
          :class="{ p1: i === 0, p2: i === 1 }"
        >
          <div class="tag">玩家 {{ i + 1 }}</div>
          <div class="score mono">{{ s.score }}</div>
          <div class="meta">
            <span v-if="s.score >= bests[i] && s.score > 0" class="record">新纪录！</span>
            <span>最高 {{ bests[i] }}</span>
            <span>击中 {{ s.hits }} 次</span>
            <span>连击最高 {{ s.maxCombo }}</span>
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
.rows {
  display: flex;
  flex-direction: column;
  gap: clamp(16px, 2.5vw, 28px);
  margin: 16px 0 24px;
}

.row {
  padding: clamp(14px, 2vw, 22px) clamp(24px, 3vw, 40px);
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.05);
}

.row.p1 {
  border-left: 8px solid var(--ok);
}

.row.p2 {
  border-left: 8px solid var(--accent2);
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

.row.p1 .score { color: var(--ok); }
.row.p2 .score { color: var(--accent2); }

.row .meta {
  font-size: var(--fs-note);
  color: var(--sub);
  display: flex;
  gap: 18px;
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
