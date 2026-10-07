/* ============ 双人合力驾驶（co-pilot） ============
   类似双人成行的合体操控：两人各控一个轴，合力驾驶飞船。
   - P1 的手控制飞船 Y（上下），P2 的手控制飞船 X（左右）——缺一不可
   - 飞船自动向右飞行，躲避流星与激光柱（碰障碍 -1♥，3 命，碰撞后 1.2s 无敌闪烁）
   - 能量球需要 P1 与 P2 的手**同时碰到**才得分（+20，连击加成）；单人模式单手即可
   - 60s 分 3 阶段：只流星（慢）→ +激光柱（提速）→ 双障碍+最快
   - 全画布渲染（大字号 HUD 适配投屏）；背景用 APK 原版 space-pong 太空网格，玩法元素代码绘制
   素材：活力街 APK 原版（space-pong-bg + 打地鼠同源音效，按游戏目录存放） */

import type { GameContext, GameInstance, GestureEvent } from '../../core/types'
import { VIEW_W, VIEW_H } from '../../core/GameEngine'

/* ---------- 素材（Vite 批量导入） ---------- */
const imgUrls = import.meta.glob('./assets/img/*.png', { eager: true, query: '?url', import: 'default' }) as Record<string, string>
const audioUrls = import.meta.glob('./assets/audio/*.mp3', { eager: true, query: '?url', import: 'default' }) as Record<string, string>

const AUD = (n: string) => audioUrls[`./assets/audio/${n}.mp3`] ?? ''
export const CO_PILOT_AUDIO_ASSETS = [
  { name: 'bgm', url: AUD('bgm'), loop: true, volume: 0.55 },
  { name: 'intro', url: AUD('intro'), volume: 0.8 },
  { name: 'hit', url: AUD('hit'), volume: 0.9 },
  { name: 'explosion', url: AUD('explosion'), volume: 0.9 },
  { name: 'collect', url: AUD('collect'), volume: 0.9 },
  { name: 'chime', url: AUD('chime'), volume: 0.8 },
]

const BG_URL = imgUrls['./assets/img/space-bg.png'] ?? ''

/* ---------- 玩法参数 ---------- */
const DURATION = 60
const LIVES = 3
const COUNTDOWN = 3
const COMBO_MILESTONE = 5
const COMBO_BONUS = 50
/** 能量球得分 */
const ORB_SCORE = 20
/** 能量球寿命（秒） */
const ORB_LIFE = 4
/** 能量球生成间隔（秒） */
const ORB_SPAWN = 4.5
/** 碰撞无敌时长（秒） */
const INVULN = 1.2
/** 飞船尺寸（半径，画布比例） */
const SHIP_R = 0.045

/** 阶段化难度：60s 分 3 阶段，逐段加入障碍类型并提速 */
interface StageCfg {
  until: number
  kinds: Array<{ kind: ObKind; weight: number }>
  spawn: number
  /** 障碍向左移动速度（归一化/秒） */
  speed: number
}

const STAGES: StageCfg[] = [
  // 阶段1（0-20s）：只有流星，慢速
  { until: 20, kinds: [{ kind: 'meteor', weight: 1 }], spawn: 1.5, speed: 0.16 },
  // 阶段2（20-40s）：+激光柱，提速
  { until: 40, kinds: [{ kind: 'meteor', weight: 70 }, { kind: 'laser', weight: 30 }], spawn: 1.1, speed: 0.22 },
  // 阶段3（40-60s）：双障碍，最快
  { until: 60, kinds: [{ kind: 'meteor', weight: 60 }, { kind: 'laser', weight: 40 }], spawn: 0.8, speed: 0.3 },
]

function stageAt(t: number): number {
  for (let i = 0; i < STAGES.length; i++) if (t < STAGES[i].until) return i
  return STAGES.length - 1
}

function pickKind(stage: StageCfg): ObKind {
  const total = stage.kinds.reduce((s, k) => s + k.weight, 0)
  let r = Math.random() * total
  for (const k of stage.kinds) {
    r -= k.weight
    if (r < 0) return k.kind
  }
  return stage.kinds[stage.kinds.length - 1].kind
}

type ObKind = 'meteor' | 'laser'

interface Obstacle {
  kind: ObKind
  x: number
  y: number
  /** 流星半径 / 激光半宽（归一化） */
  r: number
  /** 激光高度（归一化） */
  h: number
  vx: number
}

interface Orb {
  x: number
  y: number
  bornAt: number
  /** 位标记：1=P1 碰到 2=P2 碰到 3=两人都碰到（收球条件） */
  touch: number
}

/** 星空背景点 */
interface Star { x: number; y: number; r: number; speed: number; tw: number }

function clamp(v: number, a: number, b: number) { return Math.min(b, Math.max(a, v)) }
function dist(ax: number, ay: number, bx: number, by: number) { return Math.hypot(ax - bx, ay - by) }

import type { GameSpec } from '../../core/types'

export const coPilotSpec: GameSpec = {
  id: 'co-pilot',
  name: '双人合力驾驶',
  icon: '🚀',
  desc: 'P1 控上下、P2 控左右，合体飞船躲开流星与激光；能量球要两人同时碰到才得分',
  maxPlayers: 2,
  genre: 'arcade',
  difficulty: 'normal',
  controls: '双手 · 分轴合力',
  create: (c) => new CoPilotGame(c),
}

class CoPilotGame implements GameInstance {
  private ctx: GameContext
  private finished = false
  private t = 0
  private time = 0
  private countdown = COUNTDOWN
  private lives = LIVES
  private score = 0
  private orbs = 0
  private combo = 0
  private maxCombo = 0
  private invuln = 0
  private ship = { x: 0.3, y: 0.5 }
  /** 玩家主手最新位置（画布归一化；不可见时保持原位） */
  private handPos = [
    { x: 0.3, y: 0.5, visible: false },
    { x: 0.3, y: 0.5, visible: false },
  ]
  private obstacles: Obstacle[] = []
  private orb: Orb | null = null
  private orbTimer = 2.5
  private spawnTimer = 1.2
  private stars: Star[] = []
  private bgImg: HTMLImageElement | null = null

  constructor(ctx: GameContext) {
    this.ctx = ctx
    if (BG_URL) {
      const im = new Image()
      im.src = BG_URL
      this.bgImg = im
    }
    for (let i = 0; i < 64; i++) {
      this.stars.push({
        x: Math.random(),
        y: Math.random(),
        r: Math.random() * 0.004 + 0.002,
        speed: Math.random() * 0.05 + 0.02,
        tw: Math.random() * Math.PI * 2,
      })
    }
  }

  onEnter(): void {
    this.t = 0
    this.time = 0
    this.countdown = COUNTDOWN
    this.lives = LIVES
    this.score = 0
    this.orbs = 0
    this.combo = 0
    this.maxCombo = 0
    this.obstacles = []
    this.orb = null
    this.orbTimer = 2.5
    this.spawnTimer = 1.2
    this.ship = { x: 0.3, y: 0.5 }
    this.ctx.audio.startBgm('bgm')
    this.ctx.audio.play('intro')
  }

  onExit(): void {
    this.ctx.audio.stopBgm()
  }

  pause(): void {
    this.ctx.audio.stopBgm()
  }

  resume(): void {
    this.ctx.audio.startBgm('bgm')
  }

  get done(): boolean { return this.finished }

  onGesture(e: GestureEvent): void {
    const hands = e.type === 'point' ? e.hands : e.type === 'tap' ? [e.hand] : []
    if (hands.length === 0) return
    // 每玩家取主手（右手可见优先，其次左手可见，最后右手）
    for (let p = 0; p < 2; p++) {
      const mine = hands.filter((h) => h.player === p)
      if (mine.length === 0) continue
      const right = mine.find((h) => h.side === 'right' && h.visible)
      const left = mine.find((h) => h.side === 'left' && h.visible)
      const pick = right ?? left ?? mine.find((h) => h.side === 'right') ?? mine[0]
      if (pick) {
        this.handPos[p].x = pick.x
        this.handPos[p].y = pick.y
        this.handPos[p].visible = pick.visible
      }
    }
  }

  update(dt: number): void {
    this.t += dt
    if (this.countdown > 0) {
      this.countdown -= dt
      return
    }
    this.time += dt

    const multi = this.ctx.match.playerCount >= 2
    // 飞船控制：双人分轴（P2 管 X，P1 管 Y）；单人单手直控
    const p1 = this.handPos[0]
    const p2 = multi ? this.handPos[1] : this.handPos[0]
    if (multi) {
      if (p2.visible) this.ship.x = p2.x
      if (p1.visible) this.ship.y = p1.y
    } else {
      if (p1.visible) {
        this.ship.x = p1.x
        this.ship.y = p1.y
      }
    }
    this.ship.x = clamp(this.ship.x, 0.03, 0.97)
    this.ship.y = clamp(this.ship.y, 0.06, 0.94)
    if (this.invuln > 0) this.invuln -= dt

    const stage = STAGES[stageAt(this.time)]
    // 刷障碍
    this.spawnTimer -= dt
    if (this.spawnTimer <= 0) {
      this.spawnTimer = stage.spawn
      this.spawnObstacle(stage)
    }
    // 障碍移动与碰撞
    for (const ob of this.obstacles) ob.x -= ob.vx * dt
    for (const ob of this.obstacles) {
      if (this.invuln <= 0 && this.hitObstacle(ob)) {
        this.lives -= 1
        this.invuln = INVULN
        this.ctx.audio.play('hit')
        this.ctx.fx.burst(this.ship.x * VIEW_W, this.ship.y * VIEW_H, '#ff6b4a', 26)
        this.ctx.fx.float(this.ship.x * VIEW_W, this.ship.y * VIEW_H - 60, '-1 ♥', '#ff6b4a', 0.065, { life: 1.1 })
        if (this.lives <= 0) {
          this.finish()
          return
        }
      }
    }
    this.obstacles = this.obstacles.filter((o) => o.x > -0.15)

    // 能量球
    if (!this.orb) {
      this.orbTimer -= dt
      if (this.orbTimer <= 0) {
        this.orb = {
          x: Math.random() * 0.7 + 0.15,
          y: Math.random() * 0.7 + 0.15,
          bornAt: this.time,
          touch: 0,
        }
        this.orbTimer = ORB_SPAWN
      }
    } else {
      const o = this.orb
      // 单人：单手进范围即收；双人：两手都进才收
      const r = 0.075
      const t1 = dist(p1.x, p1.y, o.x, o.y) <= r && p1.visible
      const t2 = multi ? dist(p2.x, p2.y, o.x, o.y) <= r && p2.visible : true
      if (t1) o.touch |= 1
      if (t2 && multi) o.touch |= 2
      const collected = multi ? o.touch === 3 : o.touch === 1
      if (collected) {
        this.collectOrb(o)
        this.orb = null
      } else if (this.time - o.bornAt > ORB_LIFE) {
        this.orb = null
      }
    }

    // 星空滚动
    for (const s of this.stars) {
      s.x -= s.speed * dt
      if (s.x < 0) {
        s.x = 1
        s.y = Math.random()
      }
    }
  }

  private spawnObstacle(stage: StageCfg): void {
    const kind = pickKind(stage)
    if (kind === 'meteor') {
      this.obstacles.push({ kind, x: 1.12, y: Math.random() * 0.8 + 0.1, r: Math.random() * 0.035 + 0.03, h: 0, vx: stage.speed })
    } else {
      this.obstacles.push({ kind, x: 1.12, y: Math.random() * 0.6 + 0.2, r: 0.035, h: Math.random() * 0.35 + 0.2, vx: stage.speed * 1.15 })
    }
  }

  private hitObstacle(ob: Obstacle): boolean {
    const sx = this.ship.x
    const sy = this.ship.y
    if (ob.kind === 'meteor') {
      return dist(sx, sy, ob.x, ob.y) <= ob.r + SHIP_R
    }
    // 激光柱：矩形碰撞
    const hw = ob.r
    return Math.abs(sx - ob.x) <= hw + SHIP_R * 0.8 && Math.abs(sy - ob.y) <= ob.h / 2 + SHIP_R * 0.8
  }

  private collectOrb(o: Orb): void {
    this.score += ORB_SCORE
    this.orbs += 1
    this.combo += 1
    this.maxCombo = Math.max(this.maxCombo, this.combo)
    const cx = o.x * VIEW_W
    const cy = o.y * VIEW_H
    this.ctx.audio.play('collect')
    this.ctx.fx.burst(cx, cy, '#ffd94a', 22)
    if (this.combo > 1) {
      this.ctx.fx.float(cx, cy - 30, `连击 ${this.combo}`, '#ffd94a', 0.075)
    }
    this.ctx.fx.float(cx, cy, `+${ORB_SCORE}`, '#7ce8a9', 0.08)
    if (this.combo > 0 && this.combo % COMBO_MILESTONE === 0) {
      this.score += COMBO_BONUS
      this.ctx.audio.play('chime')
      this.ctx.fx.float(cx, cy - 70, `连击奖励 +${COMBO_BONUS}`, '#ffd94a', 0.1, { life: 1.3 })
    }
  }

  private finish(): void {
    this.finished = true
    this.ctx.audio.stopBgm()
    this.ctx.audio.play('explosion')
    const score = this.score
    const stats = [
      { label: '收球', value: this.orbs },
      { label: '最高连击', value: this.maxCombo },
    ]
    const n = this.ctx.match.playerCount
    this.ctx.engine.endGame({
      scores: Array.from({ length: n }, (_, p) => ({ player: p, score, hits: this.orbs, maxCombo: this.maxCombo, stats })),
    })
  }

  /* ============ 渲染 ============ */
  render(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    // 背景：太空网格（cover 裁切）
    if (this.bgImg && this.bgImg.width > 0) {
      const scale = Math.max(w / this.bgImg.width, h / this.bgImg.height)
      const dw = this.bgImg.width * scale
      const dh = this.bgImg.height * scale
      ctx.drawImage(this.bgImg, (w - dw) / 2, (h - dh) / 2, dw, dh)
    } else {
      ctx.fillStyle = '#0a0e1a'
      ctx.fillRect(0, 0, w, h)
    }
    // 星空
    for (const s of this.stars) {
      ctx.globalAlpha = 0.35 + 0.3 * Math.sin(this.t * 3 + s.tw)
      ctx.fillStyle = '#cfe4ff'
      ctx.beginPath()
      ctx.arc(s.x * w, s.y * h, s.r * w, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.globalAlpha = 1

    // 倒计时
    if (this.countdown > 0) {
      ctx.textAlign = 'center'
      ctx.font = `bold ${Math.round(h * 0.22)}px sans-serif`
      ctx.fillStyle = 'rgba(255,255,255,0.92)'
      ctx.fillText(String(Math.ceil(this.countdown)), w / 2, h * 0.55)
      ctx.font = `bold ${Math.round(h * 0.035)}px sans-serif`
      ctx.fillStyle = 'rgba(255,255,255,0.7)'
      ctx.fillText('合体驾驶 · 准备', w / 2, h * 0.66)
      this.renderShip(ctx, w, h)
      return
    }

    // 障碍
    for (const ob of this.obstacles) {
      if (ob.kind === 'meteor') this.renderMeteor(ctx, ob, w, h)
      else this.renderLaser(ctx, ob, w, h)
    }

    // 能量球
    if (this.orb) this.renderOrb(ctx, this.orb, w, h)

    // 飞船（无敌闪烁）
    if (this.invuln > 0 && Math.floor(this.t * 12) % 2 === 0) {
      // 闪烁期间半透明
      ctx.globalAlpha = 0.35
      this.renderShip(ctx, w, h)
      ctx.globalAlpha = 1
    } else {
      this.renderShip(ctx, w, h)
    }

    // HUD（大字号）
    ctx.textAlign = 'left'
    ctx.font = `bold ${Math.round(h * 0.09)}px sans-serif`
    ctx.fillStyle = '#ffffff'
    ctx.shadowColor = 'rgba(0,0,0,0.6)'
    ctx.shadowBlur = 8
    ctx.fillText(String(this.score), w * 0.03, h * 0.09)
    // 生命
    for (let i = 0; i < LIVES; i++) {
      const lx = w * 0.03 + i * w * 0.045
      this.drawHeart(ctx, lx, h * 0.135, w * 0.032, h * 0.032, i < this.lives)
    }
    ctx.shadowBlur = 0
    // 倒计时
    ctx.textAlign = 'right'
    ctx.font = `bold ${Math.round(h * 0.065)}px sans-serif`
    ctx.fillStyle = this.time > DURATION - 10 ? '#ffd94a' : '#ffffff'
    ctx.fillText(`${Math.max(0, Math.ceil(DURATION - this.time))}s`, w * 0.97, h * 0.08)
    // 连击
    if (this.combo > 1) {
      ctx.textAlign = 'center'
      ctx.font = `bold ${Math.round(h * 0.05)}px sans-serif`
      ctx.fillStyle = '#ffd94a'
      ctx.fillText(`连击 ×${this.combo}`, w / 2, h * 0.1)
    }
    // 底部操作提示
    ctx.textAlign = 'center'
    ctx.font = `bold ${Math.round(h * 0.028)}px sans-serif`
    ctx.fillStyle = 'rgba(255,255,255,0.55)'
    ctx.fillText(
      this.ctx.match.playerCount >= 2 ? 'P1 手控上下 · P2 手控左右 · 能量球两人同碰' : '手直接控制飞船 · 碰能量球得分',
      w / 2,
      h * 0.97,
    )

    this.ctx.fx.render(ctx)
  }

  /** 合体飞船：蓝红双引擎圆机体 */
  private renderShip(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    const x = this.ship.x * w
    const y = this.ship.y * h
    const r = SHIP_R * w
    // 尾焰（左右引擎）
    const flame = (ox: number, color: string) => {
      const fy = y + r * 1.5
      ctx.fillStyle = color
      ctx.globalAlpha = 0.75
      ctx.beginPath()
      ctx.moveTo(x + ox * r * 0.5, y + r * 0.55)
      ctx.lineTo(x + ox * r * 0.5 - r * 0.22, fy)
      ctx.lineTo(x + ox * r * 0.5 + r * 0.22, fy)
      ctx.closePath()
      ctx.fill()
      ctx.globalAlpha = 1
    }
    flame(-0.62, '#00a8e8')
    flame(0.62, '#ff2d55')
    // 机体
    ctx.fillStyle = '#18243a'
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = '#5b7ba6'
    ctx.lineWidth = Math.max(2, w * 0.004)
    ctx.stroke()
    // 玻璃罩（上半圆）
    ctx.beginPath()
    ctx.arc(x, y - r * 0.18, r * 0.62, Math.PI, 0)
    ctx.closePath()
    ctx.fillStyle = 'rgba(120,200,255,0.28)'
    ctx.fill()
    ctx.strokeStyle = '#8fd4ff'
    ctx.lineWidth = Math.max(1.5, w * 0.0025)
    ctx.stroke()
    // 左右引擎灯
    ctx.fillStyle = '#00a8e8'
    ctx.beginPath()
    ctx.arc(x - r * 0.62, y + r * 0.4, r * 0.16, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#ff2d55'
    ctx.beginPath()
    ctx.arc(x + r * 0.62, y + r * 0.4, r * 0.16, 0, Math.PI * 2)
    ctx.fill()
  }

  private renderMeteor(ctx: CanvasRenderingContext2D, ob: Obstacle, w: number, h: number): void {
    const x = ob.x * w
    const y = ob.y * h
    const r = ob.r * w
    const g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.2, x, y, r)
    g.addColorStop(0, '#e8a06a')
    g.addColorStop(0.5, '#a65a34')
    g.addColorStop(1, '#5a2c1a')
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fill()
    // 陨石坑纹
    ctx.fillStyle = 'rgba(40,16,8,0.5)'
    ctx.beginPath()
    ctx.arc(x - r * 0.25, y - r * 0.1, r * 0.3, 0, Math.PI * 2)
    ctx.fill()
    // 尾迹
    ctx.fillStyle = 'rgba(232,160,106,0.35)'
    ctx.beginPath()
    ctx.moveTo(x + r, y - r * 0.35)
    ctx.lineTo(x + r * 2.2, y)
    ctx.lineTo(x + r, y + r * 0.35)
    ctx.closePath()
    ctx.fill()
  }

  private renderLaser(ctx: CanvasRenderingContext2D, ob: Obstacle, w: number, h: number): void {
    const x = ob.x * w
    const y0 = (ob.y - ob.h / 2) * h
    const hh = ob.h * h
    const hw = ob.r * w
    const g = ctx.createLinearGradient(x - hw, 0, x + hw, 0)
    g.addColorStop(0, 'rgba(255,45,85,0)')
    g.addColorStop(0.35, 'rgba(255,90,120,0.92)')
    g.addColorStop(0.5, '#ffd0d8')
    g.addColorStop(0.65, 'rgba(255,90,120,0.92)')
    g.addColorStop(1, 'rgba(255,45,85,0)')
    ctx.fillStyle = g
    ctx.fillRect(x - hw, y0, hw * 2, hh)
    // 光晕
    ctx.fillStyle = 'rgba(255,45,85,0.22)'
    ctx.fillRect(x - hw * 1.7, y0, hw * 3.4, hh)
    // 端头
    ctx.fillStyle = '#ffd0d8'
    ctx.beginPath()
    ctx.arc(x, y0, hw * 0.9, 0, Math.PI * 2)
    ctx.fill()
    ctx.beginPath()
    ctx.arc(x, y0 + hh, hw * 0.9, 0, Math.PI * 2)
    ctx.fill()
  }

  /** 能量球：发光能量核 + P1/P2 同步进度环 */
  private renderOrb(ctx: CanvasRenderingContext2D, o: Orb, w: number, h: number): void {
    const x = o.x * w
    const y = o.y * h
    const r = 0.075 * w
    const pulse = 1 + 0.12 * Math.sin(this.t * 6)
    // 光晕
    const g = ctx.createRadialGradient(x, y, r * 0.1, x, y, r * 1.6)
    g.addColorStop(0, 'rgba(255,217,74,0.5)')
    g.addColorStop(1, 'rgba(255,217,74,0)')
    ctx.fillStyle = g
    ctx.fillRect(x - r * 1.6, y - r * 1.6, r * 3.2, r * 3.2)
    // 核
    ctx.fillStyle = '#fff3c4'
    ctx.beginPath()
    ctx.arc(x, y, r * 0.55 * pulse, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = '#ffd94a'
    ctx.lineWidth = Math.max(2, w * 0.003)
    ctx.stroke()
    // 同步环：P1 上半蓝、P2 下半红（touch 到哪边哪边点亮）
    const arc = (from: number, to: number, color: string, on: boolean) => {
      ctx.strokeStyle = on ? color : 'rgba(255,255,255,0.25)'
      ctx.lineWidth = Math.max(3, w * 0.005)
      ctx.beginPath()
      ctx.arc(x, y, r * 1.25, from, to)
      ctx.stroke()
    }
    arc(Math.PI, Math.PI * 2, '#00a8e8', (o.touch & 1) !== 0)
    arc(0, Math.PI, '#ff2d55', (o.touch & 2) !== 0)
    // 剩余时间
    const left = ORB_LIFE - (this.time - o.bornAt)
    if (left < 1.5) {
      ctx.fillStyle = 'rgba(255,255,255,0.75)'
      ctx.font = `bold ${Math.round(h * 0.03)}px sans-serif`
      ctx.textAlign = 'center'
      ctx.fillText(`${Math.ceil(left)}s`, x, y - r * 1.9)
    }
  }

  /** HUD 红心（保留用法：灰=失去） */
  private drawHeart(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, on: boolean): void {
    ctx.save()
    ctx.translate(x, y)
    ctx.scale(w / 34, h / 30)
    ctx.fillStyle = on ? '#ff2d55' : 'rgba(255,255,255,0.18)'
    ctx.beginPath()
    ctx.moveTo(17, 30)
    ctx.bezierCurveTo(2, 20, 0, 4, 12, 1)
    ctx.bezierCurveTo(20, 0, 25, 6, 17, 12)
    ctx.bezierCurveTo(9, 6, 14, 0, 22, 1)
    ctx.bezierCurveTo(34, 4, 32, 20, 17, 30)
    ctx.fill()
    ctx.restore()
  }
}
