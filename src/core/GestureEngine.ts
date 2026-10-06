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

/** MediaPipe Pose 骨架连线（用于姿态小窗/测试页绘制） */
export const POSE_CONNECTIONS: ReadonlyArray<readonly [number, number]> = [
  [0, 2], [2, 4], [0, 5], [5, 7], [0, 1], [1, 2], [1, 3], [3, 7], // 头部
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16], // 躯干+手臂
  [11, 23], [12, 24], [23, 24], [23, 25], [25, 27], [24, 26], [26, 28], // 髋+腿
]

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
  /** 平滑系数：新值占比（越大跟手越快、越小越稳） */
  private readonly SMOOTH = 0.45
  /** 静止去抖阈值（归一化位移/帧）：小于该位移视为手静止，沿用上次位置，消除高频微抖 */
  private readonly STILL_EPS = 0.0015
  /** 速度平滑系数（EMA）：抑制单帧速度尖刺 */
  private readonly SPEED_SMOOTH = 0.5

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

  /** 把 provider 的事件流接到引擎广播（转发层做全局平滑：手坐标 + 骨架点 + 速度 EMA + 静止去抖） */
  private wire(provider: PoseProvider): void {
    provider.onEvent((e) => {
      const hands = e.type === 'point' ? e.hands : e.type === 'tap' && e.hand ? [e.hand] : []
      const now = performance.now()
      for (const h of hands) {
        const key = `${h.player}:${h.side}`
        const prev = this.smoothHand.get(key)
        if (prev) {
          const dt = Math.max(0.001, (now - prev.ts) / 1000)
          const rawDx = h.x - prev.x
          const rawDy = h.y - prev.y
          if (Math.abs(rawDx) < this.STILL_EPS && Math.abs(rawDy) < this.STILL_EPS) {
            // 静止：沿用上次位置（去抖），速度衰减到 0
            h.x = prev.x
            h.y = prev.y
            h.speedX = prev.sx * (1 - this.SPEED_SMOOTH)
            h.speedY = prev.sy * (1 - this.SPEED_SMOOTH)
          } else {
            h.x = prev.x + rawDx * this.SMOOTH
            h.y = prev.y + rawDy * this.SMOOTH
            // 速度 EMA：帧间位移/时间，混合上一次速度抑制单帧尖刺
            const instX = rawDx / dt
            const instY = rawDy / dt
            h.speedX = prev.sx + (instX - prev.sx) * this.SPEED_SMOOTH
            h.speedY = prev.sy + (instY - prev.sy) * this.SPEED_SMOOTH
          }
        } else {
          h.speedX = 0
          h.speedY = 0
        }
        this.smoothHand.set(key, { x: h.x, y: h.y, sx: h.speedX, sy: h.speedY, ts: now })
      }
      if (e.type === 'point') this.hands = e.hands
      this.listeners.forEach((cb) => cb(e))
    })
    provider.onPose((frames) => {
      for (const f of frames) {
        const prev = this.smoothLand.get(f.player)
        const out: PosePoint[] = f.landmarks.map((pt, i) => {
          if (!prev?.[i]) return { ...pt }
          return {
            ...pt,
            x: prev[i].x + (pt.x - prev[i].x) * this.SMOOTH,
            y: prev[i].y + (pt.y - prev[i].y) * this.SMOOTH,
          }
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
