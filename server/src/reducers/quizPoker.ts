import { v4 as uuid } from 'uuid'
import type {
  ClosestGuessEntry,
  QuizPokerHostAction,
  QuizPokerPhase,
  QuizPokerPlayerAction,
  QuizPokerPlayerState,
  QuizPokerQuestion,
  QuizPokerState,
} from '../../../shared/protocol.js'
import {
  applyBettingAction,
  awardPotToWinners,
  buildSidePots,
  collectBetsToPot,
  createBettingRound,
  DEFAULT_BIG_BLIND,
  DEFAULT_SMALL_BLIND,
  DEFAULT_STARTING_STACK,
  getLegalActions,
  postBlinds,
  resetRoundBets,
} from './pokerBetting.js'

export function createQuizPokerState(): QuizPokerState {
  return {
    phase: 'lobby',
    questionLibrary: [],
    activeQuestionId: null,
    clue1Revealed: false,
    clue2Revealed: false,
    answerRevealed: false,
    guessesRevealed: false,
    seatOrder: [],
    dealerIndex: 0,
    players: {},
    betting: null,
    smallBlind: DEFAULT_SMALL_BLIND,
    bigBlind: DEFAULT_BIG_BLIND,
  }
}

/** prompt:answer:clue1:clue2 per line */
export function parseQuizPokerQuestions(text: string): QuizPokerQuestion[] {
  const lines = text.split(/\r?\n/)
  const out: QuizPokerQuestion[] = []
  for (const raw of lines) {
    const line = raw.trim()
    if (!line) continue
    const parts = line.split(':')
    if (parts.length < 2) continue
    const prompt = parts[0]!.trim()
    const answer = Number(parts[1]!.trim())
    if (!Number.isFinite(answer)) continue
    const clue1 = (parts[2] ?? '').trim() || '—'
    const clue2 = (parts[3] ?? '').trim() || '—'
    out.push({
      id: uuid(),
      prompt,
      answer,
      clues: [clue1, clue2],
    })
  }
  return out
}

export function rankGuesses(
  players: Record<string, QuizPokerPlayerState>,
  seatOrder: string[],
  answer: number,
): ClosestGuessEntry[] {
  const entries: ClosestGuessEntry[] = []
  for (const id of seatOrder) {
    const p = players[id]
    if (!p || p.guess === null || p.folded) continue
    entries.push({
      playerId: id,
      guess: p.guess,
      distance: Math.abs(p.guess - answer),
      tiedForClosest: false,
    })
  }
  if (entries.length === 0) return []
  const minDist = Math.min(...entries.map((e) => e.distance))
  return entries
    .map((e) => ({ ...e, tiedForClosest: e.distance === minDist }))
    .sort((a, b) => a.distance - b.distance || a.guess - b.guess)
}

export function filterQuizPokerForViewer(
  state: QuizPokerState,
  viewerId: string,
  isHost: boolean,
): QuizPokerState {
  const activeQ = state.questionLibrary.find((q) => q.id === state.activeQuestionId)
  const filtered: QuizPokerState = {
    ...state,
    players: {},
    closestGuessRanking: isHost ? state.closestGuessRanking : undefined,
    legalActions: undefined,
  }

  if (state.betting && state.betting.subPhase === 'action') {
    filtered.legalActions = getLegalActions(state.players, state.betting, viewerId)
  }

  for (const [id, p] of Object.entries(state.players)) {
    const showGuess =
      isHost ||
      state.guessesRevealed ||
      id === viewerId ||
      state.phase === 'showdown' ||
      state.phase === 'hand_complete'
    filtered.players[id] = {
      ...p,
      guess: showGuess ? p.guess : null,
    }
  }

  if (!isHost && !state.answerRevealed) {
    filtered.questionLibrary = state.questionLibrary.map((q) => ({ ...q, answer: 0 }))
  }

  return filtered
}

export function ensurePlayer(
  state: QuizPokerState,
  playerId: string,
  inSeat: boolean,
): QuizPokerState {
  if (state.players[playerId]) return state
  const players = {
    ...state.players,
    [playerId]: {
      playerId,
      chips: DEFAULT_STARTING_STACK,
      betThisRound: 0,
      totalBetHand: 0,
      folded: false,
      allIn: false,
      guess: null,
      guessSubmitted: false,
      webcamEnabled: false,
    },
  }
  let seatOrder = state.seatOrder
  if (inSeat && !seatOrder.includes(playerId)) {
    seatOrder = [...seatOrder, playerId]
  }
  return { ...state, players, seatOrder }
}

function activeQuestion(state: QuizPokerState): QuizPokerQuestion | null {
  if (!state.activeQuestionId) return null
  return state.questionLibrary.find((q) => q.id === state.activeQuestionId) ?? null
}

function bettingPhaseForRound(n: 1 | 2 | 3 | 4): QuizPokerPhase {
  const map: Record<1 | 2 | 3 | 4, QuizPokerPhase> = {
    1: 'betting_1',
    2: 'betting_2',
    3: 'betting_3',
    4: 'betting_4',
  }
  return map[n]
}

function roundNumberFromPhase(phase: QuizPokerPhase): 1 | 2 | 3 | 4 | null {
  if (phase === 'betting_1') return 1
  if (phase === 'betting_2') return 2
  if (phase === 'betting_3') return 3
  if (phase === 'betting_4') return 4
  return null
}

function resetHandPlayerState(players: Record<string, QuizPokerPlayerState>): Record<string, QuizPokerPlayerState> {
  const next: Record<string, QuizPokerPlayerState> = {}
  for (const [id, p] of Object.entries(players)) {
    next[id] = {
      ...p,
      betThisRound: 0,
      totalBetHand: 0,
      folded: false,
      allIn: false,
      guess: null,
      guessSubmitted: false,
    }
  }
  return next
}

function startBettingRound(state: QuizPokerState, round: 1 | 2 | 3 | 4): QuizPokerState {
  if (state.seatOrder.length < 2) return state
  const players = resetRoundBets(state.players)
  const betting = createBettingRound(state.seatOrder, state.dealerIndex, round)
  let next: QuizPokerState = {
    ...state,
    phase: bettingPhaseForRound(round),
    players,
    betting,
  }
  const posted = postBlinds(next.players, next.betting!, state.smallBlind, state.bigBlind)
  return { ...next, players: posted.players, betting: posted.betting }
}

export type QuizPokerEvent =
  | { kind: 'player_join'; playerId: string }
  | { kind: 'player_action'; playerId: string; action: QuizPokerPlayerAction; amount?: number; guess?: number }
  | {
      kind: 'host'
      action: QuizPokerHostAction
      questions?: QuizPokerQuestion[]
      questionId?: string
      playerIds?: string[]
      playerId?: string
      chipsDelta?: number
      guess?: number
      phase?: QuizPokerPhase
      mainPot?: number
    }

export function reduceQuizPoker(state: QuizPokerState, event: QuizPokerEvent): QuizPokerState {
  if (event.kind === 'player_join') {
    return ensurePlayer(state, event.playerId, true)
  }

  if (event.kind === 'player_action') {
    return reducePlayerAction(state, event.playerId, event.action, event.amount, event.guess)
  }

  return reduceHostAction(state, event)
}

function reducePlayerAction(
  state: QuizPokerState,
  playerId: string,
  action: QuizPokerPlayerAction,
  amount?: number,
  guess?: number,
): QuizPokerState {
  if (action === 'submit_guess') {
    if (state.phase !== 'guessing') return state
    const p = state.players[playerId]
    if (!p || p.guessSubmitted) return state
    const g = Number(guess)
    if (!Number.isFinite(g)) return state
    return {
      ...state,
      players: {
        ...state.players,
        [playerId]: { ...p, guess: g, guessSubmitted: true },
      },
    }
  }

  const round = roundNumberFromPhase(state.phase)
  if (!round || !state.betting || state.betting.subPhase !== 'action') return state

  const result = applyBettingAction(state.players, state.betting, playerId, action, amount, state.bigBlind)
  if (!result) return state
  return { ...state, players: result.players, betting: result.betting }
}

function reduceHostAction(
  state: QuizPokerState,
  event: Extract<QuizPokerEvent, { kind: 'host' }>,
): QuizPokerState {
  const { action } = event

  if (action === 'set_questions' && event.questions) {
    return { ...state, questionLibrary: event.questions.slice(0, 200) }
  }

  if (action === 'add_question' && event.questions?.length) {
    return {
      ...state,
      questionLibrary: [...state.questionLibrary, ...event.questions].slice(0, 200),
    }
  }

  if (action === 'remove_question' && event.questionId) {
    return {
      ...state,
      questionLibrary: state.questionLibrary.filter((q) => q.id !== event.questionId),
      activeQuestionId:
        state.activeQuestionId === event.questionId ? null : state.activeQuestionId,
    }
  }

  if (action === 'select_question' && event.questionId) {
    const q = state.questionLibrary.find((x) => x.id === event.questionId)
    if (!q) return state
    return {
      ...state,
      phase: 'select_question',
      activeQuestionId: q.id,
      clue1Revealed: false,
      clue2Revealed: false,
      answerRevealed: false,
      guessesRevealed: false,
      betting: null,
      closestGuessRanking: undefined,
    }
  }

  if (action === 'start_guessing') {
    if (!activeQuestion(state)) return state
    return {
      ...state,
      phase: 'guessing',
      players: resetHandPlayerState(state.players),
      betting: null,
    }
  }

  if (action === 'start_betting') {
    const round = roundNumberFromPhase(state.phase)
    if (state.phase === 'guessing') return startBettingRound(state, 1)
    if (state.phase === 'clue_1') return startBettingRound(state, 2)
    if (state.phase === 'clue_2') return startBettingRound(state, 3)
    if (state.phase === 'answer_reveal') return startBettingRound(state, 4)
    if (round && state.betting?.subPhase === 'round_complete') {
      const nextRound = (round + 1) as 2 | 3 | 4
      if (nextRound <= 4) return startBettingRound(state, nextRound)
    }
    return state
  }

  if (action === 'end_betting_round') {
    if (!state.betting) return state
    const collected = collectBetsToPot(state.players, state.betting)
    let next: QuizPokerState = { ...state, players: collected.players, betting: collected.betting }
    const round = state.betting.roundNumber
    if (round === 1) return { ...next, phase: 'clue_1', betting: null }
    if (round === 2) return { ...next, phase: 'clue_2', betting: null }
    if (round === 3) return { ...next, phase: 'answer_reveal', betting: null }
    if (round === 4) {
      const q = activeQuestion(state)
      const ranking = q ? rankGuesses(next.players, next.seatOrder, q.answer) : []
      const pots = buildSidePots(next.seatOrder, next.players, next.betting?.mainPot ?? 0)
      return {
        ...next,
        phase: 'showdown',
        betting: next.betting
          ? { ...next.betting, mainPot: pots.mainPot, sidePots: pots.sidePots }
          : null,
        closestGuessRanking: ranking,
      }
    }
    return state
  }

  if (action === 'reveal_clue_1') {
    return { ...state, clue1Revealed: true }
  }
  if (action === 'reveal_clue_2') {
    return { ...state, clue2Revealed: true }
  }
  if (action === 'reveal_answer') {
    return { ...state, answerRevealed: true }
  }
  if (action === 'reveal_guesses') {
    return { ...state, guessesRevealed: true }
  }

  if (action === 'confirm_winner' && event.playerIds?.length) {
    if (state.phase !== 'showdown') return state
    const mainPot = state.betting?.mainPot ?? 0
    const sidePots = state.betting?.sidePots ?? []
    const winners = event.playerIds.filter((id) => state.seatOrder.includes(id))
    if (winners.length === 0) return state
    const players = awardPotToWinners(state.players, winners, mainPot, sidePots)
    return {
      ...state,
      phase: 'hand_complete',
      players,
      betting: null,
      closestGuessRanking: state.closestGuessRanking,
    }
  }

  if (action === 'next_hand') {
    const dealerIndex =
      state.seatOrder.length > 0 ? (state.dealerIndex + 1) % state.seatOrder.length : 0
    return {
      ...state,
      phase: 'lobby',
      activeQuestionId: null,
      clue1Revealed: false,
      clue2Revealed: false,
      answerRevealed: false,
      guessesRevealed: false,
      dealerIndex,
      betting: null,
      closestGuessRanking: undefined,
      players: resetHandPlayerState(state.players),
    }
  }

  if (action === 'adjust_chips' && event.playerId && event.chipsDelta !== undefined) {
    const p = state.players[event.playerId]
    if (!p) return state
    const chips = Math.max(0, p.chips + Math.floor(event.chipsDelta))
    return { ...state, players: { ...state.players, [event.playerId]: { ...p, chips } } }
  }

  if (action === 'set_guess' && event.playerId && event.guess !== undefined) {
    const p = state.players[event.playerId]
    if (!p) return state
    const g = Number(event.guess)
    if (!Number.isFinite(g)) return state
    return {
      ...state,
      players: {
        ...state.players,
        [event.playerId]: { ...p, guess: g, guessSubmitted: true },
      },
    }
  }

  if (action === 'force_phase' && event.phase) {
    return { ...state, phase: event.phase }
  }

  if (action === 'force_pot' && event.mainPot !== undefined && state.betting) {
    return {
      ...state,
      betting: { ...state.betting, mainPot: Math.max(0, Math.floor(event.mainPot)) },
    }
  }

  if (action === 'reset_hand') {
    return {
      ...state,
      phase: 'lobby',
      activeQuestionId: null,
      clue1Revealed: false,
      clue2Revealed: false,
      answerRevealed: false,
      guessesRevealed: false,
      betting: null,
      closestGuessRanking: undefined,
      players: resetHandPlayerState(state.players),
    }
  }

  return state
}

export function syncSeatOrder(state: QuizPokerState, contestantIds: string[]): QuizPokerState {
  let next = state
  for (const id of contestantIds) {
    next = ensurePlayer(next, id, true)
  }
  const seatOrder = contestantIds.filter((id) => next.players[id])
  return { ...next, seatOrder }
}

export function setWebcam(state: QuizPokerState, playerId: string, enabled: boolean): QuizPokerState {
  const p = state.players[playerId]
  if (!p) return state
  return { ...state, players: { ...state.players, [playerId]: { ...p, webcamEnabled: enabled } } }
}
