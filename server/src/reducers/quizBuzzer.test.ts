import { describe, expect, it } from 'vitest'
import {
  createQuizBuzzerState,
  parseQuestionLines,
  reduceQuizBuzzer,
} from './quizBuzzer.js'

describe('parseQuestionLines', () => {
  it('splits on first colon only', () => {
    expect(parseQuestionLines('What is 2+2?:4')).toEqual([{ prompt: 'What is 2+2?', answer: '4' }])
  })

  it('handles no colon as prompt only', () => {
    expect(parseQuestionLines('No answer here')).toEqual([{ prompt: 'No answer here', answer: '' }])
  })

  it('skips empty lines and trims', () => {
    expect(parseQuestionLines('  A:1  \n\nB:2')).toEqual([
      { prompt: 'A', answer: '1' },
      { prompt: 'B', answer: '2' },
    ])
  })
})

describe('reduceQuizBuzzer', () => {
  it('opens question and moves to judging on buzz', () => {
    let s = createQuizBuzzerState()
    s = reduceQuizBuzzer(s, {
      kind: 'host',
      action: 'set_questions',
      questions: [{ prompt: 'Q1', answer: 'A1' }],
    })
    s = reduceQuizBuzzer(s, { kind: 'host', action: 'open' })
    expect(s.phase).toBe('question_open')
    expect(s.currentPrompt).toBe('Q1')
    s = reduceQuizBuzzer(s, { kind: 'buzz', playerId: 'p1', atServerMs: 1 })
    expect(s.phase).toBe('judging')
    expect(s.firstBuzz?.playerId).toBe('p1')
  })

  it('ignores duplicate buzz from same player', () => {
    let s = createQuizBuzzerState()
    s = reduceQuizBuzzer(s, {
      kind: 'host',
      action: 'set_questions',
      questions: [{ prompt: 'Q', answer: 'A' }],
    })
    s = reduceQuizBuzzer(s, { kind: 'host', action: 'open' })
    s = reduceQuizBuzzer(s, { kind: 'buzz', playerId: 'p1', atServerMs: 1 })
    const again = reduceQuizBuzzer(s, { kind: 'buzz', playerId: 'p1', atServerMs: 2 })
    expect(again).toBe(s)
  })

  it('verdict_correct adds N points for N contestants', () => {
    let s = createQuizBuzzerState()
    s = reduceQuizBuzzer(s, {
      kind: 'host',
      action: 'set_questions',
      questions: [{ prompt: 'Q', answer: 'A' }],
    })
    s = reduceQuizBuzzer(s, { kind: 'host', action: 'open' })
    s = reduceQuizBuzzer(s, { kind: 'buzz', playerId: 'buzzer', atServerMs: 1 })
    s = reduceQuizBuzzer(s, {
      kind: 'host',
      action: 'verdict_correct',
      contestantIds: ['a', 'b', 'buzzer'],
    })
    expect(s.phase).toBe('idle')
    expect(s.scores['buzzer']).toBe(3)
  })

  it('verdict_wrong gives +1 to others and reopens buzzers', () => {
    let s = createQuizBuzzerState()
    s = reduceQuizBuzzer(s, {
      kind: 'host',
      action: 'set_questions',
      questions: [{ prompt: 'Q', answer: 'A' }],
    })
    s = reduceQuizBuzzer(s, { kind: 'host', action: 'open' })
    s = reduceQuizBuzzer(s, { kind: 'buzz', playerId: 'first', atServerMs: 1 })
    s = reduceQuizBuzzer(s, {
      kind: 'host',
      action: 'verdict_wrong',
      contestantIds: ['first', 'p2', 'p3'],
    })
    expect(s.phase).toBe('question_open')
    expect(s.currentPrompt).toBe('Q')
    expect(s.firstBuzz).toBeNull()
    expect(s.scores['p2']).toBe(1)
    expect(s.scores['p3']).toBe(1)
  })

  it('typing round: submit and confirm scores', () => {
    let s = createQuizBuzzerState()
    s = reduceQuizBuzzer(s, {
      kind: 'host',
      action: 'set_questions',
      questions: [
        { prompt: 'Name a color', answer: 'blue' },
      ],
    })
    s = reduceQuizBuzzer(s, {
      kind: 'host',
      action: 'open_typing',
    })
    expect(s.phase).toBe('typing_open')
    expect(s.currentPrompt).toBe('Name a color')
    s = reduceQuizBuzzer(s, { kind: 'typing_submit', playerId: 'p1', text: 'red' })
    s = reduceQuizBuzzer(s, { kind: 'typing_submit', playerId: 'p2', text: 'blue' })
    s = reduceQuizBuzzer(s, {
      kind: 'host',
      action: 'typing_confirm',
      correctPlayerIds: ['p1'],
      typingPointsPerCorrect: 3,
    })
    expect(s.phase).toBe('idle')
    expect(s.scores['p1']).toBe(3)
    expect(s.scores['p2']).toBeUndefined()
  })

  it('typing_submit ignores second submit from same player', () => {
    let s = createQuizBuzzerState()
    s = reduceQuizBuzzer(s, {
      kind: 'host',
      action: 'set_questions',
      questions: [{ prompt: 'Q', answer: 'A' }],
    })
    s = reduceQuizBuzzer(s, { kind: 'host', action: 'open_typing' })
    s = reduceQuizBuzzer(s, { kind: 'typing_submit', playerId: 'p1', text: 'first' })
    const again = reduceQuizBuzzer(s, { kind: 'typing_submit', playerId: 'p1', text: 'second' })
    expect(again).toBe(s)
    expect(s.typingResponses).toEqual([{ playerId: 'p1', text: 'first' }])
  })

  it('open_typing does nothing without saved questions', () => {
    let s = createQuizBuzzerState()
    s = reduceQuizBuzzer(s, { kind: 'host', action: 'open_typing' })
    expect(s.phase).toBe('idle')
  })

  it('next_question advances slot without opening to players', () => {
    let s = createQuizBuzzerState()
    s = reduceQuizBuzzer(s, {
      kind: 'host',
      action: 'set_questions',
      questions: [
        { prompt: 'Q1', answer: 'A1' },
        { prompt: 'Q2', answer: 'A2' },
      ],
    })
    s = reduceQuizBuzzer(s, { kind: 'host', action: 'open' })
    expect(s.currentPrompt).toBe('Q1')
    expect(s.phase).toBe('question_open')
    s = reduceQuizBuzzer(s, { kind: 'host', action: 'next_question' })
    expect(s.questionIndex).toBe(1)
    expect(s.phase).toBe('idle')
    expect(s.currentPrompt).toBeNull()
    s = reduceQuizBuzzer(s, { kind: 'host', action: 'open' })
    expect(s.currentPrompt).toBe('Q2')
  })

  it('set_score clamps negative to zero', () => {
    let s = createQuizBuzzerState()
    s = reduceQuizBuzzer(s, {
      kind: 'host',
      action: 'set_score',
      playerId: 'p1',
      points: -5,
    })
    expect(s.scores['p1']).toBe(0)
  })
})
