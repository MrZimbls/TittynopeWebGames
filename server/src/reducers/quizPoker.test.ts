import { describe, expect, it } from 'vitest'
import {
  createQuizPokerState,
  parseQuizPokerQuestions,
  rankGuesses,
  reduceQuizPoker,
  syncSeatOrder,
} from './quizPoker.js'

describe('parseQuizPokerQuestions', () => {
  it('parses prompt:answer:clue1:clue2', () => {
    const qs = parseQuizPokerQuestions('Height of Everest:8849:Country:Nepal')
    expect(qs).toHaveLength(1)
    expect(qs[0]!.answer).toBe(8849)
    expect(qs[0]!.clues).toEqual(['Country', 'Nepal'])
  })
})

describe('rankGuesses', () => {
  it('ranks by distance and marks ties', () => {
    const seatOrder = ['a', 'b', 'c']
    const players = {
      a: {
        playerId: 'a',
        chips: 100,
        betThisRound: 0,
        totalBetHand: 0,
        folded: false,
        allIn: false,
        guess: 100,
        guessSubmitted: true,
        webcamEnabled: false,
      },
      b: {
        playerId: 'b',
        chips: 100,
        betThisRound: 0,
        totalBetHand: 0,
        folded: false,
        allIn: false,
        guess: 95,
        guessSubmitted: true,
        webcamEnabled: false,
      },
      c: {
        playerId: 'c',
        chips: 100,
        betThisRound: 0,
        totalBetHand: 0,
        folded: true,
        allIn: false,
        guess: 90,
        guessSubmitted: true,
        webcamEnabled: false,
      },
    }
    const rank = rankGuesses(players, seatOrder, 100)
    expect(rank[0]!.playerId).toBe('a')
    expect(rank[0]!.tiedForClosest).toBe(true)
    expect(rank[1]!.playerId).toBe('b')
    expect(rank[1]!.tiedForClosest).toBe(false)
  })
})

describe('reduceQuizPoker hand flow', () => {
  it('runs select → guess → showdown with host confirm', () => {
    let state = createQuizPokerState()
    state = syncSeatOrder(state, ['p1', 'p2'])
    const qs = parseQuizPokerQuestions('Population:1000000:clueA:clueB')

    state = reduceQuizPoker(state, { kind: 'host', action: 'set_questions', questions: qs })
    state = reduceQuizPoker(state, { kind: 'host', action: 'select_question', questionId: qs[0]!.id })
    expect(state.phase).toBe('select_question')

    state = reduceQuizPoker(state, { kind: 'host', action: 'start_guessing' })
    expect(state.phase).toBe('guessing')

    state = reduceQuizPoker(state, {
      kind: 'player_action',
      playerId: 'p1',
      action: 'submit_guess',
      guess: 999000,
    })
    state = reduceQuizPoker(state, {
      kind: 'player_action',
      playerId: 'p2',
      action: 'submit_guess',
      guess: 1001000,
    })
    expect(state.players.p1?.guessSubmitted).toBe(true)

    state = reduceQuizPoker(state, { kind: 'host', action: 'start_betting' })
    expect(state.phase).toBe('betting_1')
    expect(state.betting?.subPhase).toBe('action')

    state = reduceQuizPoker(state, { kind: 'host', action: 'end_betting_round' })
    expect(state.phase).toBe('clue_1')

    state = reduceQuizPoker(state, { kind: 'host', action: 'reveal_clue_1' })
    state = reduceQuizPoker(state, { kind: 'host', action: 'start_betting' })
    state = reduceQuizPoker(state, { kind: 'host', action: 'end_betting_round' })
    expect(state.phase).toBe('clue_2')

    state = reduceQuizPoker(state, { kind: 'host', action: 'reveal_clue_2' })
    state = reduceQuizPoker(state, { kind: 'host', action: 'start_betting' })
    state = reduceQuizPoker(state, { kind: 'host', action: 'end_betting_round' })
    expect(state.phase).toBe('answer_reveal')

    state = reduceQuizPoker(state, { kind: 'host', action: 'reveal_answer' })
    state = reduceQuizPoker(state, { kind: 'host', action: 'start_betting' })
    state = reduceQuizPoker(state, { kind: 'host', action: 'end_betting_round' })
    expect(state.phase).toBe('showdown')
    expect(state.closestGuessRanking?.length).toBeGreaterThan(0)

    const winner = state.closestGuessRanking!.find((r) => r.tiedForClosest)?.playerId ?? 'p1'
    const chipsBefore = state.players[winner]?.chips ?? 0
    state = reduceQuizPoker(state, {
      kind: 'host',
      action: 'confirm_winner',
      playerIds: [winner],
    })
    expect(state.phase).toBe('hand_complete')
    expect(state.players[winner]?.chips).toBeGreaterThanOrEqual(chipsBefore)
  })
})
