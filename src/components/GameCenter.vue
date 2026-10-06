<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import type { GameSpec } from '../core/types'
import type { GestureEngine } from '../core/GestureEngine'
import { createGestureUiNav } from '../core/gestureUi'

const props = defineProps<{
  games: GameSpec[]
  gesture: GestureEngine
  inputSource: string
}>()

const emit = defineEmits<{
  (e: 'start', specId: string, playerCount: number): void
  (e: 'input-source', src: 'auto' | 'camera' | 'mock'): void
  (e: 'open-test'): void
}>()

const playerCount = ref(1)
const settingsOpen = ref(false)
const focusKey = ref('')
const progress = ref(0)
const focusStyle = ref({ left: '-100px', top: '-100px', visible: false })
let nav: ReturnType<typeof createGestureUiNav> | null = null

const srcOptions = { auto: '自动', camera: '摄像头', mock: '模拟' } as const

function diffText(d: 'easy' | 'normal' | 'hard'): string {
  return d === 'easy' ? '简单' : d === 'normal' ? '中等' : '困难'
}

function setPlayers(n: 1 | 2 | 3 | 4) {
  playerCount.value = n
}

function pickGame(g: GameSpec) {
  if (playerCount.value > g.maxPlayers) playerCount.value = g.maxPlayers
  emit('start', g.id, playerCount.value)
}

function execute(key: string) {
  if (!key) return
  if (key.startsWith('src-')) {
    const src = key.slice(4) as 'auto' | 'camera' | 'mock'
    if (src in srcOptions) emit('input-source', src)
    return
  }
  if (key === 'settings') {
    settingsOpen.value = true
    return
  }
  if (key === 'test') {
    emit('open-test')
    return
  }
  if (/^p[1-4]$/.test(key)) {
    setPlayers(Number(key.slice(1)) as 1 | 2 | 3 | 4)
    return
  }
  if (key === 'close') {
    settingsOpen.value = false
    return
  }
  // 否则是游戏卡片
  const g = props.games.find((x) => x.id === key)
  if (g) pickGame(g)
}

onMounted(() => {
  // 全局 UI 交互（hold-to-confirm）：光标命中目标 → 进度加载满才触发
  nav = createGestureUiNav({
    gesture: props.gesture,
    // 层级优先：设置面板按钮（[data-act] 浮层）→ 游戏卡片（[data-gid] 底层）
    targets: () => {
      const acts = Array.from(document.querySelectorAll('[data-act]')) as HTMLElement[]
      const gids = Array.from(document.querySelectorAll('[data-gid]')) as HTMLElement[]
      return [...acts, ...gids]
    },
    keyOf: (el) => el.dataset.act ?? el.dataset.gid ?? '',
    onActivate: (key) => execute(key),
    onStateChange: (s) => {
      focusStyle.value = { left: `${s.x}px`, top: `${s.y}px`, visible: s.visible }
      focusKey.value = s.key
      progress.value = s.progress
    },
  })
})

onUnmounted(() => {
  nav?.stop()
})
</script>

<template>
  <div class="overlay" id="lobby">
    <h1>Arcade 体感游戏</h1>

    <!-- 标题下横向一行：副标题 + 人数筛选（紧凑标签） -->
    <div class="bar">
      <div class="sub">像活力街一样，用摄像头玩体感游戏</div>
      <div class="players">
        <button
          v-for="n in [1, 2, 3, 4]"
          :key="n"
          class="chip"
          :class="{ on: playerCount === n, focus: focusKey === 'p' + n }"
          :data-act="'p' + n"
          @click="setPlayers(n as 1 | 2 | 3 | 4)"
        >{{ n }} 人</button>
      </div>
    </div>

    <!-- 游戏网格：3 列，未来 9 个游戏排 3×3 -->
    <div class="cards">
      <div
        v-for="g in games"
        :key="g.id"
        ref="cardEls"
        class="card"
        :data-gid="g.id"
        :class="{ focus: focusKey === g.id }"
        @click="pickGame(g)"
      >
        <div class="icon">{{ g.icon }}</div>
        <div class="name">{{ g.name }}</div>
        <div class="desc">{{ g.desc }}</div>
        <div class="meta">
          <span v-if="g.difficulty" class="diff" :class="g.difficulty">{{ diffText(g.difficulty) }}</span>
          <span v-if="g.controls" class="ctrl">{{ g.controls }}</span>
        </div>
        <div class="pcount">{{ playerCount }} 人 · {{ g.maxPlayers > 1 ? `支持 ${g.maxPlayers} 人` : '单人' }}</div>
      </div>
    </div>

    <!-- 底部：提示 + 唯一设置入口 -->
    <div class="foot">
      <div class="hint">先选人数（1-4 人），再体感点选游戏 · 下压 = 确认</div>
      <div class="settings">
        <button
          class="btn ghost small"
          :class="{ focus: focusKey === 'settings' }"
          data-act="settings"
          @click="settingsOpen = true"
        >⚙️ 设置</button>
      </div>
    </div>

    <!-- 设置面板：输入源（Mock / 摄像头）+ 体感测试 -->
    <div v-if="settingsOpen" class="settings-panel">
      <h2>设置</h2>
      <div class="src-group">
        <div class="label">体感输入</div>
        <div class="src-btns">
          <button
            v-for="(label, key) in srcOptions"
            :key="key"
            class="mini"
            :class="{ on: inputSource === key, focus: focusKey === 'src-' + key }"
            :data-act="'src-' + key"
            @click="emit('input-source', key)"
          >{{ label }}</button>
        </div>
      </div>
      <div class="panel-btns">
        <button
          class="btn ghost small"
          :class="{ focus: focusKey === 'test' }"
          data-act="test"
          @click="emit('open-test')"
        >🧪 体感测试</button>
        <button
          class="btn warm small"
          :class="{ focus: focusKey === 'close' }"
          data-act="close"
          @click="settingsOpen = false"
        >完成</button>
      </div>
    </div>

    <!-- 手势光标：圆形进度条，命中目标后加载满才触发点击 -->
    <div
      id="gesture-cursor"
      :class="{ active: focusKey !== '' }"
      :style="{ left: focusStyle.left, top: focusStyle.top, visibility: focusStyle.visible ? 'visible' : 'hidden' }"
    >
      <svg class="cursor-ring" viewBox="0 0 100 100" :style="{ opacity: focusKey !== '' ? 1 : 0.35 }">
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
/* 大标题：比筛选/卡片都大 */
#lobby h1 {
  font-size: var(--fs-hero);
  letter-spacing: 3px;
  margin: 0 0 6px;
  text-shadow: 0 4px 24px rgba(255, 180, 84, 0.25);
}

/* 标题下一行：副标题 + 人数筛选，横向排布（窄屏自动换行） */
.bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
  width: min(100%, 1200px);
  margin-bottom: 18px;
}

.bar .sub {
  color: var(--sub);
  font-size: var(--fs-sub);
  text-align: left;
  margin: 0;
}

/* 人数筛选：紧凑标签（未来可选 1-4 人） */
.players {
  display: flex;
  gap: 10px;
}

.players .chip {
  padding: 10px 30px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.1);
  border: 3px solid var(--line);
  color: var(--text);
  font-size: var(--fs-sub);
  font-weight: 600;
  cursor: pointer;
  transition: border-color 0.1s, background 0.1s, transform 0.1s;
}

.players .chip:hover {
  transform: scale(1.05);
}

.players .chip.on {
  border-color: var(--accent2);
  background: rgba(255, 180, 84, 0.2);
}

.players .chip.focus {
  outline: 4px solid var(--accent2);
  outline-offset: 3px;
  transform: scale(1.04);
}

/* 游戏网格：3 列，一页可排 3×3 = 9 个游戏；1 个时居中 */
.cards {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  align-content: center;
  gap: clamp(16px, 2vw, 28px);
  width: min(100%, 1200px);
  flex: 1;
  padding: 6px 0 10px;
}

.card {
  width: clamp(170px, 19vw, 250px);
  padding: clamp(14px, 2vw, 24px);
  background: rgba(23, 34, 46, 0.9);
  border: 3px solid var(--line);
  border-radius: 16px;
  cursor: pointer;
  text-align: center;
  transition: transform 0.1s, border-color 0.1s, background 0.1s;
}

.card:hover,
.card.focus {
  border-color: var(--accent2);
  background: rgba(30, 44, 60, 0.95);
  transform: scale(1.05);
}

.card .icon {
  font-size: clamp(44px, 5.5vw, 72px);
  line-height: 1;
}

.card .name {
  font-size: clamp(28px, 4vw, 46px);
  font-weight: 700;
  margin-top: 6px;
}

.card .desc {
  font-size: var(--fs-note);
  color: var(--sub);
  margin-top: 4px;
  line-height: 1.35;
}

.card .meta {
  margin-top: 8px;
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.card .meta .diff {
  font-size: var(--fs-note);
  font-weight: 700;
  padding: 2px 12px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.08);
  color: var(--sub);
}

.card .meta .diff.easy {
  color: var(--ok);
  background: rgba(88, 214, 141, 0.14);
}

.card .meta .diff.normal {
  color: var(--accent2);
  background: rgba(255, 180, 84, 0.14);
}

.card .meta .diff.hard {
  color: var(--danger);
  background: rgba(255, 107, 107, 0.14);
}

.card .meta .ctrl {
  font-size: var(--fs-note);
  color: var(--sub);
}

.card .pcount {
  font-size: var(--fs-note);
  color: var(--accent2);
  margin-top: 8px;
}

/* 底部：提示 + 设置入口 */
.foot {
  margin-top: 8px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
}

.foot .hint {
  font-size: var(--fs-note);
  color: var(--sub);
}

.settings {
  display: flex;
  gap: 10px;
  justify-content: center;
}

.btn.small {
  padding: 10px 26px;
  font-size: var(--fs-note);
}

/* ============ 设置面板 ============ */
.settings-panel {
  position: fixed;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  z-index: 35;
  min-width: min(560px, 92vw);
  max-height: 88vh;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  background: rgba(16, 24, 32, 0.97);
  border: 2px solid var(--line);
  border-radius: 20px;
  padding: clamp(20px, 3vw, 36px) clamp(24px, 4vw, 48px);
  box-shadow: 0 18px 60px rgba(0, 0, 0, 0.55);
}

.settings-panel h2 {
  font-size: var(--fs-title);
  letter-spacing: 2px;
}

.src-group {
  width: 100%;
}

.src-group .label {
  font-size: var(--fs-sub);
  color: var(--sub);
  margin-bottom: 8px;
}

.src-btns {
  display: flex;
  gap: 10px;
  justify-content: center;
  flex-wrap: wrap;
}

.mini {
  font-size: var(--fs-body);
  padding: 10px 26px;
  border-radius: 999px;
  border: 2px solid rgba(255, 255, 255, 0.18);
  background: rgba(255, 255, 255, 0.05);
  color: var(--sub);
  cursor: pointer;
  transition: border-color 0.1s, color 0.1s, background 0.1s;
}

.mini.on {
  border-color: var(--accent);
  color: var(--fg);
  background: rgba(93, 138, 233, 0.18);
}

.mini.focus,
.btn.focus {
  outline: 4px solid var(--accent2);
  outline-offset: 3px;
  transform: scale(1.04);
}

.panel-btns {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  justify-content: center;
}

/* 手势光标：圆形进度条（置于所有覆盖层之上：设置面板打开时依然可见） */
#gesture-cursor {
  position: fixed;
  width: 110px;
  height: 110px;
  margin: -55px 0 0 -55px;
  border-radius: 999px;
  z-index: 90;
  pointer-events: none;
  transition: left 0.08s linear, top 0.08s linear;
}
#gesture-cursor .cursor-ring {
  width: 100%;
  height: 100%;
  transform: rotate(-90deg);
}
#gesture-cursor .ring-bg {
  fill: none;
  stroke: rgba(255, 255, 255, 0.18);
  stroke-width: 7;
}
#gesture-cursor .ring-fill {
  fill: none;
  stroke: var(--accent2);
  stroke-width: 7;
  stroke-linecap: round;
}
</style>
