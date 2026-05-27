import type { QuizBuzzerState, QuizHostAction, QuizQuestion, QuizTypingResponse } from '../../../shared/protocol.js'

export function createQuizBuzzerState(): QuizBuzzerState {
  return {
    phase: 'idle',
    questions: [],
    questionIndex: 0,
    currentPrompt: null,
    currentAnswer: null,
    firstBuzz: null,
    buzzOrder: [],
    scores: {},
    typingResponses: [],
  }
}

/** One line per question; first `:` splits prompt (before) and answer (after). */
export function parseQuestionLines(text: string): QuizQuestion[] {
  const lines = text.split(/\r?\n/)
  const out: QuizQuestion[] = []
  for (const raw of lines) {
    const line = raw.trim()
    if (!line) continue
    const i = line.indexOf(':')
    if (i === -1) {
      out.push({ prompt: line, answer: '' })
    } else {
      out.push({
        prompt: line.slice(0, i).trim(),
        answer: line.slice(i + 1).trim(),
      })
    }
  }
  return out
}

export type QuizBuzzerEvent =
  | { kind: 'buzz'; playerId: string; atServerMs: number }
  | { kind: 'typing_submit'; playerId: string; text: string }
  | {
      kind: 'host'
      action: QuizHostAction
      questions?: QuizQuestion[]
      contestantIds?: string[]
      playerId?: string
      points?: number
      correctPlayerIds?: string[]
      /** Points per correct player (= contestant count at confirm time) */
      typingPointsPerCorrect?: number
    }

function openAtCurrentIndex(state: QuizBuzzerState): QuizBuzzerState {
  if (state.phase === 'typing_open') {
    return state
  }
  if (!state.questions.length || state.questionIndex >= state.questions.length) {
    return state
  }
  const q = state.questions[state.questionIndex]!
  return {
    ...state,
    phase: 'question_open',
    currentPrompt: q.prompt,
    currentAnswer: q.answer,
    firstBuzz: null,
    buzzOrder: [],
    typingResponses: [],
  }
}

export function reduceQuizBuzzer(state: QuizBuzzerState, event: QuizBuzzerEvent): QuizBuzzerState {
  if (event.kind === 'typing_submit') {
    if (state.phase !== 'typing_open') {
      return state
    }
    if (state.typingResponses.some((r) => r.playerId === event.playerId)) {
      return state
    }
    const text = event.text.trim().slice(0, 500)
    if (!text) {
      return state
    }
    const typingResponses: QuizTypingResponse[] = [...state.typingResponses, { playerId: event.playerId, text }]
    return { ...state, typingResponses }
  }

  if (event.kind === 'host') {
    const a = event.action

    if (a === 'set_questions') {
      const questions = event.questions ?? []
      return {
        ...state,
        questions,
        questionIndex: 0,
        phase: 'idle',
        currentPrompt: null,
        currentAnswer: null,
        firstBuzz: null,
        buzzOrder: [],
        scores: { ...state.scores },
        typingResponses: [],
      }
    }

    if (a === 'open_typing') {
      if (state.phase === 'question_open' || state.phase === 'judging') {
        return state
      }
      if (!state.questions.length || state.questionIndex >= state.questions.length) {
        return state
      }
      const prompt = state.questions[state.questionIndex]!.prompt.trim()
      if (!prompt) {
        return state
      }
      return {
        ...state,
        phase: 'typing_open',
        currentPrompt: prompt,
        currentAnswer: null,
        firstBuzz: null,
        buzzOrder: [],
        typingResponses: [],
      }
    }

    if (a === 'typing_confirm') {
      if (state.phase !== 'typing_open') {
        return state
      }
      const N = Math.max(0, Math.floor(event.typingPointsPerCorrect ?? 0))
      const scores = { ...state.scores }
      for (const id of event.correctPlayerIds ?? []) {
        scores[id] = (scores[id] ?? 0) + N
      }
      return {
        ...state,
        phase: 'idle',
        currentPrompt: null,
        currentAnswer: null,
        firstBuzz: null,
        buzzOrder: [],
        typingResponses: [],
        scores,
      }
    }

    if (a === 'open') {
      return openAtCurrentIndex(state)
    }

    if (a === 'next_question') {
      if (state.phase === 'typing_open' || state.phase === 'judging') {
        return state
      }
      const nextIndex = state.questionIndex + 1
      if (nextIndex >= state.questions.length) {
        return state
      }
      return {
        ...state,
        questionIndex: nextIndex,
        phase: 'idle',
        currentPrompt: null,
        currentAnswer: null,
        firstBuzz: null,
        buzzOrder: [],
        typingResponses: [],
      }
    }

    if (a === 'reset') {
      const cleared = { ...state, firstBuzz: null, buzzOrder: [] }
      if (state.phase === 'revealed') {
        return {
          ...cleared,
          phase: 'question_open',
          currentPrompt: state.currentPrompt,
          currentAnswer: state.currentAnswer,
        }
      }
      if (state.phase === 'judging' || state.phase === 'question_open') {
        return {
          ...cleared,
          phase: 'question_open',
          currentPrompt: state.currentPrompt,
          currentAnswer: state.currentAnswer,
        }
      }
      return state
    }

    if (a === 'reveal') {
      if (state.phase === 'typing_open') {
        return state
      }
      if (state.phase !== 'question_open' && state.phase !== 'judging') {
        return state
      }
      return { ...state, phase: 'revealed' }
    }

    if (a === 'verdict_correct') {
      if (state.phase !== 'judging' || !state.firstBuzz) {
        return state
      }
      const buzzer = state.firstBuzz.playerId
      /** N = number of contestants in the room at verdict time (plan). */
      const N = (event.contestantIds ?? []).length
      const scores = { ...state.scores }
      scores[buzzer] = (scores[buzzer] ?? 0) + N
      return {
        ...state,
        phase: 'idle',
        firstBuzz: null,
        buzzOrder: [],
        currentPrompt: null,
        currentAnswer: null,
        typingResponses: [],
        scores,
      }
    }

    if (a === 'verdict_wrong') {
      if (state.phase !== 'judging' || !state.firstBuzz) {
        return state
      }
      const buzzer = state.firstBuzz.playerId
      const scores = { ...state.scores }
      for (const id of event.contestantIds ?? []) {
        if (id !== buzzer) {
          scores[id] = (scores[id] ?? 0) + 1
        }
      }
      /** Re-open buzzers for the same question (wrong answer path). */
      return {
        ...state,
        phase: 'question_open',
        firstBuzz: null,
        buzzOrder: [],
        currentPrompt: state.currentPrompt,
        currentAnswer: state.currentAnswer,
        scores,
      }
    }

    if (a === 'set_score') {
      const pid = event.playerId
      if (!pid) return state
      const pts = Math.max(0, Math.floor(Number(event.points ?? 0)))
      return {
        ...state,
        scores: { ...state.scores, [pid]: pts },
      }
    }

    return state
  }

  if (state.phase !== 'question_open') {
    return state
  }

  if (state.buzzOrder.some((b) => b.playerId === event.playerId)) {
    return state
  }

  const nextOrder = [...state.buzzOrder, { playerId: event.playerId, atServerMs: event.atServerMs }]
  const firstBuzz =
    state.firstBuzz === null
      ? { playerId: event.playerId, atServerMs: event.atServerMs }
      : state.firstBuzz

  return {
    ...state,
    phase: 'judging',
    firstBuzz,
    buzzOrder: nextOrder,
  }
}
