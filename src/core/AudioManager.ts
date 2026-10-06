/* ============ AudioManager：音频加载与播放（全局） ============
   素材按游戏目录存放，由各游戏注册时传入音频清单（Vite import 后的 URL）。 */

export interface AudioAsset {
  name: string
  url: string
  /** 循环播放（BGM） */
  loop?: boolean
  volume?: number
}

export class AudioManager {
  private pool = new Map<string, { el: HTMLAudioElement; asset: AudioAsset }>()
  private muted = false
  private bgmName: string | null = null

  /** 注册一组音频（同一游戏内调用一次） */
  register(assets: AudioAsset[]): void {
    for (const a of assets) {
      if (this.pool.has(a.name)) continue
      const el = new Audio(a.url)
      el.loop = a.loop ?? false
      el.preload = 'auto'
      el.volume = a.volume ?? 1
      if (a.loop) el.addEventListener('timeupdate', () => { if (el.currentTime > el.duration - 0.4) { try { el.currentTime = 0 } catch { /* noop */ } } })
      this.pool.set(a.name, { el, asset: a })
    }
  }

  /** 浏览器自动播放策略：需要在用户手势后调用一次解锁 */
  unlock(): void {
    this.pool.forEach(({ el }) => {
      if (el.paused) {
        el.muted = true
        el.play().catch(() => {})
        el.muted = this.muted
      }
    })
  }

  play(name: string, volume?: number): void {
    const item = this.pool.get(name)
    if (!item || this.muted) return
    const el = item.el
    if (volume !== undefined) el.volume = volume
    el.currentTime = 0
    el.play().catch(() => {})
  }

  /** 播放但避免叠加噪音（同一音效短时间内只播一次） */
  playThrottled(name: string, minGapMs = 60, volume?: number): void {
    const item = this.pool.get(name)
    if (!item || this.muted) return
    const now = performance.now()
    if (item.el.dataset.last && now - Number(item.el.dataset.last) < minGapMs) return
    item.el.dataset.last = String(now)
    this.play(name, volume)
  }

  startBgm(name: string): void {
    if (this.bgmName === name) return
    this.stopBgm()
    const item = this.pool.get(name)
    if (!item || this.muted) return
    item.el.currentTime = 0
    item.el.play().catch(() => {})
    this.bgmName = name
  }

  stopBgm(): void {
    if (this.bgmName) {
      const item = this.pool.get(this.bgmName)
      if (item) item.el.pause()
      this.bgmName = null
    }
  }

  stopAll(): void {
    this.stopBgm()
    this.pool.forEach(({ el }) => el.pause())
  }

  setMuted(m: boolean): void {
    this.muted = m
    this.pool.forEach(({ el }) => (el.muted = m))
    if (!m && this.bgmName) this.play(this.bgmName)
  }

  get isMuted(): boolean {
    return this.muted
  }
}
