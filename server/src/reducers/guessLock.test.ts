import { describe, expect, it } from 'vitest'
import { buildGuessGrid, createGuessLockState, reduceGuessLock } from './guessLock.js'

describe('reduceGuessLock', () => {
  it('locks a free cell', () => {
    let s = createGuessLockState(2, 2)
    const id = s.cells[0]!.id
    const next = reduceGuessLock(s, { kind: 'lock', playerId: 'p1', cellId: id, guess: 'cat' })
    expect(next.cells[0]?.lockedBy).toBe('p1')
    expect(next.cells[0]?.guess).toBe('cat')
  })

  it('does not overwrite locked cell', () => {
    let s = createGuessLockState(2, 2)
    const id = s.cells[0]!.id
    s = reduceGuessLock(s, { kind: 'lock', playerId: 'p1', cellId: id, guess: 'a' })
    const same = reduceGuessLock(s, { kind: 'lock', playerId: 'p2', cellId: id, guess: 'b' })
    expect(same).toBe(s)
  })

  it('builds labels', () => {
    const cells = buildGuessGrid(1, 3)
    expect(cells.map((c) => c.label)).toEqual(['A1', 'B1', 'C1'])
  })
})
