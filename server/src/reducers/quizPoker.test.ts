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
        guess: 98,
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
        guess: 102,
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
    expect(rank[0]!.distance).toBe(2)
    expect(rank[0]!.tiedForClosest).toBe(true)
    expect(rank[1]!.distance).toBe(2)
    expect(rank[1]!.tiedForClosest).toBe(true)
  })

  it('does not mark a sole closest guess as tied', () => {
    const seatOrder = ['solo', 'far']
    const players = {
      solo: {
        playerId: 'solo',
        chips: 100,
        betThisRound: 0,
        totalBetHand: 0,
        folded: false,
        allIn: false,
        guess: 50,
        guessSubmitted: true,
        webcamEnabled: false,
      },
      far: {
        playerId: 'far',
        chips: 100,
        betThisRound: 0,
        totalBetHand: 0,
        folded: false,
        allIn: false,
        guess: 10,
        guessSubmitted: true,
        webcamEnabled: false,
      },
    }
    const rank = rankGuesses(players, seatOrder, 100)
    expect(rank[0]!.playerId).toBe('solo')
    expect(rank[0]!.tiedForClosest).toBe(false)
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

describe('blinds', () => {
  it('posts blinds only on betting_1, not later rounds', () => {
    let state = createQuizPokerState()
    state = syncSeatOrder(state, ['p1', 'p2', 'p3'])
    const qs = parseQuizPokerQuestions('Distance to moon:384400:space:orbit')

    state = reduceQuizPoker(state, { kind: 'host', action: 'set_questions', questions: qs })
    state = reduceQuizPoker(state, { kind: 'host', action: 'select_question', questionId: qs[0]!.id })
    state = reduceQuizPoker(state, { kind: 'host', action: 'start_guessing' })

    const chipsBeforeRound1 = {
      p1: state.players.p1!.chips,
      p2: state.players.p2!.chips,
      p3: state.players.p3!.chips,
    }

    state = reduceQuizPoker(state, { kind: 'host', action: 'start_betting' })
    const chipsAfterRound1Start = {
      p1: state.players.p1!.chips,
      p2: state.players.p2!.chips,
      p3: state.players.p3!.chips,
    }
    expect(
      chipsAfterRound1Start.p1 !== chipsBeforeRound1.p1 ||
        chipsAfterRound1Start.p2 !== chipsBeforeRound1.p2 ||
        chipsAfterRound1Start.p3 !== chipsBeforeRound1.p3,
    ).toBe(true)

    state = reduceQuizPoker(state, { kind: 'host', action: 'end_betting_round' }) // -> clue_1
    const chipsBeforeRound2 = {
      p1: state.players.p1!.chips,
      p2: state.players.p2!.chips,
      p3: state.players.p3!.chips,
    }

    state = reduceQuizPoker(state, { kind: 'host', action: 'start_betting' }) // round 2
    expect(state.phase).toBe('betting_2')
    expect(state.players.p1!.chips).toBe(chipsBeforeRound2.p1)
    expect(state.players.p2!.chips).toBe(chipsBeforeRound2.p2)
    expect(state.players.p3!.chips).toBe(chipsBeforeRound2.p3)
    expect(state.betting?.currentBet).toBe(0)
  })

  it('host can set big blind and small blind follows', () => {
    let state = createQuizPokerState()
    state = syncSeatOrder(state, ['p1', 'p2'])
    state = reduceQuizPoker(state, { kind: 'host', action: 'set_blinds', bigBlind: 40 })
    expect(state.bigBlind).toBe(40)
    expect(state.smallBlind).toBe(20)
  })

  it('supports all-check rounds after clue 1 and clue 2', () => {
    let state = createQuizPokerState()
    state = syncSeatOrder(state, ['p1', 'p2', 'p3'])
    const qs = parseQuizPokerQuestions('Test number:50:first clue:second clue')

    state = reduceQuizPoker(state, { kind: 'host', action: 'set_questions', questions: qs })
    state = reduceQuizPoker(state, { kind: 'host', action: 'select_question', questionId: qs[0]!.id })
    state = reduceQuizPoker(state, { kind: 'host', action: 'start_guessing' })
    state = reduceQuizPoker(state, { kind: 'player_action', playerId: 'p1', action: 'submit_guess', guess: 49 })
    state = reduceQuizPoker(state, { kind: 'player_action', playerId: 'p2', action: 'submit_guess', guess: 50 })
    state = reduceQuizPoker(state, { kind: 'player_action', playerId: 'p3', action: 'submit_guess', guess: 51 })

    // Round 1 can be ended by host to reach clue_1.
    state = reduceQuizPoker(state, { kind: 'host', action: 'start_betting' })
    state = reduceQuizPoker(state, { kind: 'host', action: 'end_betting_round' })
    expect(state.phase).toBe('clue_1')

    // After clue 1: round 2 starts with zero current bet, everyone checks.
    state = reduceQuizPoker(state, { kind: 'host', action: 'reveal_clue_1' })
    state = reduceQuizPoker(state, { kind: 'host', action: 'start_betting' })
    expect(state.phase).toBe('betting_2')
    expect(state.betting?.currentBet).toBe(0)
    expect(state.betting?.seatOrder[state.betting.currentActorIndex]).toBe('p1')

    // First check must not end the round instantly.
    const firstActorRound2 = state.betting?.seatOrder[state.betting.currentActorIndex]
    state = reduceQuizPoker(state, { kind: 'player_action', playerId: firstActorRound2!, action: 'check' })
    expect(state.betting?.subPhase).toBe('action')

    for (let i = 0; i < 6 && state.betting?.subPhase !== 'round_complete'; i++) {
      const actor = state.betting?.seatOrder[state.betting.currentActorIndex]
      if (!actor) break
      state = reduceQuizPoker(state, { kind: 'player_action', playerId: actor, action: 'check' })
    }
    expect(state.betting?.subPhase).toBe('round_complete')
    state = reduceQuizPoker(state, { kind: 'host', action: 'end_betting_round' })
    expect(state.phase).toBe('clue_2')

    // After clue 2: round 3 also supports everyone checking.
    state = reduceQuizPoker(state, { kind: 'host', action: 'reveal_clue_2' })
    state = reduceQuizPoker(state, { kind: 'host', action: 'start_betting' })
    expect(state.phase).toBe('betting_3')
    expect(state.betting?.currentBet).toBe(0)
    expect(state.betting?.seatOrder[state.betting.currentActorIndex]).toBe('p1')
    for (let i = 0; i < 6 && state.betting?.subPhase !== 'round_complete'; i++) {
      const actor = state.betting?.seatOrder[state.betting.currentActorIndex]
      if (!actor) break
      state = reduceQuizPoker(state, { kind: 'player_action', playerId: actor, action: 'check' })
    }
    expect(state.betting?.subPhase).toBe('round_complete')
    state = reduceQuizPoker(state, { kind: 'host', action: 'end_betting_round' })
    expect(state.phase).toBe('answer_reveal')
  })

  it('clears round-specific state when opening next question', () => {
    let state = createQuizPokerState()
    state = syncSeatOrder(state, ['p1', 'p2'])
    const qs = parseQuizPokerQuestions('Q1:10:c1:c2\nQ2:20:c1b:c2b')

    state = reduceQuizPoker(state, { kind: 'host', action: 'set_questions', questions: qs })
    state = reduceQuizPoker(state, { kind: 'host', action: 'select_question', questionId: qs[0]!.id })
    state = reduceQuizPoker(state, { kind: 'host', action: 'start_guessing' })
    state = reduceQuizPoker(state, { kind: 'player_action', playerId: 'p1', action: 'submit_guess', guess: 9 })
    state = reduceQuizPoker(state, { kind: 'host', action: 'reveal_guess', playerId: 'p1' })
    expect(state.revealedGuessPlayerIds).toEqual(['p1'])
    state = reduceQuizPoker(state, { kind: 'host', action: 'reveal_clue_1' })
    state = reduceQuizPoker(state, { kind: 'host', action: 'reveal_clue_2' })
    state = reduceQuizPoker(state, { kind: 'host', action: 'reveal_answer' })

    // New question selection should clear previous round reveal/guess/fold/all-in states.
    state = reduceQuizPoker(state, { kind: 'host', action: 'select_question', questionId: qs[1]!.id })
    state = reduceQuizPoker(state, { kind: 'host', action: 'start_guessing' })

    expect(state.phase).toBe('guessing')
    expect(state.guessesRevealed).toBe(false)
    expect(state.revealedGuessPlayerIds).toEqual([])
    expect(state.players.p1?.guessSubmitted).toBe(false)
    expect(state.players.p1?.guess).toBeNull()
    expect(state.players.p1?.folded).toBe(false)
    expect(state.players.p1?.allIn).toBe(false)
  })
})
