/* ============ GestureEngine：全局体感识别（单例） ============
   职责：
   1. 选择并启动体感源：真机摄像头(MediaPipeProvider) 或 Mock 模拟(MockProvider)
   2. 把 provider 的 GestureEvent 广播给所有订阅者（游戏中心、游戏内、HUD）
   3. 提供 playerCount 切换（单人/双人）与 provider 热切换（如体感失灵降级 Mock）
   UI 层只需要订阅事件，不关心体感来自摄像头还是模拟。 */

import type { GestureEvent, Hand, PoseFrame, PosePoint, PoseProvider } from './types'
import { MediaPipeProvider } from './providers/MediaPipeProvider'
import { MockProvider } from './providers/MockProvider'

export type InputSource = 'auto' | 'camera' | 'mock'

/** MediaPipe Pose 骨架连线（官方 PoseLandmarksConnections）
   头部语义：0 鼻 / 1-3 左眼链 / 4-6 右眼链 / 7 左耳 / 8 右耳 / 9-10 口角
   （注意 4=右眼内、7=左耳，勿与直觉左右混淆） */
export const POSE_CONNECTIONS: ReadonlyArray<readonly [number, number]> = [
  // 头部：鼻 → 左眼内 → 左眼 → 左眼外 → 左耳；鼻 → 右眼内 → 右眼 → 右眼外 → 右耳
  [0, 1], [1, 2], [2, 3], [3, 7], [0, 4], [4, 5], [5, 6], [6, 8],
  // 嘴
  [9, 10],
  // 躯干
  [11, 12],
  // 左臂 + 左手
  [11, 13], [13, 15], [15, 17], [15, 19], [15, 21], [17, 19],
  // 右臂 + 右手
  [12, 14], [14, 16], [16, 18], [16, 20], [16, 22], [18, 20],
  // 髋 + 腿 + 脚
  [11, 23], [12, 24], [23, 24], [23, 25], [24, 26], [25, 27], [26, 28],
  [27, 29], [28, 30], [29, 31], [30, 32], [27, 31], [28, 32],
]

/** One-Euro 滤波器（单轴）：
   静止时按 minCutoff 强平滑（消除识别抖动），移动时 cutoff 随速度升高（保持跟手）；
   适合摄像头体感的骨骼/手部轨迹滤波，比固定指数平滑明显更稳且不钝。
   速度差分用「原始输入」而非滤波输出：位置滤波的滞后不会传染给速度信号，
   beta 能立刻响应真实运动（否则移动开始后 cutoff 升不上去，整体发钝）。 */
class OneEuroFilter {
  private prevX = 0
  private prevRaw = 0
  private prevDx = 0
  private prevT = 0
  private initialized = false

  constructor(
    private minCutoff: number,
    private beta: number,
    private dCutoff: number,
  ) {}

  /** 输出滤波后值；minCutoffOverride 可每帧调整（如低置信度点给更强平滑） */
  filter(x: number, t: number, minCutoffOverride?: number): number {
    if (!this.initialized) {
      this.prevX = x
      this.prevRaw = x
      this.prevDx = 0
      this.prevT = t
      this.initialized = true
      return x
    }
    const dt = Math.max(0.001, (t - this.prevT) / 1000)
    // 速度 = 原始输入差分（不受位置滤波滞后拖累，实时反映运动）
    const dx = (x - this.prevRaw) / dt
    this.prevRaw = x
    // 导数平滑（速度滤波）
    const tauD = 1 / (2 * Math.PI * this.dCutoff)
    const alphaD = 1 / (1 + tauD / dt)
    const edx = this.prevDx + (dx - this.prevDx) * alphaD
    // 自适应截止频率：速度快 → 截止高 → 更跟手
    const cutoff = (minCutoffOverride ?? this.minCutoff) + this.beta * Math.abs(edx)
    const tau = 1 / (2 * Math.PI * cutoff)
    const alpha = 1 / (1 + tau / dt)
    const ex = this.prevX + (x - this.prevX) * alpha
    this.prevX = ex
    this.prevDx = edx
    this.prevT = t
    return ex
  }

  /** 最近一次平滑导数（速度，单位 = 输入单位/秒；x 轴与 y 轴实例共用此字段） */
  get dx(): number {
    return this.prevDx
  }

  /** y 轴实例的导数别名（与 dx 同字段，便于调用方按轴取名） */
  get dy(): number {
    return this.prevDx
  }
}

export class GestureEngine {
  private provider: PoseProvider | null = null
  private listeners = new Set<(e: GestureEvent) => void>()
  private poseListeners = new Set<(frames: PoseFrame[]) => void>()
  private _playerCount = 1
  private _activeSource: InputSource = 'auto'
  private _effectiveSource: 'camera' | 'mock' | null = null
  hands: Hand[] = []
  /** 最近一帧姿态（ready 站位确认 / 姿态小窗） */
  poseFrames: PoseFrame[] = []
  /** 手坐标 / 骨架点平滑缓存（key=player:side / player），减少识别帧间抖动 */
  private smoothHand = new Map<string, { x: number; y: number; sx: number; sy: number; ts: number }>()
  private smoothLand = new Map<number, PosePoint[]>()
  /** One-Euro 滤波实例缓存：每手 (x,y) 各一轴；每玩家 33 关节 × (x,y) */
  private handFilters = new Map<string, { fx: OneEuroFilter; fy: OneEuroFilter }>()
  private landFilters = new Map<number, OneEuroFilter[][]>()
  /** One-Euro 参数：骨架静止截止 0.8Hz（强平滑）+ 速度系数 0.5（动作仍响应）+ 导数截止 1Hz */
  private readonly SKEL_MIN_CUTOFF = 1.2
  private readonly SKEL_BETA = 1.0
  private readonly SKEL_D_CUTOFF = 1.0
  /** 低置信度（visibility < LOW_VIS）的骨架点：截止降为 0.25Hz，几乎保持不动，防遮挡乱跳 */
  private readonly LOW_VIS = 0.3
  private readonly LOW_VIS_CUTOFF = 0.8
  /** 极低置信度：直接沿用上次位置（识别已不可靠） */
  private readonly DEAD_VIS = 0.2
  /** 手坐标：截止 1.2Hz + 速度系数 0.15（跟手同时抑制抖动） */
  private readonly HAND_MIN_CUTOFF = 2.5
  private readonly HAND_BETA = 0.5
  private readonly HAND_D_CUTOFF = 1.0

  constructor(private createCamera: () => PoseProvider = () => new MediaPipeProvider()) {}

  get activeSource(): InputSource {
    return this._activeSource
  }

  /** 实际生效的输入源（camera | mock | null=未启动） */
  get effectiveSource(): 'camera' | 'mock' | null {
    return this._effectiveSource
  }

  get playerCount(): number {
    return this._playerCount
  }

  /** 摄像头预览视频（真机有；Mock 为 null） */
  get previewVideo(): HTMLVideoElement | null {
    return this.provider?.previewVideo ?? null
  }

  onEvent(cb: (e: GestureEvent) => void): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  /** 订阅姿态帧（骨架数据） */
  onPose(cb: (frames: PoseFrame[]) => void): () => void {
    this.poseListeners.add(cb)
    return () => this.poseListeners.delete(cb)
  }

  /**
   * 启动体感。source=auto：优先真机摄像头，失败自动降级 Mock（保证任何环境可玩）。
   * source=camera/mock：强制指定（设置面板切换）。
   */
  async start(playerCount: number, source: InputSource = 'auto'): Promise<void> {
    this._playerCount = playerCount
    this._activeSource = source
    if (this.provider) {
      this.provider.stop()
      this.provider = null
    }
    this.poseFrames = []
    this.hands = []
    this.smoothHand.clear()
    this.smoothLand.clear()
    this.handFilters.clear()
    this.landFilters.clear()
    if (source === 'mock') {
      this.provider = new MockProvider()
      await this.provider.start(playerCount)
      this._effectiveSource = 'mock'
      this.wire(this.provider)
      return
    }
    this.provider = this.createCamera()
    const ok = await this.provider.start(playerCount)
    if (!ok) {
      // 摄像头不可用：降级 Mock（保证任何环境可玩）
      this._effectiveSource = 'mock'
      this.provider.stop()
      this.provider = new MockProvider()
      this.provider.start(playerCount)
      this.wire(this.provider)
      return
    }
    this._effectiveSource = this.provider.name === 'camera' ? 'camera' : 'mock'
    this.wire(this.provider)
  }

  /** 把 provider 的事件流接到引擎广播（转发层做全局平滑：One-Euro 自适应滤波 + 静止去抖） */
  private wire(provider: PoseProvider): void {
    provider.onEvent((e) => {
      const hands = e.type === 'point' ? e.hands : e.type === 'tap' && e.hand ? [e.hand] : []
      const now = performance.now()
      for (const h of hands) {
        const key = `${h.player}:${h.side}`
        // One-Euro 手坐标滤波（静止强平滑 / 挥动跟手）；速度取滤波器平滑导数（抑制单帧尖刺）
        let fs = this.handFilters.get(key)
        if (!fs) {
          fs = {
            fx: new OneEuroFilter(this.HAND_MIN_CUTOFF, this.HAND_BETA, this.HAND_D_CUTOFF),
            fy: new OneEuroFilter(this.HAND_MIN_CUTOFF, this.HAND_BETA, this.HAND_D_CUTOFF),
          }
          this.handFilters.set(key, fs)
        }
        const nx = fs.fx.filter(h.x, now)
        const ny = fs.fy.filter(h.y, now)
        h.x = nx
        h.y = ny
        h.speedX = fs.fx.dx
        h.speedY = fs.fy.dy
        this.smoothHand.set(key, { x: h.x, y: h.y, sx: h.speedX, sy: h.speedY, ts: now })
      }
      if (e.type === 'point') this.hands = e.hands
      this.listeners.forEach((cb) => cb(e))
    })
    provider.onPose((frames) => {
      const now = performance.now()
      for (const f of frames) {
        let filters = this.landFilters.get(f.player)
        if (!filters) {
          filters = Array.from({ length: 33 }, () => [
            new OneEuroFilter(this.SKEL_MIN_CUTOFF, this.SKEL_BETA, this.SKEL_D_CUTOFF),
            new OneEuroFilter(this.SKEL_MIN_CUTOFF, this.SKEL_BETA, this.SKEL_D_CUTOFF),
          ])
          this.landFilters.set(f.player, filters)
        }
        const prev = this.smoothLand.get(f.player)
        const out = f.landmarks.map((pt, i) => {
          const fx = filters[i][0]
          const fy = filters[i][1]
          const v = pt.visibility ?? 1
          // 极低置信度（遮挡/出镜）：直接沿用上次位置，不跳
          if (v < this.DEAD_VIS) {
            if (prev?.[i]) return prev[i]
            return { ...pt }
          }
          // 低置信度：截止降为 0.25Hz（几乎保持不动），防遮挡瞬间乱跳
          const mc = v < this.LOW_VIS ? this.LOW_VIS_CUTOFF : this.SKEL_MIN_CUTOFF
          return { ...pt, x: fx.filter(pt.x, now, mc), y: fy.filter(pt.y, now, mc) }
        })
        this.smoothLand.set(f.player, out)
        f.landmarks = out
      }
      this.poseFrames = frames
      this.poseListeners.forEach((cb) => cb(frames))
    })
  }

  /** 切换玩家数（重启识别） */
  async setPlayerCount(n: number): Promise<void> {
    if (n === this._playerCount) return
    const src = this._activeSource
    await this.start(n, src)
  }

  /** 停止并释放摄像头 */
  stop(): void {
    if (this.provider) {
      this.provider.stop()
      this.provider = null
    }
    this.hands = []
    this._effectiveSource = null
  }

  /** 由叠加层调用：渲染手部光标（Mock 才有可视化） */
  renderCursor(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    if (this.provider?.renderCursor) this.provider.renderCursor(ctx, w, h)
  }
}
