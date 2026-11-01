/* ============ gameKit：通用玩法工具箱 ============
   每个游戏对局注入一个 GameKit（GameContext.fx），提供跨游戏复用的表现层能力：
   - 飘字（得分 +N、连击提示、灭火！等）
   - 粒子爆发（命中火花、爆炸、庆祝等）
   - 统一 update/render（游戏只需调用 fx.update(dt) 与 fx.render(ctx,w,h)）
   打地鼠第一版自己实现了粒子/飘字，已迁移到这里；后续游戏直接复用。 */

export interface KitFloat {
  x: number
  y: number
  text: string
  color: string
  size: number
  life: number
  max: number
  vy: number
}

export interface KitParticle {
  x: number
  y: number
  vx: number
  vy: number
  life: number
  max: number
  color: string
  size: number
}

export interface FloatOptions {
  /** 上飘速度（px/s，默认 70） */
  vy?: number
  /** 存活时长（s，默认 1.0） */
  life?: number
}

export interface BurstOptions {
  /** 初速度范围（默认 ±260 横向、-220 纵向） */
  power?: number
  /** 重力（px/s²，默认 300） */
  gravity?: number
  /** 存活时长（s，默认 0.5） */
  life?: number
  /** 粒子尺寸范围（默认 3..7） */
  sizeMin?: number
  sizeMax?: number
}

export class GameKit {
  private floats: KitFloat[] = []
  private particles: KitParticle[] = []
  private particlesGravity: number[] = []

  /** 清空（引擎在换局时调用） */
  clear(): void {
    this.floats = []
    this.particles = []
    this.particlesGravity = []
  }

  /** 飘字（带描边大字，屏幕上浮 + 淡出） */
  float(x: number, y: number, text: string, color: string, size: number, opts: FloatOptions = {}): void {
    this.floats.push({
      x,
      y,
      text,
      color,
      size,
      life: opts.life ?? 1.0,
      max: opts.life ?? 1.0,
      vy: opts.vy ?? 70,
    })
  }

  /** 粒子爆发：向四周迸散的小圆点（默认向上喷射） */
  burst(x: number, y: number, color: string, n: number, opts: BurstOptions = {}): void {
    const power = opts.power ?? 260
    const gravity = opts.gravity ?? 300
    const life = opts.life ?? 0.5
    const sizeMin = opts.sizeMin ?? 3
    const sizeMax = opts.sizeMax ?? 7
    for (let i = 0; i < n; i++) {
      this.particles.push({
        x,
        y,
        vx: (Math.random() - 0.5) * power * 2,
        vy: -Math.random() * power * 0.85,
        life,
        max: life,
        color,
        size: sizeMin + Math.random() * (sizeMax - sizeMin),
      })
      this.particlesGravity.push(gravity)
    }
  }

  update(dt: number): void {
    for (let i = this.floats.length - 1; i >= 0; i--) {
      const f = this.floats[i]
      f.life -= dt
      f.y -= f.vy * dt
      if (f.life <= 0) this.floats.splice(i, 1)
    }
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const pt = this.particles[i]
      pt.life -= dt
      if (pt.life <= 0) {
        this.particles.splice(i, 1)
        this.particlesGravity.splice(i, 1)
        continue
      }
      pt.x += pt.vx * dt
      pt.y += pt.vy * dt
      pt.vy += this.particlesGravity[i] * dt
    }
  }

  /** 统一渲染：粒子（圆点淡出）+ 飘字（描边大字淡出） */
  render(ctx: CanvasRenderingContext2D): void {
    for (const pt of this.particles) {
      const a = Math.min(1, Math.max(0, pt.life / pt.max))
      ctx.globalAlpha = a
      ctx.fillStyle = pt.color
      ctx.beginPath()
      ctx.arc(pt.x, pt.y, pt.size, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.textAlign = 'center'
    for (const ft of this.floats) {
      const a = Math.min(1, Math.max(0, ft.life / ft.max))
      ctx.globalAlpha = a
      ctx.font = `900 ${ft.size}px sans-serif`
      ctx.fillStyle = ft.color
      ctx.strokeStyle = 'rgba(0,0,0,0.65)'
      ctx.lineWidth = Math.max(3, ft.size * 0.14)
      ctx.strokeText(ft.text, ft.x, ft.y)
      ctx.fillText(ft.text, ft.x, ft.y)
    }
    ctx.globalAlpha = 1
  }
}
