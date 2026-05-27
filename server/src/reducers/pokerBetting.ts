import type {
  BettingRoundState,
  QuizPokerPlayerState,
  QuizPokerPlayerAction,
  SidePot,
} from '../../../shared/protocol.js'

export const DEFAULT_STARTING_STACK = 1000
export const DEFAULT_SMALL_BLIND = 5
export const DEFAULT_BIG_BLIND = 10

export type LegalAction = QuizPokerPlayerAction

export function resetRoundBets(players: Record<string, QuizPokerPlayerState>): Record<string, QuizPokerPlayerState> {
  const next: Record<string, QuizPokerPlayerState> = {}
  for (const [id, p] of Object.entries(players)) {
    next[id] = { ...p, betThisRound: 0 }
  }
  return next
}

function nthActiveSeat(
  seatOrder: string[],
  players: Record<string, QuizPokerPlayerState>,
  from: number,
  n: number,
): number {
  const len = seatOrder.length
  let count = 0
  for (let step = 1; step <= len * 2; step++) {
    const idx = (from + step) % len
    const id = seatOrder[idx]!
    const p = players[id]
    if (!p || p.folded) continue
    if (p.chips === 0 && p.betThisRound === 0) continue
    count++
    if (count === n) return idx
  }
  return (from + 1) % len
}

export function createBettingRound(
  seatOrder: string[],
  dealerIndex: number,
  roundNumber: 1 | 2 | 3 | 4,
): BettingRoundState {
  return {
    subPhase: 'posting_blinds',
    roundNumber,
    seatOrder,
    dealerIndex,
    currentActorIndex: 0,
    currentBet: 0,
    minRaise: DEFAULT_BIG_BLIND,
    lastAggressorIndex: null,
    mainPot: 0,
    sidePots: [],
  }
}

export function postBlinds(
  players: Record<string, QuizPokerPlayerState>,
  betting: BettingRoundState,
  smallBlind: number,
  bigBlind: number,
): { players: Record<string, QuizPokerPlayerState>; betting: BettingRoundState } {
  if (betting.subPhase !== 'posting_blinds') {
    return { players, betting }
  }

  let nextPlayers = { ...players }
  const sbIdx = nthActiveSeat(betting.seatOrder, nextPlayers, betting.dealerIndex, 1)
  const bbIdx = nthActiveSeat(betting.seatOrder, nextPlayers, betting.dealerIndex, 2)

  const post = (playerId: string, amount: number) => {
    const p = nextPlayers[playerId]
    if (!p) return
    const pay = Math.min(amount, p.chips)
    nextPlayers[playerId] = {
      ...p,
      chips: p.chips - pay,
      betThisRound: p.betThisRound + pay,
      totalBetHand: p.totalBetHand + pay,
      allIn: p.chips - pay === 0 && pay > 0,
    }
  }

  post(betting.seatOrder[sbIdx]!, smallBlind)
  post(betting.seatOrder[bbIdx]!, bigBlind)

  const bbId = betting.seatOrder[bbIdx]!
  const currentBet = nextPlayers[bbId]?.betThisRound ?? bigBlind
  let firstActor = findNextActor(betting.seatOrder, nextPlayers, bbIdx, currentBet, betting.lastAggressorIndex)

  return {
    players: nextPlayers,
    betting: {
      ...betting,
      subPhase: 'action',
      currentBet,
      minRaise: bigBlind,
      currentActorIndex: firstActor ?? ((bbIdx + 1) % betting.seatOrder.length),
      lastAggressorIndex: bbIdx,
    },
  }
}

function findNextActor(
  seatOrder: string[],
  players: Record<string, QuizPokerPlayerState>,
  fromIndex: number,
  currentBet: number,
  lastAggressorIndex: number | null,
): number | null {
  const len = seatOrder.length
  for (let step = 1; step <= len; step++) {
    const idx = (fromIndex + step) % len
    const id = seatOrder[idx]!
    const p = players[id]
    if (!p || p.folded || p.allIn) continue
    if (p.betThisRound < currentBet) return idx
    if (p.chips > 0 && lastAggressorIndex !== null && idx !== lastAggressorIndex) {
      if (p.betThisRound >= currentBet) return idx
    }
  }
  return null
}

export function getLegalActions(
  players: Record<string, QuizPokerPlayerState>,
  betting: BettingRoundState,
  playerId: string,
): LegalAction[] {
  if (betting.subPhase !== 'action') return []
  const actorId = betting.seatOrder[betting.currentActorIndex]
  if (actorId !== playerId) return []

  const p = players[playerId]
  if (!p || p.folded || p.allIn) return []

  const toCall = betting.currentBet - p.betThisRound
  const actions: LegalAction[] = ['fold']

  if (toCall === 0) {
    actions.push('check')
  } else if (p.chips > 0) {
    actions.push('call')
  }

  if (p.chips > toCall) {
    if (toCall === 0) actions.push('bet')
    else actions.push('raise')
  }

  return actions
}

function commitChips(p: QuizPokerPlayerState, amount: number): QuizPokerPlayerState {
  const pay = Math.min(Math.max(0, amount), p.chips)
  const newBet = p.betThisRound + pay
  return {
    ...p,
    chips: p.chips - pay,
    betThisRound: newBet,
    totalBetHand: p.totalBetHand + pay,
    allIn: p.chips - pay === 0 && pay > 0,
  }
}

function countActivePlayers(players: Record<string, QuizPokerPlayerState>, seatOrder: string[]): number {
  return seatOrder.filter((id) => {
    const p = players[id]
    return p && !p.folded
  }).length
}

function bettingRoundComplete(
  players: Record<string, QuizPokerPlayerState>,
  betting: BettingRoundState,
): boolean {
  const active = countActivePlayers(players, betting.seatOrder)
  if (active <= 1) return true

  const needsAction = betting.seatOrder.filter((id) => {
    const p = players[id]
    if (!p || p.folded || p.allIn) return false
    return p.betThisRound < betting.currentBet || (p.chips > 0 && betting.lastAggressorIndex !== null)
  })

  if (needsAction.length === 0) return true

  const allMatched = betting.seatOrder.every((id) => {
    const p = players[id]
    if (!p || p.folded || p.allIn) return true
    return p.betThisRound >= betting.currentBet || p.chips === 0
  })

  if (!allMatched) return false

  const withChips = betting.seatOrder.filter((id) => {
    const p = players[id]
    return p && !p.folded && !p.allIn && p.chips > 0
  })

  if (withChips.length === 0) return true

  if (betting.lastAggressorIndex === null) return false
  const aggId = betting.seatOrder[betting.lastAggressorIndex]
  const onlyAggLeft =
    withChips.length === 1 && withChips[0] === aggId && players[aggId!]?.betThisRound === betting.currentBet

  return onlyAggLeft || withChips.every((id) => {
    const p = players[id]!
    return p.betThisRound >= betting.currentBet
  })
}

function advanceAfterAction(
  players: Record<string, QuizPokerPlayerState>,
  betting: BettingRoundState,
  actedIndex: number,
): BettingRoundState {
  if (bettingRoundComplete(players, betting)) {
    return { ...betting, subPhase: 'round_complete' }
  }

  const nextIdx = findNextActor(
    betting.seatOrder,
    players,
    actedIndex,
    betting.currentBet,
    betting.lastAggressorIndex,
  )

  if (nextIdx === null) {
    return { ...betting, subPhase: 'round_complete' }
  }

  return { ...betting, currentActorIndex: nextIdx }
}

export function applyBettingAction(
  players: Record<string, QuizPokerPlayerState>,
  betting: BettingRoundState,
  playerId: string,
  action: LegalAction,
  amount?: number,
  bigBlind: number = DEFAULT_BIG_BLIND,
): { players: Record<string, QuizPokerPlayerState>; betting: BettingRoundState } | null {
  if (betting.subPhase !== 'action') return null
  const legal = getLegalActions(players, betting, playerId)
  if (!legal.includes(action)) return null

  const idx = betting.currentActorIndex
  const p = players[playerId]
  if (!p) return null

  let nextPlayers = { ...players }
  let nextBetting = { ...betting }
  const toCall = betting.currentBet - p.betThisRound

  if (action === 'fold') {
    nextPlayers[playerId] = { ...p, folded: true }
  } else if (action === 'check') {
    if (toCall !== 0) return null
  } else if (action === 'call') {
    nextPlayers[playerId] = commitChips(p, toCall)
  } else if (action === 'bet') {
    const betAmt = Math.max(bigBlind, Math.floor(amount ?? bigBlind))
    const add = betAmt - p.betThisRound
    if (add <= 0 || add > p.chips) return null
    nextPlayers[playerId] = commitChips(p, add)
    const np = nextPlayers[playerId]!
    nextBetting = {
      ...nextBetting,
      currentBet: np.betThisRound,
      minRaise: bigBlind,
      lastAggressorIndex: idx,
    }
  } else if (action === 'raise') {
    const minTotal = betting.currentBet + betting.minRaise
    const targetTotal = Math.max(minTotal, Math.floor(amount ?? minTotal))
    const add = targetTotal - p.betThisRound
    if (add <= 0 || add > p.chips) {
      nextPlayers[playerId] = commitChips(p, p.chips)
    } else {
      nextPlayers[playerId] = commitChips(p, add)
    }
    const np = nextPlayers[playerId]!
    if (np.betThisRound > nextBetting.currentBet) {
      const raiseSize = np.betThisRound - nextBetting.currentBet
      nextBetting = {
        ...nextBetting,
        currentBet: np.betThisRound,
        minRaise: Math.max(nextBetting.minRaise, raiseSize),
        lastAggressorIndex: idx,
      }
    }
  }

  nextBetting = advanceAfterAction(nextPlayers, nextBetting, idx)
  return { players: nextPlayers, betting: nextBetting }
}

/** Move round bets into main pot and reset per-round bets */
export function collectBetsToPot(
  players: Record<string, QuizPokerPlayerState>,
  betting: BettingRoundState,
): { players: Record<string, QuizPokerPlayerState>; betting: BettingRoundState } {
  let potAdd = 0
  const nextPlayers = resetRoundBets(players)
  for (const id of betting.seatOrder) {
    const p = players[id]
    if (p) potAdd += p.betThisRound
  }
  return {
    players: nextPlayers,
    betting: {
      ...betting,
      subPhase: 'round_complete',
      mainPot: betting.mainPot + potAdd,
    },
  }
}

export function buildSidePots(
  seatOrder: string[],
  players: Record<string, QuizPokerPlayerState>,
  mainPot: number,
): { mainPot: number; sidePots: SidePot[] } {
  const contributions = seatOrder
    .map((id) => ({ id, total: players[id]?.totalBetHand ?? 0 }))
    .filter((x) => x.total > 0)
    .sort((a, b) => a.total - b.total)

  if (contributions.length === 0) {
    return { mainPot, sidePots: [] }
  }

  const pots: SidePot[] = []
  let prev = 0
  let remainingMain = mainPot

  for (let level = 0; level < contributions.length; level++) {
    const cap = contributions[level]!.total
    const layer = cap - prev
    if (layer <= 0) continue
    const eligible = contributions.filter((c) => c.total >= cap).map((c) => c.id)
    const amount = layer * eligible.length
    prev = cap
    if (level === contributions.length - 1) {
      remainingMain += amount
    } else {
      pots.push({ amount, eligiblePlayerIds: eligible })
    }
  }

  return { mainPot: remainingMain, sidePots: pots }
}

export function awardPotToWinners(
  players: Record<string, QuizPokerPlayerState>,
  winnerIds: string[],
  mainPot: number,
  sidePots: SidePot[],
): Record<string, QuizPokerPlayerState> {
  const next = { ...players }
  const addChips = (id: string, amt: number) => {
    const p = next[id]
    if (p) next[id] = { ...p, chips: p.chips + amt }
  }

  if (winnerIds.length === 0) return next

  const shareMain = Math.floor(mainPot / winnerIds.length)
  let mainRemainder = mainPot - shareMain * winnerIds.length
  for (const id of winnerIds) {
    addChips(id, shareMain)
  }
  if (mainRemainder > 0) {
    addChips(winnerIds[0]!, mainRemainder)
  }

  for (const pot of sidePots) {
    const eligibleWinners = winnerIds.filter((id) => pot.eligiblePlayerIds.includes(id))
    const recipients = eligibleWinners.length > 0 ? eligibleWinners : winnerIds
    const share = Math.floor(pot.amount / recipients.length)
    let rem = pot.amount - share * recipients.length
    for (const id of recipients) {
      addChips(id, share)
    }
    if (rem > 0) addChips(recipients[0]!, rem)
  }

  return next
}
