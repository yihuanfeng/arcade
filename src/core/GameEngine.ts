/* ============ GameEngine：游戏引擎核心 ============
   职责：
   1. 游戏注册表（Games.register）：游戏中心从这取卡片数据
   2. 对局状态机：LOBBY → PLAYING → OVER（结算）→ 再来一局/返回
   3. 主循环：固定逻辑分辨率 1280×720，rAF 驱动 update/render
   4. 手势事件路由：gesture 事件 → 当前游戏 onGesture
   5. 结果落库：GameResult → ScoreStore.submit，并对外广播结算数据
   UI（App.vue）只订阅状态与结果，游戏模块只实现 GameInstance 接口。 */

import type { GameContext, GameInstance, GameResult, GameSpec, GestureEvent, Hand, MatchConfig, Rect } from './types'
import type { GestureEngine } from './GestureEngine'
import type { AudioManager } from './AudioManager'
import type { ScoreStore } from './ScoreStore'

export const VIEW_W = 1280
export const VIEW_H = 720

/** 站位确认时长（秒）：所有玩家姿态（手腕）可见持续该时长后游戏开始 */
export const READY_SECONDS = 3

export type EngineState = 'lobby' | 'ready' | 'playing' | 'over'

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
  }

  detach(): void {
    cancelAnimationFrame(this.raf)
    this.ctx2d = null
  }

  /** 开始一局：创建游戏实例并进入站位确认（ready），姿态可见满 3 秒后自动开始 */
  startGame(spec: GameSpec, match: MatchConfig): void {
    if (this.currentGame) {
      if (this.state === 'playing') this.currentGame.onExit()
      this.currentGame = null
    }
    this.currentSpec = spec
    this.match = match
    const ctx: GameContext = { engine: this, gesture: this.gesture, audio: this.audio, scores: this.scores, match }
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
      if (this.state === 'playing') this.currentGame.onExit()
      this.currentGame = null
    }
    this.currentSpec = null
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
       画布等比缩放后两者不一致：x 全区直通（与 provider 一致，无需转换），
       y 需要从视口高度换算到画布显示高度。 */
  routeGesture(e: GestureEvent): void {
    if (this.state !== 'playing' || !this.currentGame || !this.canvas) return
    const hands: Hand[] = []
    if (e.type === 'point' && e.hands.length > 0) hands.push(...e.hands)
    if (e.type === 'tap' && e.hand) hands.push(e.hand)
    if (hands.length > 0) {
      const rect = this.canvas.getBoundingClientRect()
      const vh = window.innerHeight
      for (const h of hands) {
        h.y = Math.min(1, Math.max(0, (h.y * vh - rect.top) / rect.height))
      }
    }
    this.currentGame.onGesture(e)
  }
}

/* ---------- 工具：坐标转换（手坐标全区直通：provider 输出即视口归一化） ---------- */

/** 玩家显示区（仅用于 HUD/红闪等显示布局；手光标不再分区映射） */
export function playerZone(player: number, playerCount: number): Rect {
  if (playerCount === 1) return { x: 0, y: 0, w: 1, h: 1 }
  return player === 0 ? { x: 0, y: 0, w: 0.5, h: 1 } : { x: 0.5, y: 0, w: 0.5, h: 1 }
}

/** 手归一化坐标 → 画布像素坐标（全区直通：任何玩家手坐标=实际位置） */
export function handToScreen(hx: number, hy: number, w: number, h: number) {
  return {
    x: hx * w,
    y: hy * h,
  }
}
