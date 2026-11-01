/* ============ GameEngine：游戏引擎核心 ============
   职责：
   1. 游戏注册表（Games.register）：游戏中心从这取卡片数据
   2. 对局状态机：LOBBY → READY → PLAYING → OVER（结算）→ 再来一局/返回；切后台 → PAUSED
   3. 主循环：固定逻辑分辨率 1280×720，rAF 驱动 update/render
   4. 手势事件路由：gesture 事件 → 当前游戏 onGesture（视口归一化 → 画布归一化，toCanvas 统一封装）
   5. 结果落库：GameResult → ScoreStore.submit（统一存储），并对外广播结算数据
   6. 通用表现工具箱：每局注入 GameKit（fx），换局自动清空
   UI（App.vue）只订阅状态与结果，游戏模块只实现 GameInstance 接口。 */

import type { GameContext, GameInstance, GameResult, GameSpec, GestureEvent, Hand, MatchConfig, Rect } from './types'
import type { GestureEngine } from './GestureEngine'
import type { AudioManager } from './AudioManager'
import type { ScoreStore } from './ScoreStore'
import { GameKit } from './gameKit'

export const VIEW_W = 1280
export const VIEW_H = 720

/** 站位确认时长（秒）：所有玩家姿态（手腕）可见持续该时长后游戏开始 */
export const READY_SECONDS = 3

export type EngineState = 'lobby' | 'ready' | 'playing' | 'paused' | 'over'

export interface EngineEvent {
  state: EngineState
  /** 结算数据（state=over 时存在） */
  result?: GameResult
  gameId?: string
}

export class GameEngine {
  games: GameSpec[] = []
  currentGame: GameInstance | null = null
  currentSpec: GameSpec | null = null
  match: MatchConfig = { playerCount: 1 }
  state: EngineState = 'lobby'

  /** 站位确认累计时长（秒，0..READY_SECONDS） */
  readyTime = 0

  private ctx2d: CanvasRenderingContext2D | null = null
  private canvas: HTMLCanvasElement | null = null
  private raf = 0
  private lastT = 0
  private stateListeners = new Set<(e: EngineEvent) => void>()
  /** 通用表现工具箱（每局注入 GameContext.fx，换局自动清空） */
  private fx = new GameKit()

  constructor(
    public readonly gesture: GestureEngine,
    public readonly audio: AudioManager,
    public readonly scores: ScoreStore,
  ) {}

  register(spec: GameSpec): void {
    this.games.push(spec)
  }

  onState(cb: (e: EngineEvent) => void): () => void {
    this.stateListeners.add(cb)
    return () => this.stateListeners.delete(cb)
  }

  private emit(e: EngineEvent): void {
    this.stateListeners.forEach((cb) => cb(e))
  }

  /** 绑定画布并启动主循环 */
  attach(canvas: HTMLCanvasElement): void {
    canvas.width = VIEW_W
    canvas.height = VIEW_H
    this.canvas = canvas
    this.ctx2d = canvas.getContext('2d')
    this.lastT = performance.now()
    this.raf = requestAnimationFrame(this.loop)
    document.addEventListener('visibilitychange', this.onVisibility)
  }

  detach(): void {
    cancelAnimationFrame(this.raf)
    document.removeEventListener('visibilitychange', this.onVisibility)
    this.ctx2d = null
  }

  /** 切后台暂停对局 / 回前台恢复（投屏、来电等场景），调游戏的 pause/resume */
  private onVisibility = (): void => {
    if (document.hidden && this.state === 'playing') {
      this.state = 'paused'
      this.currentGame?.pause?.()
      this.emit({ state: 'paused', gameId: this.currentSpec?.id })
    } else if (!document.hidden && this.state === 'paused') {
      this.state = 'playing'
      this.currentGame?.resume?.()
      this.emit({ state: 'playing', gameId: this.currentSpec?.id })
    }
  }

  /** 视口归一化坐标 → 画布逻辑坐标（1280×720 空间）。
       画布等比缩放居中时 rect 有偏移，x/y 都必须换算，不能假设视口 = 画布。 */
  toCanvas(hx: number, hy: number): { x: number; y: number } {
    const canvas = this.canvas
    if (!canvas) return { x: hx * VIEW_W, y: hy * VIEW_H }
    const rect = canvas.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return { x: hx * VIEW_W, y: hy * VIEW_H }
    const px = hx * window.innerWidth - rect.left
    const py = hy * window.innerHeight - rect.top
    return { x: (px / rect.width) * VIEW_W, y: (py / rect.height) * VIEW_H }
  }

  /** 开始一局：创建游戏实例并进入站位确认（ready），姿态可见满 3 秒后自动开始 */
  startGame(spec: GameSpec, match: MatchConfig): void {
    if (this.currentGame) {
      if (this.state === 'playing' || this.state === 'paused') this.currentGame.onExit()
      this.currentGame = null
    }
    this.currentSpec = spec
    this.match = match
    this.audio.setNamespace(spec.id)
    this.fx.clear()
    const ctx: GameContext = { engine: this, gesture: this.gesture, audio: this.audio, scores: this.scores, match, fx: this.fx }
    this.currentGame = spec.create(ctx)
    this.state = 'ready'
    this.readyTime = 0
    this.emit({ state: 'ready', gameId: spec.id })
  }

  /** 站位确认通过后的内部回调（loop 调用） */
  private beginRound(): void {
    if (!this.currentGame) return
    this.currentGame.onEnter()
    this.state = 'playing'
    this.readyTime = 0
    this.emit({ state: 'playing', gameId: this.currentSpec?.id })
  }

  /** 游戏结束时调用（游戏内 ctx.engine.endGame） */
  endGame(result: GameResult): void {
    if (this.state !== 'playing' || !this.currentSpec) return
    this.scores.submit(this.currentSpec.id, result)
    this.state = 'over'
    this.emit({ state: 'over', gameId: this.currentSpec.id, result })
  }

  /** 返回大厅 */
  backToLobby(): void {
    if (this.currentGame) {
      if (this.state === 'playing' || this.state === 'paused') this.currentGame.onExit()
      this.currentGame = null
    }
    this.currentSpec = null
    this.audio.setNamespace('')
    this.state = 'lobby'
    this.readyTime = 0
    this.emit({ state: 'lobby' })
  }

  /** 同一游戏再来一局 */
  replay(): void {
    if (!this.currentSpec) return
    this.startGame(this.currentSpec, this.match)
  }

  private loop = (t: number) => {
    try {
      const dt = Math.min(0.05, (t - this.lastT) / 1000)
      this.lastT = t
      if (this.state === 'ready') {
        // 站位确认：所有玩家姿态可见持续满 READY_SECONDS 后开始
        const expected = this.match.playerCount
        const frames = this.gesture.poseFrames
        const allVisible = frames.length >= expected && frames.every((f) => f.wristVisible)
        this.readyTime = allVisible ? this.readyTime + dt : 0
        if (this.readyTime >= READY_SECONDS) this.beginRound()
      } else if (this.state === 'playing' && this.currentGame && this.ctx2d) {
        this.currentGame.update(dt)
        this.currentGame.render(this.ctx2d, VIEW_W, VIEW_H)
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[arcade:loop]', err)
    }
    this.raf = requestAnimationFrame(this.loop)
  }

  /** 手势事件路由给当前游戏。
       Provider 输出的手坐标是「视口归一化」；游戏逻辑使用「画布归一化」。
       toCanvas 统一把两者换算（处理画布等比缩放居中时的 x/y 偏移）。 */
  routeGesture(e: GestureEvent): void {
    if (this.state !== 'playing' || !this.currentGame || !this.canvas) return
    const hands: Hand[] = []
    if (e.type === 'point' && e.hands.length > 0) hands.push(...e.hands)
    if (e.type === 'tap' && e.hand) hands.push(e.hand)
    if (hands.length > 0) {
      for (const h of hands) {
        const c = this.toCanvas(h.x, h.y)
        h.x = Math.min(1, Math.max(0, c.x / VIEW_W))
        h.y = Math.min(1, Math.max(0, c.y / VIEW_H))
      }
    }
    this.currentGame.onGesture(e)
  }
}

/* ---------- 工具：坐标转换（手坐标全区直通：provider 输出即视口归一化） ---------- */

/** 玩家显示区（仅用于 HUD/红闪等显示布局；手光标不再分区映射，按人数 N 等分） */
export function playerZone(player: number, playerCount: number): Rect {
  if (playerCount === 1) return { x: 0, y: 0, w: 1, h: 1 }
  const seg = 1 / playerCount
  return { x: player * seg, y: 0, w: seg, h: 1 }
}

/** 手归一化坐标 → 画布像素坐标（全区直通：任何玩家手坐标=实际位置） */
export function handToScreen(hx: number, hy: number, w: number, h: number) {
  return {
    x: hx * w,
    y: hy * h,
  }
}
