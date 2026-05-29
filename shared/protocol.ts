/** Wire + domain types shared by client and server */

export type RoomType = 'quiz_buzzer' | 'guess_lock' | 'quiz_poker'

export interface QuizQuestion {
  prompt: string
  answer: string
}

/** idle: between rounds; question_open: buzzing; judging: first buzzer, host picks; revealed: optional show-answer; typing_open: free-text answers */
export type QuizPhase = 'idle' | 'question_open' | 'judging' | 'revealed' | 'typing_open'

export interface QuizTypingResponse {
  playerId: string
  text: string
}

export interface QuizBuzzerState {
  phase: QuizPhase
  questions: QuizQuestion[]
  questionIndex: number
  /** Shown to everyone while the round is live (from open / next / type-in) */
  currentPrompt: string | null
  /** Model answer for this index; UI hides from non-host until `revealed` (payload still visible to cheaters in MVP). */
  currentAnswer: string | null
  firstBuzz: { playerId: string; atServerMs: number } | null
  buzzOrder: { playerId: string; atServerMs: number }[]
  /** Contestants only (non-host); host id should not appear */
  scores: Record<string, number>
  /** During type-in rounds: submissions (latest per player, order preserved) */
  typingResponses: QuizTypingResponse[]
}

export interface GuessCell {
  id: string
  label: string
  lockedBy: string | null
  guess: string | null
}

export interface GuessLockState {
  rows: number
  cols: number
  cells: GuessCell[]
}

// --- Quizz Poker ---

export type QuizPokerPhase =
  | 'lobby'
  | 'select_question'
  | 'guessing'
  | 'betting_1'
  | 'clue_1'
  | 'betting_2'
  | 'clue_2'
  | 'betting_3'
  | 'answer_reveal'
  | 'betting_4'
  | 'showdown'
  | 'hand_complete'

export interface QuizPokerQuestion {
  id: string
  prompt: string
  answer: number
  clues: [string, string]
}

export interface QuizPokerPlayerState {
  playerId: string
  chips: number
  betThisRound: number
  totalBetHand: number
  folded: boolean
  allIn: boolean
  /** Server holds value; omitted from other players' snapshots until guessesRevealed */
  guess: number | null
  guessSubmitted: boolean
  webcamEnabled: boolean
}

export type BettingSubPhase = 'posting_blinds' | 'action' | 'round_complete'

export interface SidePot {
  amount: number
  eligiblePlayerIds: string[]
}

export interface BettingRoundState {
  subPhase: BettingSubPhase
  roundNumber: 1 | 2 | 3 | 4
  seatOrder: string[]
  dealerIndex: number
  currentActorIndex: number
  currentBet: number
  minRaise: number
  lastAggressorIndex: number | null
  /** Big blind seat index for round 1 (for closing action) */
  bigBlindSeatIndex?: number
  /** True until big blind has had their closing preflop action */
  bigBlindOptionPending?: boolean
  /** For zero-bet rounds: remaining players that must act before round can close */
  pendingChecks?: number
  /** Sum committed this hand (main + side pots building) */
  mainPot: number
  sidePots: SidePot[]
}

export interface ClosestGuessEntry {
  playerId: string
  guess: number
  distance: number
  tiedForClosest: boolean
}

export interface QuizPokerState {
  phase: QuizPokerPhase
  questionLibrary: QuizPokerQuestion[]
  activeQuestionId: string | null
  clue1Revealed: boolean
  clue2Revealed: boolean
  answerRevealed: boolean
  guessesRevealed: boolean
  /** Player ids whose guesses are manually revealed by host */
  revealedGuessPlayerIds: string[]
  seatOrder: string[]
  dealerIndex: number
  players: Record<string, QuizPokerPlayerState>
  betting: BettingRoundState | null
  smallBlind: number
  bigBlind: number
  /** Host-only in filtered snapshots */
  closestGuessRanking?: ClosestGuessEntry[]
  /** Actions the viewing player may take this turn */
  legalActions?: QuizPokerPlayerAction[]
}

export type QuizPokerPlayerAction =
  | 'submit_guess'
  | 'fold'
  | 'check'
  | 'call'
  | 'bet'
  | 'raise'

export interface QuizPokerActionPayload {
  action: QuizPokerPlayerAction
  amount?: number
  guess?: number
}

export type QuizPokerHostAction =
  | 'set_questions'
  | 'add_question'
  | 'remove_question'
  | 'select_question'
  | 'start_guessing'
  | 'start_betting'
  | 'end_betting_round'
  | 'reveal_clue_1'
  | 'reveal_clue_2'
  | 'reveal_answer'
  | 'reveal_guess'
  | 'reveal_guesses'
  | 'confirm_winner'
  | 'next_hand'
  | 'adjust_chips'
  | 'set_blinds'
  | 'set_guess'
  | 'force_phase'
  | 'force_pot'
  | 'reset_hand'

export interface QuizPokerHostPayload {
  hostSecret: string
  action: QuizPokerHostAction
  questionsText?: string
  questionId?: string
  playerIds?: string[]
  playerId?: string
  chipsDelta?: number
  bigBlind?: number
  guess?: number
  phase?: QuizPokerPhase
  mainPot?: number
}

export interface QuizPokerWebRtcSignal {
  toPlayerId: string
  signal: RTCSessionDescriptionInit | RTCIceCandidateInit
}

export interface Player {
  id: string
  name: string
  isHost: boolean
}

export type GameState = QuizBuzzerState | GuessLockState | QuizPokerState

export interface RoomSnapshot {
  roomId: string
  code: string
  type: RoomType
  players: Player[]
  state: GameState
  version: number
}

export interface CreateRoomPayload {
  type: RoomType
  hostName: string
}

export interface CreateRoomOk {
  roomId: string
  code: string
  hostSecret: string
  snapshot: RoomSnapshot
  /** Convenience for clients; same as the host entry inside snapshot.players */
  playerId: string
}

export interface JoinRoomPayload {
  code: string
  name: string
}

export interface JoinRoomOk {
  snapshot: RoomSnapshot
  playerId: string
}

export interface JoinRoomErr {
  error: string
}

export type QuizHostAction =
  | 'open'
  | 'reset'
  | 'reveal'
  | 'set_questions'
  | 'verdict_correct'
  | 'verdict_wrong'
  | 'next_question'
  | 'set_score'
  | 'open_typing'
  | 'typing_confirm'

export interface QuizHostPayload {
  hostSecret: string
  action: QuizHostAction
  /** For set_questions: newline-separated; first `:` splits prompt / answer */
  questionsText?: string
  /** For set_score */
  playerId?: string
  points?: number
  /** For typing_confirm: player ids whose submitted answer is correct */
  correctPlayerIds?: string[]
}

export interface GuessLockPayload {
  cellId: string
  guess: string
}

export type GuessHostAction = 'unlock_all' | 'new_round' | 'resize'

export interface GuessHostPayload {
  hostSecret: string
  action: GuessHostAction
  /** Required when action is resize */
  rows?: number
  cols?: number
}

export function isQuizState(type: RoomType, state: GameState): state is QuizBuzzerState {
  void state
  return type === 'quiz_buzzer'
}

export function isGuessState(type: RoomType, state: GameState): state is GuessLockState {
  void state
  return type === 'guess_lock'
}

export function isQuizPokerState(type: RoomType, state: GameState): state is QuizPokerState {
  void state
  return type === 'quiz_poker'
}
