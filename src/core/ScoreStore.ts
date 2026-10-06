/* ============ ScoreStore：游戏结果持久化 ============
   按「游戏 id + 玩家槽位」保存成绩到 localStorage，记录最高分与最近若干局。 */

import type { GameResult, PlayerScore } from './types'

export interface PlayerHistory {
  best: number
  last: number
  plays: number
  recent: Array<{ score: number; hits: number; ts: number }>
}

const MAX_RECENT = 10

export class ScoreStore {
  constructor(private storage: Storage = localStorage) {}

  private key(gameId: string, player: number): string {
    return `arcade.score.${gameId}.p${player + 1}`
  }

  load(gameId: string, player: number): PlayerHistory {
    try {
      const raw = this.storage.getItem(this.key(gameId, player))
      if (!raw) return { best: 0, last: 0, plays: 0, recent: [] }
      const parsed = JSON.parse(raw) as PlayerHistory
      return {
        best: parsed.best ?? 0,
        last: parsed.last ?? 0,
        plays: parsed.plays ?? 0,
        recent: parsed.recent ?? [],
      }
    } catch {
      return { best: 0, last: 0, plays: 0, recent: [] }
    }
  }

  /** 提交一局成绩，返回每位玩家是否破纪录 */
  submit(gameId: string, result: GameResult): boolean[] {
    return result.scores.map((ps) => this.submitOne(gameId, ps))
  }

  private submitOne(gameId: string, ps: PlayerScore): boolean {
    const hist = this.load(gameId, ps.player)
    const isRecord = ps.score > hist.best
    hist.best = Math.max(hist.best, ps.score)
    hist.last = ps.score
    hist.plays += 1
    hist.recent.push({ score: ps.score, hits: ps.hits, ts: Date.now() })
    if (hist.recent.length > MAX_RECENT) hist.recent = hist.recent.slice(-MAX_RECENT)
    try {
      this.storage.setItem(this.key(gameId, ps.player), JSON.stringify(hist))
    } catch {
      /* storage 不可用时静默失败 */
    }
    return isRecord
  }
}
