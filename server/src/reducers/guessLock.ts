import type { GuessCell, GuessLockState } from '../../../shared/protocol.js'

const DEFAULT_ROWS = 3
const DEFAULT_COLS = 3

export function buildGuessGrid(rows: number, cols: number): GuessCell[] {
  const cells: GuessCell[] = []
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const label = `${String.fromCharCode(65 + c)}${r + 1}`
      cells.push({
        id: `r${r}c${c}`,
        label,
        lockedBy: null,
        guess: null,
      })
    }
  }
  return cells
}

export function createGuessLockState(
  rows: number = DEFAULT_ROWS,
  cols: number = DEFAULT_COLS,
): GuessLockState {
  const r = clampSize(rows)
  const c = clampSize(cols)
  return { rows: r, cols: c, cells: buildGuessGrid(r, c) }
}

function clampSize(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_ROWS
  return Math.min(12, Math.max(1, Math.floor(n)))
}

export type GuessLockEvent =
  | { kind: 'lock'; playerId: string; cellId: string; guess: string }
  | { kind: 'host'; action: 'unlock_all' | 'new_round' | 'resize'; rows?: number; cols?: number }

export function reduceGuessLock(state: GuessLockState, event: GuessLockEvent): GuessLockState {
  if (event.kind === 'host') {
    if (event.action === 'unlock_all') {
      return {
        ...state,
        cells: state.cells.map((cell) => ({
          ...cell,
          lockedBy: null,
          guess: null,
        })),
      }
    }
    if (event.action === 'new_round') {
      return {
        ...state,
        cells: buildGuessGrid(state.rows, state.cols),
      }
    }
    if (event.action === 'resize') {
      const rows = clampSize(event.rows ?? state.rows)
      const cols = clampSize(event.cols ?? state.cols)
      return { rows, cols, cells: buildGuessGrid(rows, cols) }
    }
    return state
  }

  const cell = state.cells.find((c) => c.id === event.cellId)
  if (!cell || cell.lockedBy !== null) {
    return state
  }

  const guess = event.guess.trim()
  if (!guess) {
    return state
  }

  return {
    ...state,
    cells: state.cells.map((c) => {
      if (c.id !== event.cellId) return c
      return {
        ...c,
        lockedBy: event.playerId,
        guess,
      }
    }),
  }
}
