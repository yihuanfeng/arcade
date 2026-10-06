/* ============ Mock 体感 Provider（电脑开发测试用） ============
   无需摄像头即可完整模拟体感（每个玩家两只手，最多 4 人）：
   - 鼠标移动 → P1 右手；WASD → P1 左手；空格 → P1 下压
   - 方向键 → P2 右手；IJKL → P2 左手；回车 → P2 下压（单人时归 P1）
   - 数字行 4/6/8/2 → P3 右手，1/3/5/0 → P3 左手；数字 9 → P3 下压
   - 小键盘 4/6/8/2 → P4 右手，1/3/5/0 → P4 左手；小键盘 9 → P4 下压
   - 画面上叠加显示虚拟手光标 + 按键提示，方便开发联调
   输出与真机 MediaPipeProvider 完全一致的手势事件，业务层不感知差异。 */

import type { GestureEvent, Hand, PoseFrame, PosePoint, PoseProvider } from '../types'

export class MockProvider implements PoseProvider {
  readonly name = 'mock'
  ready = true

  private playerCount = 1
  private listeners = new Set<(e: GestureEvent) => void>()
  private poseListeners = new Set<(frames: PoseFrame[]) => void>()
  /** 每玩家两只手：index = player*2 + (side==='right' ? 0 : 1)，支持到 4 人 */
  private hands: Hand[] = Array.from({ length: 8 }, (_, i) => {
    const player = Math.floor(i / 2)
    const right = i % 2 === 0
    return {
      player,
      side: right ? ('right' as const) : ('left' as const),
      x: right ? 0.5 : 0.42,
      y: 0.5,
      visible: true,
      speedY: 0,
    }
  })
  private keys = new Set<string>()
  private cleanupFns: Array<() => void> = []
  private raf = 0
  private lastT = 0

  private handOf(player: number, right: boolean): Hand {
    return this.hands[player * 2 + (right ? 0 : 1)]
  }

  /** 摄像头预览：Mock 无真实画面 */
  get previewVideo(): HTMLVideoElement | null {
    return null
  }

  async start(playerCount: number): Promise<boolean> {
    this.playerCount = playerCount
    this.hands.forEach((h) => (h.visible = h.player < playerCount))
    const onMouseMove = (e: MouseEvent) => this.setPointer(0, e.clientX, e.clientY)
    const onMouseDown = (e: MouseEvent) => {
      if (e.button !== 0) return
      // mousedown 也携带坐标：确保点按位置即手位置（CDP/脚本直点不先移动也正确）
      this.setPointer(0, e.clientX, e.clientY)
      this.tap(0)
    }
    const onKey = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase()
      if (
        k === ' ' || k === 'arrowup' || k === 'arrowdown' || k === 'arrowleft' || k === 'arrowright' ||
        k === '1' || k === '3' || k === '5' || k === '0' || k === '4' || k === '6' || k === '8' || k === '2' || k === '9' ||
        k === 'numpad1' || k === 'numpad3' || k === 'numpad5' || k === 'numpad0' || k === 'numpad4' || k === 'numpad6' || k === 'numpad8' || k === 'numpad2' || k === 'numpad9'
      ) {
        e.preventDefault()
      }
      // 空格 = P1 下压（鼠标之外的备用键）
      if (k === ' ') this.tap(0)
      // 回车 = P2 下压（双人及以上时 P2、单人时 P1 备用）
      if (k === 'enter') this.tap(this.playerCount > 1 ? 1 : 0)
      // 数字 9 / 小键盘 9 = P3 / P4 下压
      if (k === '9') this.tap(2)
      if (k === 'numpad9') this.tap(3)
      this.keys.add(k)
    }
    const onKeyUp = (e: KeyboardEvent) => {
      this.keys.delete(e.key.toLowerCase())
    }
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mousedown', onMouseDown)
    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', onKeyUp)
    this.cleanupFns = [
      () => window.removeEventListener('mousemove', onMouseMove),
      () => window.removeEventListener('mousedown', onMouseDown),
      () => window.removeEventListener('keydown', onKey),
      () => window.removeEventListener('keyup', onKeyUp),
    ]
    this.lastT = performance.now()
    this.raf = requestAnimationFrame(this.loop)
    return true
  }

  stop(): void {
    cancelAnimationFrame(this.raf)
    this.cleanupFns.forEach((f) => f())
    this.cleanupFns = []
    this.keys.clear()
  }

  onEvent(cb: (e: GestureEvent) => void): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  onPose(cb: (frames: PoseFrame[]) => void): () => void {
    this.poseListeners.add(cb)
    return () => this.poseListeners.delete(cb)
  }

  private loop = (t: number) => {
    const dt = Math.min(0.1, (t - this.lastT) / 1000)
    this.lastT = t
    let moved = false
    const sp = 0.55
    // P1 左手：WASD
    const l1 = this.handOf(0, false)
    if (this.playerCount >= 1 && l1.visible) {
      if (this.keys.has('a')) { l1.x = Math.max(0, l1.x - sp * dt); moved = true }
      if (this.keys.has('d')) { l1.x = Math.min(1, l1.x + sp * dt); moved = true }
      if (this.keys.has('w')) { l1.y = Math.max(0, l1.y - sp * dt); moved = true }
      if (this.keys.has('s')) { l1.y = Math.min(1, l1.y + sp * dt); moved = true }
    }
    // P2 右手：方向键
    if (this.playerCount > 1) {
      const r2 = this.handOf(1, true)
      if (r2.visible) {
        if (this.keys.has('arrowleft')) { r2.x = Math.max(0, r2.x - sp * dt); moved = true }
        if (this.keys.has('arrowright')) { r2.x = Math.min(1, r2.x + sp * dt); moved = true }
        if (this.keys.has('arrowup')) { r2.y = Math.max(0, r2.y - sp * dt); moved = true }
        if (this.keys.has('arrowdown')) { r2.y = Math.min(1, r2.y + sp * dt); moved = true }
      }
      // P2 左手：IJKL
      const l2 = this.handOf(1, false)
      if (l2.visible) {
        if (this.keys.has('j')) { l2.x = Math.max(0, l2.x - sp * dt); moved = true }
        if (this.keys.has('l')) { l2.x = Math.min(1, l2.x + sp * dt); moved = true }
        if (this.keys.has('i')) { l2.y = Math.max(0, l2.y - sp * dt); moved = true }
        if (this.keys.has('k')) { l2.y = Math.min(1, l2.y + sp * dt); moved = true }
      }
    }
    // P3：数字行（4/6/8/2 右手，1/3/5/0 左手）
    if (this.playerCount > 2) {
      const r3 = this.handOf(2, true)
      if (r3.visible) {
        if (this.keys.has('4')) { r3.x = Math.max(0, r3.x - sp * dt); moved = true }
        if (this.keys.has('6')) { r3.x = Math.min(1, r3.x + sp * dt); moved = true }
        if (this.keys.has('8')) { r3.y = Math.max(0, r3.y - sp * dt); moved = true }
        if (this.keys.has('2')) { r3.y = Math.min(1, r3.y + sp * dt); moved = true }
      }
      const l3 = this.handOf(2, false)
      if (l3.visible) {
        if (this.keys.has('1')) { l3.x = Math.max(0, l3.x - sp * dt); moved = true }
        if (this.keys.has('3')) { l3.x = Math.min(1, l3.x + sp * dt); moved = true }
        if (this.keys.has('5')) { l3.y = Math.max(0, l3.y - sp * dt); moved = true }
        if (this.keys.has('0')) { l3.y = Math.min(1, l3.y + sp * dt); moved = true }
      }
    }
    // P4：小键盘（numpad4/6/8/2 右手，numpad1/3/5/0 左手）
    if (this.playerCount > 3) {
      const r4 = this.handOf(3, true)
      if (r4.visible) {
        if (this.keys.has('numpad4')) { r4.x = Math.max(0, r4.x - sp * dt); moved = true }
        if (this.keys.has('numpad6')) { r4.x = Math.min(1, r4.x + sp * dt); moved = true }
        if (this.keys.has('numpad8')) { r4.y = Math.max(0, r4.y - sp * dt); moved = true }
        if (this.keys.has('numpad2')) { r4.y = Math.min(1, r4.y + sp * dt); moved = true }
      }
      const l4 = this.handOf(3, false)
      if (l4.visible) {
        if (this.keys.has('numpad1')) { l4.x = Math.max(0, l4.x - sp * dt); moved = true }
        if (this.keys.has('numpad3')) { l4.x = Math.min(1, l4.x + sp * dt); moved = true }
        if (this.keys.has('numpad5')) { l4.y = Math.max(0, l4.y - sp * dt); moved = true }
        if (this.keys.has('numpad0')) { l4.y = Math.min(1, l4.y + sp * dt); moved = true }
      }
    }
    if (moved) this.emitPoint()
    // 姿态帧（虚拟人骨架）：左右腕分别跟随左手/右手
    this.broadcastPose()
    this.raf = requestAnimationFrame(this.loop)
  }

  /** 生成并广播模拟姿态帧：每个玩家一个虚拟人骨架，左右腕跟随左右手（坐标全区直通） */
  private broadcastPose(): void {
    const n = this.playerCount
    const frames: PoseFrame[] = []
    for (let p = 0; p < n; p++) {
      const r = this.handOf(p, true)
      const l = this.handOf(p, false)
      // 画面 x 全区直通（与实际位置一致）；虚拟人身体中线 = 玩家区中心（站位框正套住人形）
      const hxR = r.x
      const hxL = l.x
      const cy = (p + 0.5) / n
      const P = (x: number, y: number, v = 1): PosePoint => ({ x, y, visibility: v })
      const pts: PosePoint[] = [
        P(cy, 0.28), // 0 鼻
        P(cy - 0.02, 0.29, 0.9), // 1
        P(cy - 0.035, 0.27), // 2 左眼
        P(cy - 0.02, 0.26), // 3
        P(cy - 0.06, 0.29), // 4 左耳
        P(cy + 0.035, 0.27), // 5 右眼
        P(cy + 0.02, 0.26), // 6
        P(cy + 0.06, 0.29), // 7 右耳
        P(cy, 0.28, 0.5), // 8
        P(cy, 0.29, 0.5), // 9
        P(cy, 0.3, 0.5), // 10
        P(cy - 0.1, 0.42), // 11 左肩
        P(cy + 0.1, 0.42), // 12 右肩
        P(cy - 0.14, 0.52), // 13 左肘
        P(cy + 0.14, 0.52), // 14 右肘
        P(hxL, l.y), // 15 左腕（跟随左手）
        P(hxR, r.y), // 16 右腕（跟随右手）
        P(cy, 0.33, 0.3), // 17
        P(cy - 0.03, 0.33, 0.3), // 18
        P(cy + 0.03, 0.33, 0.3), // 19
        P(cy - 0.02, 0.33, 0.3), // 20
        P(cy + 0.02, 0.33, 0.3), // 21
        P(cy, 0.36, 0.3), // 22
        P(cy - 0.09, 0.62), // 23 左髋
        P(cy + 0.09, 0.62), // 24 右髋
        P(cy - 0.09, 0.78), // 25 左膝
        P(cy + 0.09, 0.78), // 26 右膝
        P(cy - 0.09, 0.94), // 27 左踝
        P(cy + 0.09, 0.94), // 28 右踝
        P(cy, 0.32, 0.2), // 29
        P(cy, 0.32, 0.2), // 30
        P(cy, 0.33, 0.2), // 31
        P(cy, 0.33, 0.2), // 32
      ]
      frames.push({ player: p, landmarks: pts, wristVisible: r.visible || l.visible })
    }
    this.poseListeners.forEach((cb) => cb(frames))
  }

  /** 鼠标/键盘位置 → 玩家归一化区域 */
  private setPointer(player: number, clientX: number, clientY: number): void {
    const vw = window.innerWidth
    const vh = window.innerHeight
    const sx = Math.min(1, Math.max(0, clientX / vw))
    const sy = Math.min(1, Math.max(0, clientY / vh))
    const h = this.handOf(player, true)
    // 全区直通：手坐标 = 视口归一化（不再做玩家分区缩放，光标=实际位置）
    h.x = sx
    h.y = sy
    this.emitPoint()
  }

  private tap(player: number): void {
    const hand = this.handOf(player, true)
    hand.speedY = 1.2
    this.emit({ type: 'tap', hand: { ...hand }, player })
    setTimeout(() => (hand.speedY = 0), 150)
  }

  /** 广播全部可见手（每个玩家左右手都参与接触判定） */
  private emitPoint(): void {
    const all = this.hands.filter((h) => h.visible && h.player < this.playerCount)
    if (all.length > 0) this.emit({ type: 'point', hands: all.map((h) => ({ ...h })) })
  }

  private emit(e: GestureEvent): void {
    this.listeners.forEach((cb) => cb(e))
  }

  /** 叠加渲染：虚拟手光标（左右手都画，坐标全区直通）+ 按键提示（画面右下角） */
  renderCursor(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    const colors = ['#00e5ff', '#ff2d55', '#bd00ff', '#39ff14']
    const shown = this.hands.filter((hand) => hand.visible && hand.player < this.playerCount)
    for (const hand of shown) {
      const px = hand.x * w
      const py = hand.y * h
      const color = colors[hand.player % colors.length]
      // 瞄准环
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
      // 标签（P1-R / P1-L）
      ctx.font = `bold ${Math.max(13, h * 0.028)}px sans-serif`
      ctx.fillText(`P${hand.player + 1}-${hand.side === 'right' ? 'R' : 'L'}`, px + 12, py - 14)
      ctx.restore()
    }
    // 按键提示（右下角，最多两行）
    const tips =
      this.playerCount === 1
        ? ['Mock 双手：鼠标=右手 · WASD=左手']
        : this.playerCount === 2
          ? ['Mock 双手：鼠标+WASD=P1 · 方向键+IJKL=P2']
          : this.playerCount === 3
            ? ['Mock：P1 鼠标+WASD · P2 方向键+IJKL', 'P3 数字行']
            : ['Mock：P1 鼠标+WASD · P2 方向键+IJKL', 'P3 数字行 · P4 小键盘']
    ctx.save()
    ctx.font = `${Math.max(12, h * 0.02)}px sans-serif`
    const lh = Math.max(16, h * 0.028)
    const tw = Math.max(...tips.map((t) => ctx.measureText(t).width))
    const th = tips.length * lh
    ctx.fillStyle = 'rgba(10,16,22,0.6)'
    ctx.fillRect(w - tw - 20, h - th - 14, tw + 12, th + 10)
    ctx.fillStyle = '#9fb0c4'
    tips.forEach((t, i) => ctx.fillText(t, w - tw - 14, h - th - 4 + (i + 1) * lh))
    ctx.restore()
  }
}
