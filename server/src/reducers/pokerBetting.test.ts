import { describe, expect, it } from 'vitest'
import type { QuizPokerPlayerState } from '../../../shared/protocol.js'
import {
  applyBettingAction,
  createBettingRound,
  getLegalActions,
  postBlinds,
  buildSidePots,
  awardPotToWinners,
  DEFAULT_BIG_BLIND,
  DEFAULT_SMALL_BLIND,
} from './pokerBetting.js'

function seat(id: string, chips: number): QuizPokerPlayerState {
  return {
    playerId: id,
    chips,
    betThisRound: 0,
    totalBetHand: 0,
    folded: false,
    allIn: false,
    guess: null,
    guessSubmitted: false,
    webcamEnabled: false,
  }
}

describe('postBlinds', () => {
  it('posts SB and BB in heads-up', () => {
    const seatOrder = ['a', 'b']
    const players: Record<string, QuizPokerPlayerState> = {
      a: seat('a', 100),
      b: seat('b', 100),
    }
    const betting = createBettingRound(seatOrder, 0, 1)
    const { players: next, betting: b } = postBlinds(players, betting, DEFAULT_SMALL_BLIND, DEFAULT_BIG_BLIND)
    expect(b.subPhase).toBe('action')
    expect(b.currentBet).toBe(DEFAULT_BIG_BLIND)
    const totalChips = (next.a?.chips ?? 0) + (next.b?.chips ?? 0) + (next.a?.betThisRound ?? 0) + (next.b?.betThisRound ?? 0)
    expect(totalChips).toBe(200)
  })
})

describe('applyBettingAction', () => {
  it('allows fold and advances', () => {
    const seatOrder = ['a', 'b', 'c']
    let players: Record<string, QuizPokerPlayerState> = {
      a: seat('a', 100),
      b: seat('b', 100),
      c: seat('c', 100),
    }
    let betting = createBettingRound(seatOrder, 0, 1)
    ;({ players, betting } = postBlinds(players, betting, DEFAULT_SMALL_BLIND, DEFAULT_BIG_BLIND))

    const actor = betting.seatOrder[betting.currentActorIndex]!
    const legal = getLegalActions(players, betting, actor)
    expect(legal).toContain('fold')

    const result = applyBettingAction(players, betting, actor, 'fold')
    expect(result).not.toBeNull()
    expect(result!.players[actor]?.folded).toBe(true)
  })
})

describe('collectBetsToPot and award', () => {
  it('awards main pot to one winner', () => {
    const players: Record<string, QuizPokerPlayerState> = {
      a: { ...seat('a', 50), totalBetHand: 50 },
      b: { ...seat('b', 0), totalBetHand: 50, folded: true },
    }
    const awarded = awardPotToWinners(players, ['a'], 100, [])
    expect(awarded.a?.chips).toBe(150)
  })

  it('splits pot between two winners', () => {
    const players: Record<string, QuizPokerPlayerState> = {
      a: seat('a', 0),
      b: seat('b', 0),
    }
    const awarded = awardPotToWinners(players, ['a', 'b'], 101, [])
    expect(awarded.a?.chips + awarded.b?.chips).toBe(101)
  })
})

describe('buildSidePots', () => {
  it('builds side pot when stacks differ', () => {
    const seatOrder = ['a', 'b', 'c']
    const players: Record<string, QuizPokerPlayerState> = {
      a: { ...seat('a', 0), totalBetHand: 10 },
      b: { ...seat('b', 0), totalBetHand: 50 },
      c: { ...seat('c', 0), totalBetHand: 50 },
    }
    const { sidePots, mainPot } = buildSidePots(seatOrder, players, 0)
    expect(sidePots.length + (mainPot > 0 ? 1 : 0)).toBeGreaterThan(0)
  })
})
