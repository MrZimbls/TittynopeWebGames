import { randomBytes } from 'node:crypto'
import type { Server, Socket } from 'socket.io'
import { v4 as uuid } from 'uuid'
import type {
  CreateRoomOk,
  GuessLockState,
  JoinRoomErr,
  JoinRoomOk,
  Player,
  QuizBuzzerState,
  QuizHostAction,
  QuizPokerHostAction,
  QuizPokerState,
  RoomSnapshot,
  RoomType,
} from '../../shared/protocol.js'
import { createGuessLockState } from './reducers/guessLock.js'
import { reduceGuessLock } from './reducers/guessLock.js'
import { createQuizBuzzerState, parseQuestionLines, reduceQuizBuzzer } from './reducers/quizBuzzer.js'
import {
  createQuizPokerState,
  filterQuizPokerForViewer,
  parseQuizPokerQuestions,
  reduceQuizPoker,
  setWebcam,
  syncSeatOrder,
} from './reducers/quizPoker.js'
import { createRateLimiter } from './rateLimit.js'

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const MAX_PLAYERS = 12
const CODE_LEN = 6
const ROOM_TTL_MS = 2 * 60 * 60 * 1000
const GC_INTERVAL_MS = 60 * 1000

function randomCode(): string {
  const bytes = randomBytes(CODE_LEN)
  let s = ''
  for (let i = 0; i < CODE_LEN; i++) {
    s += CODE_ALPHABET[bytes[i]! % CODE_ALPHABET.length]
  }
  return s
}

function randomSecret(): string {
  return randomBytes(24).toString('base64url')
}

type InternalPlayer = {
  id: string
  name: string
  isHost: boolean
  socketId: string
}

type InternalRoom = {
  id: string
  code: string
  type: RoomType
  hostSecret: string
  hostPlayerId: string
  players: Map<string, InternalPlayer>
  quiz: QuizBuzzerState | null
  guess: GuessLockState | null
  quizPoker: QuizPokerState | null
  version: number
  updatedAt: number
}

export class RoomManager {
  private rooms = new Map<string, InternalRoom>()
  private codeToId = new Map<string, string>()
  private gcTimer: ReturnType<typeof setInterval>
  private allowPlayerAction = createRateLimiter()

  constructor(private io: Server) {
    this.gcTimer = setInterval(() => this.gc(), GC_INTERVAL_MS)
    this.gcTimer.unref?.()
  }

  dispose(): void {
    clearInterval(this.gcTimer)
  }

  private gc(): void {
    const now = Date.now()
    for (const room of this.rooms.values()) {
      if (room.players.size === 0 && now - room.updatedAt > ROOM_TTL_MS) {
        this.deleteRoom(room.id)
      }
    }
  }

  private deleteRoom(roomId: string): void {
    const room = this.rooms.get(roomId)
    if (!room) return
    this.codeToId.delete(room.code)
    this.rooms.delete(roomId)
  }

  private bump(room: InternalRoom): void {
    room.version += 1
    room.updatedAt = Date.now()
  }

  private toSnapshot(room: InternalRoom, viewerPlayerId?: string): RoomSnapshot {
    const players: Player[] = [...room.players.values()].map((p) => ({
      id: p.id,
      name: p.name,
      isHost: p.isHost,
    }))
    let state =
      room.type === 'quiz_buzzer'
        ? (room.quiz ?? createQuizBuzzerState())
        : room.type === 'guess_lock'
          ? (room.guess ?? createGuessLockState())
          : (room.quizPoker ?? createQuizPokerState())

    if (room.type === 'quiz_poker' && viewerPlayerId) {
      const viewer = room.players.get(viewerPlayerId)
      state = filterQuizPokerForViewer(
        state as QuizPokerState,
        viewerPlayerId,
        Boolean(viewer?.isHost),
      )
    }

    return {
      roomId: room.id,
      code: room.code,
      type: room.type,
      players,
      state,
      version: room.version,
    }
  }

  private broadcastState(room: InternalRoom): void {
    if (room.type === 'quiz_poker') {
      for (const p of room.players.values()) {
        const snap = this.toSnapshot(room, p.id)
        const s = this.io.sockets.sockets.get(p.socketId)
        if (s) s.emit('room:state', snap)
      }
      return
    }
    this.io.to(room.code).emit('room:state', this.toSnapshot(room))
  }

  private contestantIds(room: InternalRoom): string[] {
    return [...room.players.values()].filter((p) => !p.isHost).map((p) => p.id)
  }

  private syncQuizPokerRoom(room: InternalRoom): void {
    if (!room.quizPoker) return
    room.quizPoker = syncSeatOrder(room.quizPoker, this.contestantIds(room))
  }

  attachSocket(socket: Socket): void {
    socket.on('room:create', (payload: { type: RoomType; hostName: string }, cb: (r: CreateRoomOk | JoinRoomErr) => void) => {
      const name = String(payload?.hostName ?? '').trim().slice(0, 32)
      if (!name) {
        cb({ error: 'Host name required' })
        return
      }
      if (
        payload?.type !== 'quiz_buzzer' &&
        payload?.type !== 'guess_lock' &&
        payload?.type !== 'quiz_poker'
      ) {
        cb({ error: 'Invalid room type' })
        return
      }

      let code = randomCode()
      let tries = 0
      while (this.codeToId.has(code) && tries++ < 20) {
        code = randomCode()
      }
      if (this.codeToId.has(code)) {
        cb({ error: 'Could not allocate room code' })
        return
      }

      const roomId = uuid()
      const hostPlayerId = uuid()
      const hostSecret = randomSecret()
      const quiz = payload.type === 'quiz_buzzer' ? createQuizBuzzerState() : null
      const guess = payload.type === 'guess_lock' ? createGuessLockState() : null
      const quizPoker = payload.type === 'quiz_poker' ? createQuizPokerState() : null

      const room: InternalRoom = {
        id: roomId,
        code,
        type: payload.type,
        hostSecret,
        hostPlayerId,
        players: new Map(),
        quiz,
        guess,
        quizPoker,
        version: 1,
        updatedAt: Date.now(),
      }

      room.players.set(hostPlayerId, {
        id: hostPlayerId,
        name,
        isHost: true,
        socketId: socket.id,
      })

      this.rooms.set(roomId, room)
      this.codeToId.set(code, roomId)

      socket.data.roomCode = code
      socket.data.playerId = hostPlayerId
      void socket.join(code)

      cb({
        roomId,
        code,
        hostSecret,
        playerId: hostPlayerId,
        snapshot: this.toSnapshot(room),
      })
      this.broadcastState(room)
    })

    socket.on('room:join', (payload: { code: string; name: string }, cb: (r: JoinRoomOk | JoinRoomErr) => void) => {
      const code = String(payload?.code ?? '')
        .trim()
        .toUpperCase()
        .slice(0, 8)
      const name = String(payload?.name ?? '').trim().slice(0, 32)
      if (!code || !name) {
        cb({ error: 'Code and name required' })
        return
      }

      const roomId = this.codeToId.get(code)
      if (!roomId) {
        cb({ error: 'Room not found' })
        return
      }
      const room = this.rooms.get(roomId)
      if (!room) {
        cb({ error: 'Room not found' })
        return
      }
      if (room.players.size >= MAX_PLAYERS) {
        cb({ error: 'Room is full' })
        return
      }

      const playerId = uuid()
      room.players.set(playerId, {
        id: playerId,
        name,
        isHost: false,
        socketId: socket.id,
      })
      if (room.type === 'quiz_buzzer' && room.quiz) {
        room.quiz.scores[playerId] = room.quiz.scores[playerId] ?? 0
      }
      if (room.type === 'quiz_poker' && room.quizPoker) {
        room.quizPoker = reduceQuizPoker(room.quizPoker, { kind: 'player_join', playerId })
        this.syncQuizPokerRoom(room)
      }
      this.bump(room)

      socket.data.roomCode = code
      socket.data.playerId = playerId
      void socket.join(code)

      cb({ snapshot: this.toSnapshot(room), playerId })
      this.broadcastState(room)
    })

    socket.on('room:leave', () => {
      this.leaveSocket(socket)
    })

    socket.on('quiz:buzz', () => {
      this.handleQuizBuzz(socket)
    })

    socket.on(
      'quiz:host',
      (payload: {
        hostSecret: string
        action: string
        questionsText?: string
        playerId?: string
        points?: number
        correctPlayerIds?: string[]
      }) => {
        this.handleQuizHost(socket, payload)
      },
    )

    socket.on('quiz:typing_submit', (payload: { text?: string }) => {
      this.handleQuizTypingSubmit(socket, payload)
    })

    socket.on('guess:lock', (payload: { cellId: string; guess: string }) => {
      this.handleGuessLock(socket, payload)
    })

    socket.on('guess:host', (payload: { hostSecret: string; action: string; rows?: number; cols?: number }) => {
      this.handleGuessHost(socket, payload)
    })

    socket.on(
      'quiz_poker:action',
      (payload: { action: string; amount?: number; guess?: number }) => {
        this.handleQuizPokerAction(socket, payload)
      },
    )

    socket.on(
      'quiz_poker:host',
      (payload: {
        hostSecret: string
        action: string
        questionsText?: string
        questionId?: string
        playerIds?: string[]
        playerId?: string
        chipsDelta?: number
        bigBlind?: number
        guess?: number
        phase?: string
        mainPot?: number
      }) => {
        this.handleQuizPokerHost(socket, payload)
      },
    )

    socket.on(
      'quiz_poker:webrtc_signal',
      (payload: { toPlayerId: string; signal: unknown }) => {
        this.handleQuizPokerWebRtc(socket, payload)
      },
    )

    socket.on(
      'quiz_poker:webcam',
      (payload: { enabled?: boolean }) => {
        this.handleQuizPokerWebcam(socket, payload)
      },
    )

    socket.on('disconnect', () => {
      this.leaveSocket(socket)
    })
  }

  private leaveSocket(socket: Socket): void {
    const code = socket.data.roomCode as string | undefined
    const playerId = socket.data.playerId as string | undefined
    if (!code || !playerId) return

    const roomId = this.codeToId.get(code)
    if (!roomId) return
    const room = this.rooms.get(roomId)
    if (!room) return

    const player = room.players.get(playerId)
    if (!player || player.socketId !== socket.id) {
      return
    }

    const wasHost = player.isHost
    room.players.delete(playerId)
    if (room.type === 'quiz_poker' && room.quizPoker) {
      const { [playerId]: _, ...rest } = room.quizPoker.players
      room.quizPoker.players = rest
      room.quizPoker.seatOrder = room.quizPoker.seatOrder.filter((id) => id !== playerId)
      this.syncQuizPokerRoom(room)
    }
    this.bump(room)
    void socket.leave(code)
    delete socket.data.roomCode
    delete socket.data.playerId

    if (wasHost || room.players.size === 0) {
      this.io.to(code).emit('room:closed', { reason: wasHost ? 'host_left' : 'empty' })
      for (const p of room.players.values()) {
        const s = this.io.sockets.sockets.get(p.socketId)
        if (s) {
          void s.leave(code)
          delete s.data.roomCode
          delete s.data.playerId
        }
      }
      this.deleteRoom(room.id)
      return
    }

    this.broadcastState(room)
  }

  private requireRoom(socket: Socket): { room: InternalRoom; playerId: string } | null {
    const code = socket.data.roomCode as string | undefined
    const playerId = socket.data.playerId as string | undefined
    if (!code || !playerId) return null
    const roomId = this.codeToId.get(code)
    if (!roomId) return null
    const room = this.rooms.get(roomId)
    if (!room) return null
    const p = room.players.get(playerId)
    if (!p || p.socketId !== socket.id) return null
    return { room, playerId }
  }

  private handleQuizBuzz(socket: Socket): void {
    if (!this.allowPlayerAction(socket.id)) {
      return
    }
    const ctx = this.requireRoom(socket)
    if (!ctx || ctx.room.type !== 'quiz_buzzer' || !ctx.room.quiz) return

    const player = ctx.room.players.get(ctx.playerId)
    if (player?.isHost) {
      return
    }

    const at = Date.now()
    const next = reduceQuizBuzzer(ctx.room.quiz, {
      kind: 'buzz',
      playerId: ctx.playerId,
      atServerMs: at,
    })
    if (next === ctx.room.quiz) return

    ctx.room.quiz = next
    this.bump(ctx.room)
    this.broadcastState(ctx.room)
  }

  private handleQuizHost(
    socket: Socket,
    payload: {
      hostSecret: string
      action: string
      questionsText?: string
      playerId?: string
      points?: number
      typingPrompt?: string
      correctPlayerIds?: string[]
    },
  ): void {
    const ctx = this.requireRoom(socket)
    if (!ctx || ctx.room.type !== 'quiz_buzzer' || !ctx.room.quiz) return
    const p = ctx.room.players.get(ctx.playerId)
    if (!p?.isHost) return
    if (payload?.hostSecret !== ctx.room.hostSecret) return

    const action = payload.action as QuizHostAction
    const allowed: QuizHostAction[] = [
      'open',
      'reset',
      'reveal',
      'set_questions',
      'verdict_correct',
      'verdict_wrong',
      'next_question',
      'set_score',
      'open_typing',
      'typing_confirm',
    ]
    if (!allowed.includes(action)) return

    const contestantIds = [...ctx.room.players.values()]
      .filter((pl) => !pl.isHost)
      .map((pl) => pl.id)

    let event: Parameters<typeof reduceQuizBuzzer>[1]

    if (action === 'set_questions') {
      const raw = String(payload.questionsText ?? '')
      if (raw.length > 50_000) {
        return
      }
      const parsed = parseQuestionLines(raw).slice(0, 200)
      event = { kind: 'host', action: 'set_questions', questions: parsed }
    } else if (action === 'verdict_correct' || action === 'verdict_wrong') {
      event = { kind: 'host', action, contestantIds }
    } else if (action === 'set_score') {
      const targetId = String(payload.playerId ?? '')
      const target = ctx.room.players.get(targetId)
      if (!target || target.isHost) {
        return
      }
      event = {
        kind: 'host',
        action: 'set_score',
        playerId: targetId,
        points: payload.points,
      }
    } else if (action === 'open_typing') {
      event = { kind: 'host', action: 'open_typing' }
    } else if (action === 'typing_confirm') {
      const raw = payload.correctPlayerIds
      const ids = Array.isArray(raw) ? raw.map((x) => String(x)) : []
      const submitted = new Set(
        ctx.room.quiz.typingResponses.filter((r) => r.text.trim().length > 0).map((r) => r.playerId),
      )
      for (const id of ids) {
        if (!contestantIds.includes(id) || !submitted.has(id)) {
          return
        }
      }
      event = {
        kind: 'host',
        action: 'typing_confirm',
        correctPlayerIds: ids,
        typingPointsPerCorrect: contestantIds.length,
      }
    } else {
      event = { kind: 'host', action }
    }

    const before = ctx.room.quiz
    const next = reduceQuizBuzzer(before, event)
    if (next === before) return

    ctx.room.quiz = next
    this.bump(ctx.room)
    this.broadcastState(ctx.room)

    if (action === 'verdict_wrong' && next.phase === 'question_open' && before.phase === 'judging') {
      this.io.to(ctx.room.code).emit('quiz:sound', { kind: 'wrong' })
    }
  }

  private handleQuizTypingSubmit(socket: Socket, payload: { text?: string }): void {
    if (!this.allowPlayerAction(socket.id)) {
      return
    }
    const ctx = this.requireRoom(socket)
    if (!ctx || ctx.room.type !== 'quiz_buzzer' || !ctx.room.quiz) return

    const player = ctx.room.players.get(ctx.playerId)
    if (player?.isHost) {
      return
    }

    const text = String(payload?.text ?? '')
    const next = reduceQuizBuzzer(ctx.room.quiz, {
      kind: 'typing_submit',
      playerId: ctx.playerId,
      text,
    })
    if (next === ctx.room.quiz) return

    ctx.room.quiz = next
    this.bump(ctx.room)
    this.broadcastState(ctx.room)
  }

  private handleGuessLock(socket: Socket, payload: { cellId: string; guess: string }): void {
    if (!this.allowPlayerAction(socket.id)) {
      return
    }
    const ctx = this.requireRoom(socket)
    if (!ctx || ctx.room.type !== 'guess_lock' || !ctx.room.guess) return

    const cellId = String(payload?.cellId ?? '')
    const guess = String(payload?.guess ?? '')
    const before = ctx.room.guess
    const next = reduceGuessLock(before, {
      kind: 'lock',
      playerId: ctx.playerId,
      cellId,
      guess,
    })
    if (next === before) return

    ctx.room.guess = next
    this.bump(ctx.room)
    this.broadcastState(ctx.room)
  }

  private handleGuessHost(
    socket: Socket,
    payload: { hostSecret: string; action: string; rows?: number; cols?: number },
  ): void {
    const ctx = this.requireRoom(socket)
    if (!ctx || ctx.room.type !== 'guess_lock' || !ctx.room.guess) return
    const p = ctx.room.players.get(ctx.playerId)
    if (!p?.isHost) return
    if (payload?.hostSecret !== ctx.room.hostSecret) return

    const action = payload.action
    if (action !== 'unlock_all' && action !== 'new_round' && action !== 'resize') return

    const next = reduceGuessLock(ctx.room.guess, {
      kind: 'host',
      action: action as 'unlock_all' | 'new_round' | 'resize',
      rows: payload.rows,
      cols: payload.cols,
    })
    ctx.room.guess = next
    this.bump(ctx.room)
    this.broadcastState(ctx.room)
  }

  private handleQuizPokerAction(
    socket: Socket,
    payload: { action: string; amount?: number; guess?: number },
  ): void {
    if (!this.allowPlayerAction(socket.id)) return
    const ctx = this.requireRoom(socket)
    if (!ctx || ctx.room.type !== 'quiz_poker' || !ctx.room.quizPoker) return

    const player = ctx.room.players.get(ctx.playerId)
    if (player?.isHost) return

    const action = payload.action
    const allowed = ['submit_guess', 'fold', 'check', 'call', 'bet', 'raise']
    if (!allowed.includes(action)) return

    const before = ctx.room.quizPoker
    const next = reduceQuizPoker(before, {
      kind: 'player_action',
      playerId: ctx.playerId,
      action: action as 'submit_guess' | 'fold' | 'check' | 'call' | 'bet' | 'raise',
      amount: payload.amount,
      guess: payload.guess,
    })
    if (next === before) return

    this.emitQuizPokerActionToast(ctx.room, before, next, ctx.playerId)

    ctx.room.quizPoker = next
    this.bump(ctx.room)
    this.broadcastState(ctx.room)
  }

  private emitQuizPokerActionToast(
    room: InternalRoom,
    before: QuizPokerState,
    next: QuizPokerState,
    actorId: string,
  ): void {
    if (!before.betting || !next.betting || before.betting.subPhase !== 'action') return
    const name = room.players.get(actorId)?.name ?? actorId
    const prevActor = before.players[actorId]
    const nextActor = next.players[actorId]
    if (!prevActor || !nextActor) return

    let text: string | null = null
    if (!prevActor.folded && nextActor.folded) {
      text = `${name} folded`
    } else {
      const putIn = Math.max(0, prevActor.chips - nextActor.chips)
      if (putIn > 0) {
        const toCall = Math.max(0, before.betting.currentBet - prevActor.betThisRound)
        const newCurrentBet = next.betting.currentBet
        if (newCurrentBet > before.betting.currentBet) {
          const verb = before.betting.currentBet === 0 ? 'bet' : 'raised to'
          text = `${name} ${verb} ${newCurrentBet}`
        } else if (toCall > 0) {
          text = `${name} called ${putIn}`
        } else {
          text = `${name} put in ${putIn}`
        }
      } else if (
        before.betting.currentBet === next.betting.currentBet &&
        prevActor.betThisRound === nextActor.betThisRound
      ) {
        text = `${name} checked`
      }
    }
    if (text) this.io.to(room.code).emit('quiz_poker:action_toast', { text })
  }

  private handleQuizPokerHost(
    socket: Socket,
    payload: {
      hostSecret: string
      action: string
      questionsText?: string
      questionId?: string
      playerIds?: string[]
      playerId?: string
      chipsDelta?: number
      bigBlind?: number
      guess?: number
      phase?: string
      mainPot?: number
    },
  ): void {
    const ctx = this.requireRoom(socket)
    if (!ctx || ctx.room.type !== 'quiz_poker' || !ctx.room.quizPoker) return
    const p = ctx.room.players.get(ctx.playerId)
    if (!p?.isHost) return
    if (payload?.hostSecret !== ctx.room.hostSecret) return

    const action = payload.action as QuizPokerHostAction
    const allowed: QuizPokerHostAction[] = [
      'set_questions',
      'add_question',
      'remove_question',
      'select_question',
      'start_guessing',
      'start_betting',
      'end_betting_round',
      'reveal_clue_1',
      'reveal_clue_2',
      'reveal_answer',
      'reveal_guess',
      'reveal_guesses',
      'confirm_winner',
      'next_hand',
      'adjust_chips',
      'set_blinds',
      'set_guess',
      'force_phase',
      'force_pot',
      'reset_hand',
    ]
    if (!allowed.includes(action)) return

    let event: Parameters<typeof reduceQuizPoker>[1]

    if (action === 'set_questions') {
      const raw = String(payload.questionsText ?? '')
      if (raw.length > 50_000) return
      event = { kind: 'host', action, questions: parseQuizPokerQuestions(raw) }
    } else if (action === 'add_question') {
      const raw = String(payload.questionsText ?? '').trim()
      if (!raw) return
      event = { kind: 'host', action, questions: parseQuizPokerQuestions(raw) }
    } else if (action === 'confirm_winner') {
      const ids = Array.isArray(payload.playerIds) ? payload.playerIds.map(String) : []
      if (!ids.length) return
      for (const id of ids) {
        if (!ctx.room.quizPoker.seatOrder.includes(id)) return
      }
      event = { kind: 'host', action, playerIds: ids }
    } else if (action === 'adjust_chips') {
      const targetId = String(payload.playerId ?? '')
      if (!ctx.room.quizPoker.players[targetId]) return
      event = {
        kind: 'host',
        action,
        playerId: targetId,
        chipsDelta: payload.chipsDelta,
      }
    } else if (action === 'set_blinds') {
      const bb = Number(payload.bigBlind)
      if (!Number.isFinite(bb)) return
      event = {
        kind: 'host',
        action,
        bigBlind: bb,
      }
    } else if (action === 'set_guess') {
      const targetId = String(payload.playerId ?? '')
      if (!ctx.room.quizPoker.players[targetId]) return
      event = {
        kind: 'host',
        action,
        playerId: targetId,
        guess: payload.guess,
      }
    } else if (action === 'force_phase') {
      const phase = payload.phase as QuizPokerState['phase']
      if (!phase) return
      event = { kind: 'host', action, phase }
    } else if (action === 'force_pot') {
      event = { kind: 'host', action, mainPot: payload.mainPot }
    } else {
      event = {
        kind: 'host',
        action,
        questionId: payload.questionId,
        playerId: payload.playerId,
      }
    }

    const before = ctx.room.quizPoker
    const next = reduceQuizPoker(before, event)
    if (next === before) return

    ctx.room.quizPoker = next
    this.syncQuizPokerRoom(ctx.room)
    this.bump(ctx.room)
    this.broadcastState(ctx.room)
  }

  private handleQuizPokerWebRtc(
    socket: Socket,
    payload: { toPlayerId: string; signal: unknown },
  ): void {
    const ctx = this.requireRoom(socket)
    if (!ctx || ctx.room.type !== 'quiz_poker') return

    const toId = String(payload?.toPlayerId ?? '')
    const target = ctx.room.players.get(toId)
    if (!target) return

    const from = ctx.room.players.get(ctx.playerId)
    if (!from) return

    const targetSocket = this.io.sockets.sockets.get(target.socketId)
    if (targetSocket) {
      targetSocket.emit('quiz_poker:webrtc_signal', {
        fromPlayerId: ctx.playerId,
        signal: payload.signal,
      })
    }
  }

  private handleQuizPokerWebcam(socket: Socket, payload: { enabled?: boolean }): void {
    if (!this.allowPlayerAction(socket.id)) return
    const ctx = this.requireRoom(socket)
    if (!ctx || ctx.room.type !== 'quiz_poker' || !ctx.room.quizPoker) return

    const before = ctx.room.quizPoker
    const next = setWebcam(before, ctx.playerId, Boolean(payload?.enabled))
    if (next === before) return

    ctx.room.quizPoker = next
    this.bump(ctx.room)
    this.broadcastState(ctx.room)
  }
}
