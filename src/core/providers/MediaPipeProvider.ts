/* ============ MediaPipe 摄像头真机体感 Provider ============
   使用 PoseLandmarker（numPoses 跟随玩家数，支持最多 4 人），输出双手位置 + 快速下压(tap)事件。
   坐标约定：摄像头画面左右镜像（照镜子）；玩家归属 = 可见手腕平均屏幕 x 按人数 N 等分
   （N=2 → 左半 P1 / 右半 P2；N=4 → 四等分），坐标本身全区直通不缩放。
   MediaPipe 资源为 ESM + wasm + 模型，运行时动态加载，带超时保护。 */

import type { GestureEvent, Hand, PoseFrame, PoseProvider } from '../types'

const VISION_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs'
const WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm'
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task'

const CAMERA_TIMEOUT = 6000
const LOAD_TIMEOUT = 25000
/** 下压触发速度（归一化 y/秒） */
const TAP_SPEED = 0.7
const TAP_COOLDOWN = 260

/** MediaPipe PoseLandmarker 输出的关键点：对象 {x,y,z,visibility}，不是数组 */
interface LandmarkPoint {
  x: number
  y: number
  z?: number
  visibility?: number
  presence?: number
}

interface Landmarker {
  detectForVideo(video: HTMLVideoElement, ts: number): {
    landmarks: LandmarkPoint[][] | null
    worldLandmarks: LandmarkPoint[][] | null
  }
}

export class MediaPipeProvider implements PoseProvider {
  readonly name = 'camera'
  ready = false

  private video: HTMLVideoElement | null = null
  private stream: MediaStream | null = null
  private landmarker: Landmarker | null = null
  private raf = 0
  private playerCount = 1
  private listeners = new Set<(e: GestureEvent) => void>()
  private poseListeners = new Set<(frames: PoseFrame[]) => void>()
  private lastTs = -1
  /** 每个玩家上一帧手腕位置与下压冷却 */
  private prevWrist: Map<string, { x: number; y: number }> = new Map()
  private tapLock: Map<string, number> = new Map()
  private failed = false
  private loading = false

  /** 摄像头预览视频元素（供姿态小窗/测试页显示画面） */
  get previewVideo(): HTMLVideoElement | null {
    return this.video
  }

  async start(playerCount: number): Promise<boolean> {
    this.playerCount = playerCount
    if (this.ready && this.stream) return true
    if (this.failed) return false
    if (this.loading) return false
    this.loading = true
    try {
      // 1) 摄像头
      const req = navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      })
      const camTimeout = new Promise<never>((_, rej) => setTimeout(() => rej(new Error('camera timeout')), CAMERA_TIMEOUT))
      this.stream = await Promise.race([req, camTimeout])
      this.video = document.createElement('video')
      this.video.srcObject = this.stream
      this.video.setAttribute('playsinline', '')
      await this.video.play()

      // 2) 姿态识别模型
      const load = (async () => {
        const mod: any = await import(/* @vite-ignore */ VISION_URL)
        const vision = await mod.FilesetResolver.forVisionTasks(WASM_URL)
        return mod.PoseLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: MODEL_URL,
            delegate: 'GPU',
          },
          runningMode: 'VIDEO',
          numPoses: playerCount,
          minPoseDetectionConfidence: 0.5,
        }) as Landmarker
      })()
      const loadTimeout = new Promise<never>((_, rej) => setTimeout(() => rej(new Error('pose load timeout')), LOAD_TIMEOUT))
      this.landmarker = await Promise.race([load, loadTimeout])

      this.ready = true
      this.failed = false
      this.startLoop()
      return true
    } catch (e) {
      console.warn('[arcade] camera/pose unavailable:', e)
      this.failed = true
      this.ready = false
      this.cleanupStream()
      return false
    } finally {
      this.loading = false
    }
  }

  stop(): void {
    cancelAnimationFrame(this.raf)
    this.cleanupStream()
    this.landmarker = null
    this.ready = false
  }

  onEvent(cb: (e: GestureEvent) => void): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  onPose(cb: (frames: PoseFrame[]) => void): () => void {
    this.poseListeners.add(cb)
    return () => this.poseListeners.delete(cb)
  }

  private cleanupStream(): void {
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop())
      this.stream = null
    }
    if (this.video) {
      this.video.srcObject = null
      this.video = null
    }
  }

  private startLoop(): void {
    const tick = (ts: number) => {
      if (this.ready && this.landmarker && this.video && this.video.readyState >= 2) {
        this.detect(ts)
      }
      this.raf = requestAnimationFrame(tick)
    }
    this.raf = requestAnimationFrame(tick)
  }

  private detect(ts: number): void {
    const lm = this.landmarker!
    const video = this.video!
    if (video.currentTime === 0 && this.lastTs === -1) {
      this.lastTs = ts
      return
    }
    const dt = this.lastTs > 0 ? (ts - this.lastTs) / 1000 : 1 / 30
    this.lastTs = ts
    let res
    try {
      res = lm.detectForVideo(video, ts)
    } catch {
      return
    }
    const poses = res.landmarks || []
    const hands: Hand[] = []
    const frames: PoseFrame[] = []
    const now = performance.now()

    /** MediaPipe 在低可见度/出画时可能输出 NaN 关键点，必须过滤，否则坐标 NaN 且骨架渲染被 canvas 忽略 */
    const valid = (pt: LandmarkPoint | undefined): pt is LandmarkPoint =>
      !!pt && Number.isFinite(pt.x) && Number.isFinite(pt.y)

    // 每个检测到的 Pose 对应一个玩家（画面左半=P1，右半=P2）；每人两只手都参与体感
    poses.forEach((lmk) => {
      if (lmk.length < 17) return
      // 完整姿态帧：镜像 x（摄像头原图像坐标 → 屏幕坐标）；无效点 visibility=0
      const landmarks = lmk.map((pt) => {
        const okPt = valid(pt)
        return {
          x: okPt ? 1 - pt.x : 0,
          y: okPt ? pt.y : 0,
          visibility: okPt ? (pt.visibility ?? pt.presence ?? 1) : 0,
        }
      })
      // 手腕：15=左腕 16=右腕（MediaPipe 语义；镜像后屏幕 x=1-raw）
      const w0 = valid(lmk[15]) ? lmk[15] : null
      const w1 = valid(lmk[16]) ? lmk[16] : null
      const wristVis = Math.max(w0?.visibility ?? 0, w1?.visibility ?? 0)
      // 玩家归属：多人时用可见手腕的平均屏幕 x 按人数 N 等分（N=2 → 左右半区；N=4 → 四等分）。
      // 位置本身仍全区直通（不缩放），只决定"这个人算几号玩家"
      const sx = [w0, w1].map((w) => (w ? 1 - w.x : NaN)).filter(Number.isFinite)
      const anchor = sx.length ? (sx[0] + sx[1]) / 2 : 0.5
      const seg = 1 / this.playerCount
      const player = Math.min(this.playerCount - 1, Math.max(0, Math.floor(anchor / seg)))

      const mkHand = (rawX: number, rawY: number, side: Hand['side']): Hand => {
        const mirrored = 1 - rawX
        // 全区直通：手坐标 = 镜像后视口归一化（不再做玩家分区缩放，光标=实际位置）
        const hx = Math.min(1, Math.max(0, mirrored))
        const hy = Math.min(1, Math.max(0, rawY))
        const key = `${player}:${side}`
        const prev = this.prevWrist.get(key)
        let speedY = 0
        if (prev) {
          const dy = hy - prev.y
          if (dt > 0) speedY = dy / dt
        }
        this.prevWrist.set(key, { x: hx, y: hy })
        // 下压判定：向下快速挥动（y 增大）触发 tap
        const locked = this.tapLock.get(key) || 0
        if (speedY > TAP_SPEED && now - locked > TAP_COOLDOWN) {
          this.tapLock.set(key, now)
          this.emit({ type: 'tap', hand: { player, side, x: hx, y: hy, visible: true, speedY, speedX: 0 }, player })
        }
        return { player, side, x: hx, y: hy, visible: true, speedY, speedX: 0 }
      }

      // 生成可见的手（左手/右手各自独立）
      const created: Hand[] = []
      if (w0) created.push(mkHand(w0.x, w0.y, 'left'))
      if (w1) created.push(mkHand(w1.x, w1.y, 'right'))

      if (created.length === 0) {
        // 两手都无效：只广播姿态帧（骨架/站位可见性），不生成手
        frames.push({ player, landmarks, wristVisible: false })
        return
      }
      hands.push(...created)
      frames.push({ player, landmarks, wristVisible: wristVis > 0.45 })
    })

    // 未检测到的玩家标记不可见（沿用最近一手位置，标记 visible=false）
    if (hands.length < this.playerCount) {
      for (let p = hands.length; p < this.playerCount; p++) {
        const prev = this.prevWrist.get(`${p}:right`) || this.prevWrist.get(`${p}:left`)
        if (prev) {
          this.emit({
            type: 'point',
            hands: [{ player: p, side: 'right', x: prev.x, y: prev.y, visible: false, speedY: 0, speedX: 0 }],
          })
        }
      }
    }

    if (hands.length > 0) {
      this.lastHands = hands
      this.emit({ type: 'point', hands })
    }
    if (frames.length > 0) this.poseListeners.forEach((cb) => cb(frames))
  }

  private emit(e: GestureEvent): void {
    this.listeners.forEach((cb) => cb(e))
  }

  /** 最近一帧检测到的手（供 renderCursor 叠加瞄准环） */
  private lastHands: Hand[] = []

  /** 叠加渲染：手部瞄准环（与 Mock 一致，P1 霓虹蓝 / P2 霓虹红，左右手带 L/R 标签）
      手坐标已是全区归一化，直接映射画布像素 = 实际位置 */
  renderCursor(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    const colors = ['#00e5ff', '#ff2d55', '#bd00ff', '#39ff14']
    this.lastHands.forEach((hand) => {
      if (!hand.visible) return
      const px = hand.x * w
      const py = hand.y * h
      const color = colors[hand.player % colors.length]
      ctx.save()
      ctx.strokeStyle = color
      ctx.lineWidth = Math.max(3, w * 0.008)
      ctx.beginPath()
      ctx.arc(px, py, Math.max(14, w * 0.02), 0, Math.PI * 2)
      ctx.stroke()
      ctx.fillStyle = color
      ctx.beginPath()
      ctx.arc(px, py, Math.max(4, w * 0.006), 0, Math.PI * 2)
      ctx.fill()
      ctx.font = `bold ${Math.max(13, h * 0.028)}px sans-serif`
      ctx.fillText(`P${hand.player + 1}-${hand.side === 'right' ? 'R' : 'L'}`, px + 12, py - 14)
      ctx.restore()
    })
  }
}
