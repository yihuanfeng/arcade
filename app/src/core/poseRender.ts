/* ============ 姿态骨架渲染工具（测试页 / 右下角姿态小窗共用） ============ */

import type { PoseFrame, PosePoint } from './types'
import { POSE_CONNECTIONS } from './GestureEngine'

export interface PoseRenderOptions {
  /** 玩家颜色表 */
  colors?: string[]
  /** 线条宽度（相对画布宽度比例） */
  lineWidth?: number
  /** 是否画关节点圆点 */
  drawPoints?: boolean
  /** 是否只画可见的点/线 */
  filterVisible?: boolean
}

/** 玩家霓虹色表：P1 深霓虹蓝 / P2 红 / P3 紫 / P4 绿，靠颜色分辨人 */
const DEFAULT_COLORS = ['#00a8e8', '#ff2d55', '#bd00ff', '#39ff14']

export { DEFAULT_COLORS }

/** 把归一化关键点映射到画布坐标；无效/非有限坐标返回 null（防止 NaN 打断整条骨架路径） */
function mapPoint(pt: PosePoint | undefined, w: number, h: number): { x: number; y: number } | null {
  if (!pt) return null
  if (!Number.isFinite(pt.x) || !Number.isFinite(pt.y)) return null
  return { x: pt.x * w, y: pt.y * h }
}

/** 可见性过滤（NaN 视为不可见） */
function isVisible(pt: PosePoint): boolean {
  return Number.isFinite(pt.visibility) && pt.visibility >= 0.4
}

/** 画单个玩家的骨架到画布 */
export function drawPoseFrame(
  ctx: CanvasRenderingContext2D,
  frame: PoseFrame,
  w: number,
  h: number,
  opts: PoseRenderOptions = {},
): void {
  const colors = opts.colors ?? DEFAULT_COLORS
  const color = colors[frame.player % colors.length] ?? colors[0]
  const pts = frame.landmarks
  if (!pts || pts.length === 0) return

  // 连线
  ctx.save()
  ctx.strokeStyle = color
  ctx.lineWidth = opts.lineWidth ?? Math.max(2, w * 0.012)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.beginPath()
  for (const [a, b] of POSE_CONNECTIONS) {
    const pa = mapPoint(pts[a], w, h)
    const pb = mapPoint(pts[b], w, h)
    if (!pa || !pb) continue
    if (opts.filterVisible && (!isVisible(pts[a]) || !isVisible(pts[b]))) continue
    ctx.moveTo(pa.x, pa.y)
    ctx.lineTo(pb.x, pb.y)
  }
  ctx.stroke()

  // 关节点
  if (opts.drawPoints !== false) {
    ctx.fillStyle = color
    for (let i = 0; i < pts.length; i++) {
      const pt = pts[i]
      if (opts.filterVisible && !isVisible(pt)) continue
      const p = mapPoint(pt, w, h)
      if (!p) continue
      ctx.beginPath()
      ctx.arc(p.x, p.y, Math.max(1.5, w * 0.008), 0, Math.PI * 2)
      ctx.fill()
    }
  }
  ctx.restore()
}

/** 画多玩家骨架（同一画布） */
export function drawPoseFrames(
  ctx: CanvasRenderingContext2D,
  frames: PoseFrame[],
  w: number,
  h: number,
  opts: PoseRenderOptions = {},
): void {
  for (const frame of frames) drawPoseFrame(ctx, frame, w, h, opts)
}
