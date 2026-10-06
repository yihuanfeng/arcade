/* ============ Arcade 体感平台 · 核心类型 ============ */

/** 一只手的状态（逻辑坐标 0..1 归一化，相对各自玩家的映射区域） */
export interface Hand {
  /** 玩家索引（0=P1，1=P2） */
  player: number
  /** 左右手标识 */
  side: 'left' | 'right'
  /** 归一化位置（0..1），相对该玩家的映射区 */
  x: number
  y: number
  /** 是否在画面内可见 */
  visible: boolean
  /** 当前速度（归一化距离/秒），用于下压判定 */
  speedY: number
}

/** 全局手势事件（体感与 Mock 统一协议） */
export type GestureEvent =
  | { type: 'point'; hands: Hand[] }
  | { type: 'tap'; hand: Hand; player: number }

/** 姿态关键点（MediaPipe Pose 语义；x/y 0..1 相对摄像头画面，已镜像） */
export interface PosePoint {
  x: number
  y: number
  /** 识别置信度 0..1 */
  visibility: number
}

/** 单玩家姿态帧（身体骨架，供 ready 站位确认与右下角姿态小窗显示） */
export interface PoseFrame {
  player: number
  /** 姿态关键点（最多 33 点，MediaPipe Pose 语义：0 鼻/11 左肩/12 右肩/15 左腕/16 右腕/23 左髋/24 右髋…） */
  landmarks: PosePoint[]
  /** 手（腕）是否可见：用于站位确认判定 */
  wristVisible: boolean
}

/** 体感/输入源接口：真机摄像头 与 Mock 模拟器实现同一接口 */
export interface PoseProvider {
  readonly name: string
  /** 启动（返回是否成功）；playerCount 决定识别几人 */
  start(playerCount: number): Promise<boolean>
  stop(): void
  /** 订阅事件；返回取消订阅函数 */
  onEvent(cb: (e: GestureEvent) => void): () => void
  /** 订阅姿态帧（骨架数据，ready 确认 / 姿态小窗用）；返回取消订阅函数 */
  onPose(cb: (frames: PoseFrame[]) => void): () => void
  /** 是否可交互（Mock 恒 true；真机在校准后为 true） */
  ready: boolean
  /** 渲染辅助光标（可选；由外部叠加层调用） */
  renderCursor?(ctx: CanvasRenderingContext2D, w: number, h: number): void
  /** 摄像头预览视频元素（真机有；Mock 无） */
  readonly previewVideo?: HTMLVideoElement | null
}

/** 归一化矩形（玩家映射区） */
export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/** 游戏对局配置 */
export interface MatchConfig {
  /** 玩家数 1|2 */
  playerCount: number
  /** 难度（预留） */
  difficulty?: 'normal' | 'hard'
}

/** 一局结束时单个玩家的成绩 */
export interface PlayerScore {
  player: number
  score: number
  hits: number
  maxCombo: number
}

/** 游戏给引擎返回的结算数据 */
export interface GameResult {
  scores: PlayerScore[]
  /** 附加统计，引擎按字符串展示 */
  extra?: string[]
}

/* ---------- 游戏注册表 ---------- */

export interface GameSpec {
  id: string
  name: string
  icon: string
  desc: string
  /** 支持的最大玩家数（平台上限 4 人） */
  maxPlayers: 1 | 2 | 3 | 4
  /** 该游戏使用的素材清单（构建时 import） */
  create(ctx: GameContext): GameInstance
}

export interface GameContext {
  engine: GameEngine
  gesture: GestureEngine
  audio: AudioManager
  scores: ScoreStore
  match: MatchConfig
}

export interface GameInstance {
  /** 进入时调用（初始化、开始回合） */
  onEnter(): void
  /** 离开时调用（清理） */
  onExit(): void
  update(dt: number): void
  render(ctx: CanvasRenderingContext2D, w: number, h: number): void
  /** 手势事件分发（tap/point） */
  onGesture(e: GestureEvent): void
  /** 引擎调用：游戏结束并返回结果（内部自行调用 engine.endGame） */
  readonly done?: boolean
}

/* ---------- 引擎 ---------- */

import type { AudioManager } from './AudioManager'
import type { GestureEngine } from './GestureEngine'
import type { GameEngine } from './GameEngine'
import type { ScoreStore } from './ScoreStore'
