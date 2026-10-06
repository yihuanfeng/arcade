/* ============ 打地鼠游戏（Vue 工程版） ============
   从初版单文件移植并升级：
   - 双人同屏：每人半区独立场地（5 洞、独立命/分/连击），共用 60 秒
   - 命中规则（接触即打，每个玩家左右手都可以打）：
     普通地鼠 +50 / 头盔地鼠打两次（掉盔 +30 再 +80）/ 加命道具 +1 命
     怪物（UFO）是坏目标：碰到掉 1 滴血
     炸弹是"点火状态"：碰到不掉血，打它=灭火；不灭掉引信走完就爆炸，掉 1 血
   - 连击：每连 +5% 加成封顶 20；每 5 连触发里程碑奖励 +50；命中飘字 +N
   - 洞：椭圆、位于场地底部，目标从洞里向上冒出的动画
   - 渲染全在画布（大字号 HUD 适配投屏）；玩家色：P1 霓虹蓝 / P2 霓虹红
   素材：活力街 APK 原版（bg-main 工地背景 + 地鼠部件 + 音效） */

import type { GameContext, GameInstance, GestureEvent, Hand } from '../../core/types'
import { VIEW_W, VIEW_H } from '../../core/GameEngine'

/* ---------- 素材（Vite 批量导入，按游戏目录存放） ---------- */
const imgUrls = import.meta.glob('./assets/img/*.png', { eager: true, query: '?url', import: 'default' }) as Record<string, string>
const audioUrls = import.meta.glob('./assets/audio/*.mp3', { eager: true, query: '?url', import: 'default' }) as Record<string, string>

const AUD = (n: string) => audioUrls[`./assets/audio/${n}.mp3`] ?? ''
export const WHACK_AUDIO_ASSETS = [
  { name: 'bgm', url: AUD('bgm'), loop: true, volume: 0.55 },
  { name: 'intro', url: AUD('intro'), volume: 0.8 },
  { name: 'hit', url: AUD('hit'), volume: 0.9 },
  { name: 'whack', url: AUD('whack'), volume: 0.9 },
  { name: 'explosion', url: AUD('explosion'), volume: 0.9 },
  { name: 'collect', url: AUD('collect'), volume: 0.9 },
  { name: 'chime', url: AUD('chime'), volume: 0.8 },
  { name: 'beep', url: AUD('beep'), volume: 0.7 },
  { name: 'boing', url: AUD('boing'), volume: 0.8 },
  { name: 'fuse', url: AUD('fuse'), volume: 0.7 },
  { name: 'fuse-stop', url: AUD('fuse-stop'), volume: 0.7 },
]

/* ---------- 玩法参数 ---------- */
const DURATION = 60
const LIVES = 3
const HOLE_COUNT = 5
const SPAWN_START = 1.15
const SPAWN_MIN = 0.42
const LIFE_START = 1.55
const LIFE_MIN = 0.8
const P_SPECIAL = 0.1
const P_BOMB = 0.12
const P_LIFE = 0.05
const P_HELMET = 0.1
const MAX_COMBO = 20
const COUNTDOWN = 3.2

type TargetKind = 'mole' | 'helmet' | 'bomb' | 'special' | 'life'
interface Target {
  kind: TargetKind
  hole: number
  appearAt: number
  life: number
  state: 'up' | 'hit' | 'down'
  hits: number
  /** 接触命中冷却（防同一目标连帧重复触发） */
  lastHit: number
  /** 炸弹引信剩余（秒）；为 0 时自动爆炸 */
  fuse: number
}

interface FloatText {
  x: number
  y: number
  text: string
  color: string
  life: number
  max: number
  size: number
}

/** 接触命中半径（全区归一化：手与洞中心距离小于该值即打一下） */
const HIT_RADIUS = 0.1
/** 炸弹自动爆炸倒计时（秒） */
const BOMB_FUSE = 2.2
/** 连击里程碑间隔：每 N 连触发一次奖励 */
const COMBO_MILESTONE = 5
/** 连击里程碑奖励分 */
const COMBO_BONUS = 50

interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  life: number
  max: number
  color: string
  size: number
}

interface PlayerState {
  score: number
  hits: number
  combo: number
  maxCombo: number
  lives: number
  flash: number
  particles: Particle[]
  floats: FloatText[]
}

/* ---------- 工具 ---------- */
function clamp(v: number, a: number, b: number) { return Math.min(b, Math.max(a, v)) }

/** 预载图片（返回是否全部就绪） */
function loadImages(): Record<string, HTMLImageElement> {
  const map: Record<string, HTMLImageElement> = {}
  for (const key of Object.keys(imgUrls)) {
    const name = key.slice(key.lastIndexOf('/') + 1, -4)
    const img = new Image()
    img.src = imgUrls[key]
    map[name] = img
  }
  return map
}

export class WhackAMoleGame implements GameInstance {
  private ctx: GameContext
  private imgs = loadImages()
  private state: 'countdown' | 'play' | 'over' = 'countdown'
  private t = 0
  private timeLeft = DURATION
  private players: PlayerState[] = []
  /** 全区共享目标（多人自由竞争同一片场地，任何手按实际位置直接打） */
  private targets: Target[] = []
  private spawnTimer = SPAWN_START
  private spawnInterval = SPAWN_START
  private lifeTimer = LIFE_START
  private lifeInterval = LIFE_START
  private countdownStart = 0
  private ended = false
  private bgmStarted = false

  constructor(ctx: GameContext) {
    this.ctx = ctx
  }

  onEnter(): void {
    this.ctx.audio.register(WHACK_AUDIO_ASSETS)
    this.ctx.audio.unlock()
    const n = this.ctx.match.playerCount
    this.players = Array.from({ length: n }, () => this.newPlayer())
    this.targets = []
    // 刷怪速率按人数加速：多人共享场地，整体节奏保持（双人 ≈ 1.15s/2）
    const pace = Math.max(1, n)
    this.spawnInterval = SPAWN_START / pace
    this.spawnTimer = this.spawnInterval
    this.lifeInterval = LIFE_START
    this.lifeTimer = LIFE_START
    this.state = 'countdown'
    this.t = 0
    this.countdownStart = 0
    this.ended = false
    this.timeLeft = DURATION
    this.bgmStarted = false
  }

  onExit(): void {
    this.ctx.audio.stopBgm()
  }

  private newPlayer(): PlayerState {
    return {
      score: 0,
      hits: 0,
      combo: 0,
      maxCombo: 0,
      lives: LIVES,
      flash: 0,
      particles: [],
      floats: [],
    }
  }

  /* ================= 更新 ================= */
  update(dt: number): void {
    this.t += dt
    if (this.state === 'countdown') {
      if (this.t - this.countdownStart >= COUNTDOWN) {
        this.state = 'play'
        if (!this.bgmStarted) {
          this.ctx.audio.startBgm('bgm')
          this.ctx.audio.play('intro')
          this.bgmStarted = true
        }
      }
      return
    }
    if (this.state !== 'play' || this.ended) return

    this.timeLeft -= dt
    // 全区刷怪（共享场地，多人竞争同一批目标）
    this.spawnTimer -= dt
    this.lifeTimer -= dt
    if (this.spawnTimer <= 0) {
      this.spawnTarget()
      this.spawnTimer = Math.max(SPAWN_MIN, this.spawnInterval * (0.85 + Math.random() * 0.3))
    }
    if (this.lifeTimer <= 0) {
      this.lifeInterval = Math.max(LIFE_MIN, this.lifeInterval * 0.92)
      this.lifeTimer = this.lifeInterval
    }
    // 目标生命周期 + 炸弹定时爆炸
    for (const tg of this.targets) {
      if (tg.state !== 'up') continue
      // 炸弹不走目标寿命：按引信计时，引信走完自动爆炸（防止引信没到就被移除）
      if (tg.kind === 'bomb') {
        tg.fuse -= dt
        if (tg.fuse <= 0) {
          // 炸弹没被灭火 → 自己爆炸 → 全场掉一滴血
          tg.state = 'down'
          this.bombBlast(tg)
        }
        continue
      }
      if (this.t - tg.appearAt > tg.life) {
        tg.state = 'down'
      }
    }
    this.targets = this.targets.filter((tg) => tg.state === 'up' || (tg.state === 'hit' && this.t - tg.appearAt < tg.life + 0.35))
    // 玩家：红闪 / 飘字 / 粒子
    let anyAlive = false
    for (const p of this.players) {
      if (p.lives <= 0) continue
      anyAlive = true
      if (p.flash > 0) p.flash -= dt
      // 飘字：上飘 + 淡出
      for (const ft of p.floats) {
        ft.life -= dt
        ft.y -= 70 * dt
      }
      p.floats = p.floats.filter((ft) => ft.life > 0)
      // 粒子
      p.particles = p.particles.filter((pt) => pt.life > 0)
      for (const pt of p.particles) {
        pt.life -= dt
        pt.x += pt.vx * dt
        pt.y += pt.vy * dt
        pt.vy += 300 * dt
      }
    }
    if (this.timeLeft <= 0 || !anyAlive) {
      this.finish()
    }
  }

  private spawnTarget(): void {
    const free = this.targets.filter((tg) => tg.state === 'up').map((tg) => tg.hole)
    // 随机选一个空闲洞（避免总是从洞 0 开始顺序填充）
    const freeHoles: number[] = []
    for (let i = 0; i < HOLE_COUNT; i++) if (!free.includes(i)) freeHoles.push(i)
    if (freeHoles.length === 0) return
    const holeIdx = freeHoles[Math.floor(Math.random() * freeHoles.length)]
    const r = Math.random()
    let kind: TargetKind = 'mole'
    if (r < P_SPECIAL) kind = 'special'
    else if (r < P_SPECIAL + P_BOMB) kind = 'bomb'
    else if (r < P_SPECIAL + P_BOMB + P_LIFE) kind = 'life'
    else if (r < P_SPECIAL + P_BOMB + P_LIFE + P_HELMET) kind = 'helmet'
    const speed = 1 - (this.t / (DURATION + COUNTDOWN)) * 0.4
    this.targets.push({
      kind,
      hole: holeIdx,
      appearAt: this.t,
      life: (kind === 'special' ? 0.7 : 1.5) * speed,
      state: 'up',
      hits: 0,
      lastHit: -1,
      fuse: kind === 'bomb' ? BOMB_FUSE : 0,
    })
  }

  /* ================= 手势（接触即打） ================= */
  onGesture(e: GestureEvent): void {
    if (this.state !== 'play') return
    // point（手移动/识别帧）与 tap 都做接触判定：手碰到升起的目标即触发
    const hands: Hand[] = e.type === 'point' && e.hands.length > 0 ? e.hands : e.type === 'tap' && e.hand ? [e.hand] : []
    for (const hand of hands) {
      if (!hand.visible) continue
      this.contactCheck(hand.player, hand)
    }
    if (e.type === 'tap' && e.hand) {
      const p = this.players[e.hand.player]
      if (p && p.lives > 0 && p.flash <= 0) this.ctx.audio.playThrottled('boing', 100)
    }
  }

  /** 接触判定：手与目标距离小于命中半径即打一下（每目标带冷却防连帧）
      hand.x/y 是全区归一化坐标（与共享目标同坐标系），任何手可以打任何洞 */
  private contactCheck(player: number, hand: Hand): void {
    const p = this.players[player]
    if (!p || p.lives <= 0 || p.flash > 0) return
    const cx = hand.x
    const cy = hand.y
    let hit = false
    for (const tg of this.targets) {
      if (tg.state !== 'up') continue
      if (this.t - tg.lastHit < 0.25) continue
      const hp = this.holePos(tg.hole)
      if (Math.hypot(hp.x - cx, hp.y - cy) < HIT_RADIUS) {
        tg.lastHit = this.t
        this.hitTarget(player, tg)
        hit = true
      }
    }
    if (!hit) this.ctx.audio.playThrottled('boing', 100)
  }

  /** 炸弹爆炸（引信耗尽自动爆）：全场掉一滴血 */
  private bombBlast(tg: Target): void {
    const hp = this.holePos(tg.hole)
    const px = hp.x * VIEW_W
    const py = hp.y * VIEW_H
    this.ctx.audio.play('explosion')
    for (const p of this.players) {
      if (p.lives <= 0) continue
      const pi = this.players.indexOf(p)
      p.lives -= 1
      p.combo = 0
      p.flash = 0.5
      this.burst(pi, px, py, '#ff6b6b', 8)
      this.floats(pi, px, py, '爆炸！-1♥', '#ff6b6b', VIEW_H * 0.05)
    }
  }

  /** 炸弹灭火（碰到炸弹不掉血，打它=浇水灭火） */
  private extinguish(p: PlayerState, tg: Target): void {
    const hp = this.holePos(tg.hole)
    const px = hp.x * VIEW_W
    const py = hp.y * VIEW_H
    tg.state = 'down'
    this.ctx.audio.play('collect')
    this.burst(this.players.indexOf(p), px, py, '#38bdf8', 14)
    this.floats(this.players.indexOf(p), px, py - VIEW_H * 0.08, '灭火！', '#38bdf8', VIEW_H * 0.045)
  }

  private hitTarget(player: number, tg: Target): void {
    const p = this.players[player]
    // 画布坐标（粒子/飘字用，全区）
    const hp = this.holePos(tg.hole)
    const px = hp.x * VIEW_W
    const py = hp.y * VIEW_H
    let pts = 0
    // 炸弹：碰到=灭火，不掉血不掉分
    if (tg.kind === 'bomb') {
      this.extinguish(p, tg)
      return
    }
    // 怪物：坏目标，碰到掉一滴血
    if (tg.kind === 'special') {
      p.lives -= 1
      p.combo = 0
      p.flash = 0.5
      this.ctx.audio.play('whack')
      this.burst(player, px, py, '#ff4d5e', 14)
      this.floats(player, px, py - VIEW_H * 0.08, '怪物！-1♥', '#ff4d5e', VIEW_H * 0.05)
      tg.state = 'down'
      return
    }
    if (tg.kind === 'helmet') {
      tg.hits += 1
      if (tg.hits >= 2) {
        pts = 80
        tg.state = 'down'
        this.burst(player, px, py, '#ff2d55', 10)
      } else {
        pts = 30
        this.ctx.audio.playThrottled('whack', 60)
        this.burst(player, px, py, '#00e5ff', 6)
      }
    } else if (tg.kind === 'life') {
      pts = 30
      p.lives = Math.min(5, p.lives + 1)
      tg.state = 'down'
      this.ctx.audio.play('chime')
      this.burst(player, px, py, '#39ff14', 10)
      this.floats(player, px, py - VIEW_H * 0.08, '+1♥', '#39ff14', VIEW_H * 0.05)
    } else {
      pts = 50
      tg.state = 'down'
      this.burst(player, px, py, '#00e5ff', 8)
    }
    p.combo = Math.min(MAX_COMBO, p.combo + 1)
    p.maxCombo = Math.max(p.maxCombo, p.combo)
    p.hits += 1
    const actual = Math.round(pts * (1 + p.combo * 0.05))
    p.score += actual
    // 命中飘字 +N（含连击加成）
    this.floats(player, px, py - VIEW_H * 0.1, `+${actual}`, '#ffe14d', VIEW_H * 0.06)
    // 连击里程碑奖励：每 5 连一次，大字提醒
    if (p.combo % COMBO_MILESTONE === 0) {
      p.score += COMBO_BONUS
      this.floats(player, px, py - VIEW_H * 0.2, `连击×${p.combo}！+${COMBO_BONUS}`, '#ff9f1c', VIEW_H * 0.075)
      this.ctx.audio.play('chime')
    }
    if (tg.kind !== 'helmet' || tg.hits >= 2) this.ctx.audio.playThrottled('hit', 60)
  }

  /** 飘字 */
  private floats(player: number, px: number, py: number, text: string, color: string, size: number): void {
    const p = this.players[player]
    if (!p) return
    p.floats.push({ x: px, y: py, text, color, life: 1.0, max: 1.0, size })
  }

  private burst(player: number, px: number, py: number, color: string, n: number): void {
    const p = this.players[player]
    if (!p) return
    for (let i = 0; i < n; i++) {
      p.particles.push({
        x: px,
        y: py,
        vx: (Math.random() - 0.5) * 260,
        vy: -Math.random() * 220,
        life: 0.5,
        max: 0.5,
        color,
        size: 3 + Math.random() * 4,
      })
    }
  }

  /* ================= 布局 ================= */
  private holePos(i: number): { x: number; y: number } {
    const n = HOLE_COUNT
    const spacing = n > 1 ? 1 / (n + 1) : 0.5
    // 洞位于场地底部（贴近下沿）
    return { x: spacing * (i + 1), y: 0.8 }
  }

  private finish(): void {
    if (this.ended) return
    this.ended = true
    this.state = 'over'
    this.ctx.audio.stopBgm()
    const scores = this.players.map((p, i) => ({
      player: i,
      score: Math.round(p.score),
      hits: p.hits,
      maxCombo: p.maxCombo,
    }))
    this.ctx.engine.endGame({ scores })
  }

  /* ================= 渲染 ================= */
  render(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    const bg = this.imgs['bg-main']
    ctx.fillStyle = '#101418'
    ctx.fillRect(0, 0, w, h)
    if (bg?.complete && bg.naturalWidth > 0) {
      ctx.drawImage(bg, 0, 0, w, h)
    }
    if (this.state === 'countdown') {
      this.renderCountdown(ctx, w, h)
      return
    }
    // 全区洞（一次，所有玩家共享同一片场地）
    this.renderHoles(ctx, w, h)
    // 全区共享目标
    for (const tg of this.targets) {
      if (tg.state !== 'up') continue
      this.renderTarget(ctx, tg, w, h)
    }
    // 每位玩家：粒子 / 飘字 / 扣血红闪（坐标全区；红闪按玩家侧显示）
    const pc = this.ctx.match.playerCount
    for (let i = 0; i < this.players.length; i++) {
      const p = this.players[i]
      const zone = this.playerZoneOf(i, pc)
      const zoneX = zone.x * w
      const zoneW = zone.w * w
      for (const pt of p.particles) {
        const a = clamp(pt.life / pt.max, 0, 1)
        ctx.globalAlpha = a
        ctx.fillStyle = pt.color
        ctx.beginPath()
        ctx.arc(pt.x, pt.y, pt.size, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.textAlign = 'center'
      for (const ft of p.floats) {
        const a = clamp(ft.life / ft.max, 0, 1)
        ctx.globalAlpha = a
        ctx.font = `900 ${ft.size}px sans-serif`
        ctx.fillStyle = ft.color
        ctx.strokeStyle = 'rgba(0,0,0,0.65)'
        ctx.lineWidth = Math.max(3, ft.size * 0.14)
        ctx.strokeText(ft.text, ft.x, ft.y)
        ctx.fillText(ft.text, ft.x, ft.y)
      }
      ctx.globalAlpha = 1
      if (p.flash > 0) {
        ctx.globalAlpha = clamp(p.flash, 0, 1) * 0.35
        ctx.fillStyle = '#ff2222'
        ctx.fillRect(zoneX, 0, zoneW, h)
        ctx.globalAlpha = 1
      }
    }
    this.renderHud(ctx, w, h)
  }

  private playerZoneOf(player: number, pc: number) {
    if (pc === 1) return { x: 0, w: 1 }
    // 显示区按人数 N 等分（仅用于红闪/飘字归属，坐标仍是全区直通）
    const seg = 1 / pc
    return { x: player * seg, w: seg }
  }

  /** 全区洞（椭圆，位于场地底部，所有玩家共用） */
  private renderHoles(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    for (let i = 0; i < HOLE_COUNT; i++) {
      const pos = this.holePos(i)
      const cx = pos.x * w
      const cy = pos.y * h
      const rx = w * 0.075
      const ry = rx * 0.5
      ctx.fillStyle = '#0a0d10'
      ctx.beginPath()
      ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2)
      ctx.fill()
      ctx.strokeStyle = 'rgba(255,255,255,0.12)'
      ctx.lineWidth = Math.max(3, w * 0.004)
      ctx.stroke()
    }
  }

  private renderTarget(ctx: CanvasRenderingContext2D, tg: Target, w: number, h: number): void {
    const pos = this.holePos(tg.hole)
    const cx = pos.x * w
    const baseY = pos.y * h
    // 向上冒出的动画：从洞底升起 + 纵向展开（0.24s）
    const up = clamp((this.t - tg.appearAt) / 0.24, 0, 1)
    const size = w * 0.085
    const body = this.imgs['mole-body']
    const imgOf = (name: string) => this.imgs[name]
    const draw = (name: string, dx: number, dy: number, dw: number, dh: number) => {
      const img = imgOf(name)
      if (img?.complete && img.naturalWidth > 0) ctx.drawImage(img, dx, dy, dw, dh)
    }
    ctx.save()
    // 起点在洞内下方，随 up 升到洞面之上，配合 scale 纵向展开 → 从洞里冒出来
    ctx.translate(cx, baseY + (1 - up) * size * 0.55)
    ctx.scale(1, Math.max(0.06, up))
    // 身体（绿丘）
    if (tg.kind === 'bomb') {
      draw('boom', -size / 2, -size / 2, size, size)
      // 引信倒计时环（从满到空，快爆时红色闪烁）
      const ratio = clamp(tg.fuse / BOMB_FUSE, 0, 1)
      ctx.strokeStyle = ratio > 0.5 ? '#ff9f1c' : '#ff2d55'
      ctx.lineWidth = Math.max(3, size * 0.07)
      ctx.beginPath()
      ctx.arc(0, 0, size * 0.66, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * ratio)
      ctx.stroke()
      if (ratio < 0.35 && Math.floor(this.t * 7) % 2 === 0) {
        ctx.fillStyle = 'rgba(255,45,85,0.28)'
        ctx.beginPath()
        ctx.arc(0, 0, size * 0.62, 0, Math.PI * 2)
        ctx.fill()
      }
    } else if (tg.kind === 'special') {
      draw('char-ufo', -size / 2, -size / 2, size * 0.9, size * 0.9)
    } else if (tg.kind === 'life') {
      // 代码绘制红心（解包素材 extra-life 是黑色心形，不符合预期；HUD 爱心用 heart.png 红色素材不受影响）
      const s = size * 0.95
      ctx.fillStyle = '#ff2d55'
      ctx.beginPath()
      ctx.moveTo(0, s * 0.45)
      ctx.bezierCurveTo(-s * 0.58, -s * 0.1, -s * 0.48, -s * 0.6, 0, -s * 0.28)
      ctx.bezierCurveTo(s * 0.48, -s * 0.6, s * 0.58, -s * 0.1, 0, s * 0.45)
      ctx.closePath()
      ctx.fill()
      ctx.fillStyle = 'rgba(255,255,255,0.4)'
      ctx.beginPath()
      ctx.arc(-s * 0.2, -s * 0.32, s * 0.12, 0, Math.PI * 2)
      ctx.fill()
    } else {
      if (body?.complete && body.naturalWidth > 0) ctx.drawImage(body, -size / 2, -size * 0.55, size, size * 1.1)
      draw('mole-eyes', -size * 0.22, -size * 0.14, size * 0.2, size * 0.12)
      draw('mole-nose', -size * 0.07, -size * 0.02, size * 0.14, size * 0.12)
      if (tg.kind === 'helmet') {
        if (tg.hits === 0) {
          draw('helmet', -size * 0.3, -size * 0.48, size * 0.6, size * 0.3)
        } else {
          // 头盔已被打落
          draw('helmet', -size * 0.3, -size * 0.2, size * 0.6, size * 0.3)
          draw('mole-hair', -size * 0.25, -size * 0.5, size * 0.5, size * 0.25)
        }
      }
    }
    ctx.restore()
  }

  private renderHud(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    const pc = this.ctx.match.playerCount
    const pad = h * 0.02
    // 倒计时（中央大字）
    ctx.textAlign = 'center'
    ctx.font = `700 ${h * 0.05}px sans-serif`
    ctx.fillStyle = '#ffffff'
    ctx.shadowColor = 'rgba(0,0,0,0.6)'
    ctx.shadowBlur = 8
    ctx.fillText(`${Math.ceil(Math.max(0, this.timeLeft))}s`, w / 2, h * 0.07)
    ctx.shadowBlur = 0
    // 每位玩家：分数 + 爱心
    for (let i = 0; i < this.players.length; i++) {
      const p = this.players[i]
      const zone = this.playerZoneOf(i, pc)
      const zx = zone.x * w
      const zw = zone.w * w
      const colors = ['#00e5ff', '#ff2d55', '#bd00ff', '#39ff14']
      const color = colors[i % colors.length]
      ctx.textAlign = i === 0 ? 'left' : 'right'
      ctx.font = `800 ${h * 0.075}px sans-serif`
      ctx.fillStyle = color
      ctx.shadowColor = 'rgba(0,0,0,0.7)'
      ctx.shadowBlur = 8
      ctx.fillText(String(p.score), zx + (i === 0 ? pad : zw - pad), h * 0.1)
      ctx.shadowBlur = 0
      // 爱心
      const heart = this.imgs['heart']
      if (heart?.complete) {
        const hs = h * 0.045
        for (let li = 0; li < Math.max(0, p.lives); li++) {
          const hx = (i === 0 ? zx + pad + li * hs * 1.15 : zx + zw - pad - (li + 1) * hs * 1.15)
          ctx.drawImage(heart, hx, h * 0.12, hs, hs)
        }
      }
    }
  }

  private renderCountdown(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    const bg = this.imgs['bg-main']
    if (bg?.complete && bg.naturalWidth > 0) {
      ctx.drawImage(bg, 0, 0, w, h)
    }
    ctx.fillStyle = 'rgba(8,12,16,0.55)'
    ctx.fillRect(0, 0, w, h)
    const remain = COUNTDOWN - (this.t - this.countdownStart)
    const num = Math.max(1, Math.ceil(remain))
    ctx.textAlign = 'center'
    ctx.font = `900 ${h * 0.32}px sans-serif`
    ctx.fillStyle = num <= 1 ? '#ffb454' : '#ffffff'
    ctx.shadowColor = 'rgba(0,0,0,0.8)'
    ctx.shadowBlur = 16
    ctx.fillText(String(num), w / 2, h * 0.62)
    ctx.shadowBlur = 0
  }
}

/* ================= 游戏注册 ================= */
export const whackAMoleSpec = {
  id: 'whack-a-mole',
  name: '打地鼠',
  icon: '🐭',
  desc: '手碰到地鼠得分，头盔打两次，别碰怪物和炸弹',
  maxPlayers: 2 as const,
  create: (ctx: GameContext) => new WhackAMoleGame(ctx),
}
