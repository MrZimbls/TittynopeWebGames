<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, toRef } from 'vue'
import type {
  QuizPokerHostAction,
  QuizPokerPhase,
  QuizPokerState,
  RoomSnapshot,
} from '../../../shared/protocol'
import { isQuizPokerState } from '../../../shared/protocol'
import { getSocket } from '../socket'
import { useQuizPokerWebcam } from '../composables/useQuizPokerWebcam'
import chipIconSrc from '../assets/chip-icon.svg'

const props = defineProps<{
  snapshot: RoomSnapshot
  playerId: string
  isHost: boolean
  hostSecret: string
}>()

const socket = getSocket()
const snapshotRef = toRef(props, 'snapshot')
const playerIdRef = toRef(props, 'playerId')

const poker = computed(() =>
  isQuizPokerState(props.snapshot.type, props.snapshot.state)
    ? (props.snapshot.state as QuizPokerState)
    : null,
)

const hostPlayer = computed(() => props.snapshot.players.find((p) => p.isHost) ?? null)
const playerName = (id: string) => props.snapshot.players.find((p) => p.id === id)?.name ?? id

const initials = (name: string) =>
  name
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase() || '?'

const activeQuestion = computed(() => {
  const st = poker.value
  if (!st?.activeQuestionId) return null
  return st.questionLibrary.find((q) => q.id === st.activeQuestionId) ?? null
})

const phaseLabel: Record<QuizPokerPhase, string> = {
  lobby: 'Lobby',
  select_question: 'Select question',
  guessing: 'Submit guesses',
  betting_1: 'Betting round 1',
  clue_1: 'Clue 1',
  betting_2: 'Betting round 2',
  clue_2: 'Clue 2',
  betting_3: 'Betting round 3',
  answer_reveal: 'Answer revealed',
  betting_4: 'Final betting',
  showdown: 'Showdown',
  hand_complete: 'Hand complete',
}

/** Seats around the table; local user anchored at bottom (180°). */
const ringSeats = computed(() => {
  const order = poker.value?.seatOrder ?? []
  const st = poker.value
  if (!st) return []

  const hostId = hostPlayer.value?.id ?? ''
  // Never place host in the table ring; host is shown via top-left badge only.
  const seatIds = order
  const n = seatIds.length
  if (n === 0) return []

  const myIdx = seatIds.indexOf(props.playerId)
  const base = myIdx >= 0 ? myIdx : 0
  return seatIds.map((id, i) => {
    const rel = (i - base + n) % n
    const deg = 180 + (rel / n) * 360
    const ps = st.players[id]
    const isHostSeat = id === hostId
    return {
      id,
      deg,
      name: playerName(id),
      isMe: id === props.playerId,
      isHostSeat,
      chips: ps?.chips ?? 0,
      bet: ps?.betThisRound ?? 0,
      folded: ps?.folded ?? false,
      allIn: ps?.allIn ?? false,
      blindTag: id === blindSeats.value.sb ? 'SB' : id === blindSeats.value.bb ? 'BB' : null,
      guessSubmitted: ps?.guessSubmitted ?? false,
      guess: ps?.guess,
      isActor:
        st.betting?.subPhase === 'action' &&
        st.betting.seatOrder[st.betting.currentActorIndex] === id,
      webcamEnabled: ps?.webcamEnabled ?? false,
    }
  })
})

const questionsDraft = ref('')
const guessDraft = ref('')
const betAmount = ref(20)
const bigBlindDraft = ref(20)
const selectedWinners = ref<string[]>([])
const editChipPlayerId = ref<string | null>(null)
const editChipValue = ref('')
const editGuessPlayerId = ref<string | null>(null)
const editGuessValue = ref('')
const hostControlsOpen = ref(props.isHost)

const { webcamOn, toggleWebcam, registerSeatVideo, hasVideo } = useQuizPokerWebcam(
  snapshotRef,
  playerIdRef,
)

const actionToast = ref<{ id: number; text: string } | null>(null)
let actionToastTimer: number | null = null
let actionToastSeq = 0

function showActionToast(text: string) {
  actionToastSeq += 1
  actionToast.value = { id: actionToastSeq, text }
  if (actionToastTimer !== null) {
    window.clearTimeout(actionToastTimer)
  }
  actionToastTimer = window.setTimeout(() => {
    actionToast.value = null
  }, 1700)
}

function onActionToast(payload: { text: string }) {
  showActionToast(payload.text)
}

onMounted(() => {
  socket.on('quiz_poker:action_toast', onActionToast)
})

onUnmounted(() => {
  socket.off('quiz_poker:action_toast', onActionToast)
})

function host(action: QuizPokerHostAction, extra: Record<string, unknown> = {}) {
  if (!props.hostSecret) return
  socket.emit('quiz_poker:host', { hostSecret: props.hostSecret, action, ...extra })
}

function playerAction(action: string, extra: Record<string, unknown> = {}) {
  socket.emit('quiz_poker:action', { action, ...extra })
}

const mySeat = computed(() => poker.value?.players[props.playerId])

const isMyTurn = computed(() => {
  const st = poker.value
  if (!st?.betting || st.betting.subPhase !== 'action') return false
  return st.betting.seatOrder[st.betting.currentActorIndex] === props.playerId
})

const potTotal = computed(() => {
  const st = poker.value
  if (!st) return 0
  return st.seatOrder.reduce((sum, id) => sum + (st.players[id]?.totalBetHand ?? 0), 0)
})

const showCenterPot = computed(() => {
  const st = poker.value
  if (!st || potTotal.value <= 0) return false
  const phasesWithPot = new Set([
    'betting_1',
    'betting_2',
    'betting_3',
    'betting_4',
    'clue_1',
    'clue_2',
    'answer_reveal',
    'showdown',
    'hand_complete',
  ])
  return phasesWithPot.has(st.phase)
})

const allGuessesIn = computed(() => {
  const st = poker.value
  if (!st) return false
  return st.seatOrder.every((id) => st.players[id]?.guessSubmitted)
})

const tiedClosestCount = computed(() => {
  const ranking = poker.value?.closestGuessRanking
  if (!ranking?.length) return 0
  const minDist = Math.min(...ranking.map((r) => r.distance))
  return ranking.filter((r) => r.distance === minDist).length
})

const hostContinuePrompt = computed(() => {
  const st = poker.value
  if (!st?.betting || st.betting.subPhase !== 'round_complete') {
    return null
  }
  const round = st.betting.roundNumber
  if (round === 1) {
    return { title: 'Betting round 1 complete', next: 'Reveal clue 1 and continue' }
  }
  if (round === 2) {
    return { title: 'Betting round 2 complete', next: 'Reveal clue 2 and continue' }
  }
  if (round === 3) {
    return { title: 'Betting round 3 complete', next: 'Reveal answer and continue' }
  }
  return { title: 'Final betting complete', next: 'Continue to showdown' }
})

const blindSeats = computed(() => {
  const st = poker.value
  if (!st || st.seatOrder.length < 2) {
    return { sb: null as string | null, bb: null as string | null }
  }

  const activeOrder = st.seatOrder.filter((id) => {
    const p = st.players[id]
    return Boolean(p && (p.chips > 0 || p.betThisRound > 0))
  })
  const order = activeOrder.length >= 2 ? activeOrder : st.seatOrder
  const dealerId = st.seatOrder[st.dealerIndex] ?? order[0]
  const base = Math.max(0, order.indexOf(dealerId))
  const sb = order[(base + 1) % order.length] ?? null
  const bb = order[(base + 2) % order.length] ?? null
  return { sb, bb }
})

const actionButtons: Array<'fold' | 'check' | 'call' | 'bet' | 'raise'> = [
  'fold',
  'check',
  'call',
  'bet',
  'raise',
]

function canUseAction(act: 'fold' | 'check' | 'call' | 'bet' | 'raise') {
  return Boolean(isMyTurn.value && poker.value?.legalActions?.includes(act))
}

const showGuess = (id: string) => {
  const st = poker.value
  if (!st) return false
  return (
    st.guessesRevealed ||
    st.revealedGuessPlayerIds.includes(id) ||
    id === props.playerId ||
    props.isHost ||
    st.phase === 'showdown' ||
    st.phase === 'hand_complete'
  )
}

function saveQuestions() {
  host('set_questions', { questionsText: questionsDraft.value })
}

function toggleWinner(id: string) {
  const set = new Set(selectedWinners.value)
  if (set.has(id)) set.delete(id)
  else set.add(id)
  selectedWinners.value = [...set]
}

function confirmWinners() {
  if (!selectedWinners.value.length) return
  host('confirm_winner', { playerIds: selectedWinners.value })
  selectedWinners.value = []
}

function openChipEditor(id: string) {
  const current = poker.value?.players[id]?.chips ?? 0
  editChipPlayerId.value = id
  editChipValue.value = String(current)
}

function saveChipEditor(id: string) {
  const current = poker.value?.players[id]?.chips ?? 0
  const next = Math.max(0, Math.floor(Number(editChipValue.value)))
  if (!Number.isFinite(next)) return
  const delta = next - current
  if (delta !== 0) {
    host('adjust_chips', { playerId: id, chipsDelta: delta })
  }
  editChipPlayerId.value = null
  editChipValue.value = ''
}

function openGuessEditor(id: string) {
  const current = poker.value?.players[id]?.guess
  editGuessPlayerId.value = id
  editGuessValue.value = current === null || current === undefined ? '' : String(current)
}

function saveGuessEditor(id: string) {
  const next = Number(editGuessValue.value)
  if (!Number.isFinite(next)) return
  host('set_guess', { playerId: id, guess: next })
  editGuessPlayerId.value = null
  editGuessValue.value = ''
}

function revealGuess(playerId: string) {
  host('reveal_guess', { playerId })
}

function setBlinds() {
  const bb = Math.max(2, Math.floor(Number(bigBlindDraft.value)))
  host('set_blinds', { bigBlind: bb })
  bigBlindDraft.value = bb
}

function seatStyle(deg: number) {
  const rad = (deg * Math.PI) / 180
  const rx = 42
  const ry = 33
  const x = 50 + Math.cos(rad) * rx
  const y = 50 + Math.sin(rad) * ry
  return {
    left: `${x}%`,
    top: `${y}%`,
  }
}
</script>

<template>
  <div v-if="poker" class="qp">
    <!-- Round table overlay -->
    <div class="table-stage">
      <div class="top-right-stack">
        <div v-if="isHost" class="host-game-state">
          <span class="host-game-state-label">Game state</span>
          <span class="hub-phase">{{ phaseLabel[poker.phase] }}</span>
          <span v-if="poker.betting" class="host-game-state-meta">
            Betting round {{ poker.betting.roundNumber }}
            <template v-if="poker.betting.subPhase === 'round_complete'"> · ready to continue</template>
          </span>
          <span v-if="hostContinuePrompt" class="host-game-state-hint">
            {{ hostContinuePrompt.title }} → {{ hostContinuePrompt.next }}
          </span>
        </div>
        <button type="button" class="cam-btn" @click="toggleWebcam">
          {{ webcamOn ? 'Camera off' : 'Camera on' }}
        </button>
      </div>

      <div v-if="hostPlayer" class="leader-badge">
        <div class="leader-dot">{{ initials(hostPlayer.name) }}</div>
        <div class="leader-text">
          <strong>{{ isHost ? 'You' : hostPlayer.name }}</strong>
          <span>Game leader</span>
        </div>
      </div>

      <div class="table-felt">
        <div class="table-rail" aria-hidden="true" />

        <!-- Players around the ring -->
        <div
          v-for="seat in ringSeats"
          :key="seat.id"
          class="table-seat"
          :class="{
            'is-me': seat.isMe,
            'is-actor': seat.isActor,
            folded: seat.folded,
          }"
          :style="seatStyle(seat.deg)"
        >
          <div class="seat-card">
            <div class="seat-video-wrap">
              <video
                :ref="(el) => registerSeatVideo(seat.id, el as HTMLVideoElement | null)"
                autoplay
                playsinline
                :muted="seat.isMe"
                class="seat-video"
              />
              <div v-if="!hasVideo(seat.id)" class="seat-avatar">
                {{ initials(seat.name) }}
              </div>
              <span v-if="seat.isActor && seat.isMe" class="seat-turn">Your turn</span>
              <span v-else-if="seat.isActor" class="seat-turn acting">Acting</span>
            </div>
            <span v-if="seat.blindTag" class="blind-pill" :class="{ bb: seat.blindTag === 'BB' }">
              {{ seat.blindTag }}
            </span>
            <div class="seat-meta">
              <span class="seat-name">
                {{ seat.isMe ? 'You' : seat.name }}<template v-if="seat.isHostSeat && !seat.isMe"> (Host)</template>
              </span>
              <span class="seat-chips-row">
                <span class="seat-chips">
                  <img :src="chipIconSrc" alt="" class="chip-icon" />
                  {{ seat.chips }}
                </span>
                <button
                  v-if="isHost"
                  type="button"
                  class="inline-tool-btn"
                  title="Edit chips"
                  @click="openChipEditor(seat.id)"
                >
                  🔧
                </button>
              </span>
              <div v-if="isHost && editChipPlayerId === seat.id" class="inline-editor">
                <input v-model.number="editChipValue" type="number" min="0" />
                <button type="button" class="ghost sm" @click="saveChipEditor(seat.id)">Save</button>
                <button type="button" class="ghost sm" @click="editChipPlayerId = null">Cancel</button>
              </div>
              <span v-if="seat.folded" class="seat-tag">Fold</span>
              <span v-if="seat.allIn" class="seat-tag">All-in</span>
              <span v-if="seat.guess !== null && showGuess(seat.id)" class="seat-guess-row">
                <span class="seat-guess guess-pill">Guess {{ seat.guess }}</span>
                <button
                  v-if="isHost"
                  type="button"
                  class="inline-tool-btn"
                  title="Edit guess"
                  @click="openGuessEditor(seat.id)"
                >
                  🔧
                </button>
                <button
                  v-if="isHost && !poker.guessesRevealed"
                  type="button"
                  class="inline-tool-btn"
                  title="Reveal this guess"
                  @click="revealGuess(seat.id)"
                >
                  👁
                </button>
              </span>
              <span v-else-if="seat.guessSubmitted" class="seat-guess-row">
                <span class="seat-guess guess-pill dim">Guess locked</span>
                <button
                  v-if="isHost && !poker.guessesRevealed"
                  type="button"
                  class="inline-tool-btn"
                  title="Reveal this guess"
                  @click="revealGuess(seat.id)"
                >
                  👁
                </button>
              </span>
              <div v-if="isHost && editGuessPlayerId === seat.id" class="inline-editor">
                <input v-model.number="editGuessValue" type="number" />
                <button type="button" class="ghost sm" @click="saveGuessEditor(seat.id)">Save</button>
                <button type="button" class="ghost sm" @click="editGuessPlayerId = null">Cancel</button>
              </div>
            </div>
          </div>
        </div>

        <!-- Center hub: question + clues -->
        <div class="table-hub">
          <div class="hub-content">
            <p v-if="!activeQuestion" class="hub-waiting">Waiting for a question…</p>
            <template v-else>
              <h2 class="hub-question">{{ activeQuestion.prompt }}</h2>
              <p v-if="poker.clue1Revealed" class="hub-clue">
                <span class="clue-badge">Clue 1</span>
                {{ activeQuestion.clues[0] }}
              </p>
              <p v-if="poker.clue2Revealed" class="hub-clue">
                <span class="clue-badge">Clue 2</span>
                {{ activeQuestion.clues[1] }}
              </p>
              <p v-if="poker.answerRevealed && activeQuestion.answer" class="hub-answer">
                Answer: <strong>{{ activeQuestion.answer }}</strong>
              </p>
            </template>
          </div>

          <div v-if="showCenterPot" class="center-pot-display">
            <span class="center-pot-label">Pot</span>
            <span class="center-pot-value">{{ potTotal }}</span>
          </div>
        </div>

        <Transition name="action-toast-fade">
          <div v-if="actionToast" :key="actionToast.id" class="action-toast">
            {{ actionToast.text }}
          </div>
        </Transition>
      </div>

      <div class="table-bar">
        <template v-if="!isHost && poker.betting">
          <span class="turn-pill" :class="{ waiting: !isMyTurn }">
            {{ isMyTurn ? 'Your action' : 'Waiting...' }}
          </span>
          <template v-for="act in actionButtons" :key="`bar-${act}`">
            <button
              v-if="act !== 'bet' && act !== 'raise'"
              type="button"
              class="table-action-btn"
              :disabled="!canUseAction(act)"
              @click="canUseAction(act) ? playerAction(act) : null"
            >
              {{ act }}
            </button>
          </template>

          <div class="betting-pill" :class="{ disabled: !isMyTurn }">
            <button
              type="button"
              class="table-action-btn betting"
              :disabled="!canUseAction('bet')"
              @click="canUseAction('bet') ? playerAction('bet', { amount: betAmount }) : null"
            >
              Bet
            </button>
            <button
              type="button"
              class="table-action-btn betting"
              :disabled="!canUseAction('raise')"
              @click="canUseAction('raise') ? playerAction('raise', { amount: betAmount }) : null"
            >
              Raise
            </button>
            <label class="table-bet-label">
              <input v-model.number="betAmount" type="number" min="1" :disabled="!isMyTurn" />
            </label>
          </div>
        </template>
      </div>
    </div>

    <!-- Player actions (below table) -->
    <section
      v-if="!isHost && poker.phase === 'guessing' && mySeat && !mySeat.guessSubmitted"
      class="dock card"
    >
      <h3>Your guess</h3>
      <div class="dock-row">
        <input v-model="guessDraft" type="number" placeholder="Numeric guess" />
        <button type="button" class="primary" @click="playerAction('submit_guess', { guess: Number(guessDraft) })">
          Submit
        </button>
      </div>
    </section>

    <!-- Host controls -->
    <section v-if="isHost" class="dock card host-dock">
      <button type="button" class="host-toggle" @click="hostControlsOpen = !hostControlsOpen">
        {{ hostControlsOpen ? 'Hide' : 'Show' }} leader controls
      </button>

      <div v-show="hostControlsOpen" class="host-inner">
        <div class="host-actions">
          <div v-if="hostContinuePrompt" class="host-next-prompt">
            <div class="host-next-text">
              <strong>{{ hostContinuePrompt.title }}</strong>
              <span>{{ hostContinuePrompt.next }}</span>
            </div>
            <button type="button" class="primary" @click="host('end_betting_round')">Continue</button>
          </div>

          <label class="blind-control">
            Big blind
            <input v-model.number="bigBlindDraft" type="number" min="2" step="1" />
          </label>
          <button type="button" @click="setBlinds">Set blinds (SB auto)</button>
          <span class="blind-readout">Current: SB {{ poker.smallBlind }} / BB {{ poker.bigBlind }}</span>
          <button
            v-if="poker.phase === 'select_question'"
            type="button"
            class="primary"
            @click="host('start_guessing')"
          >
            Open guessing
          </button>
          <button
            v-if="poker.phase === 'guessing' && allGuessesIn"
            type="button"
            class="primary"
            @click="host('start_betting')"
          >
            Start betting (round 1)
          </button>
          <button
            v-if="poker.betting?.subPhase === 'round_complete' || poker.betting?.subPhase === 'action'"
            type="button"
            @click="host('end_betting_round')"
          >
            End betting round
          </button>
          <button v-if="poker.phase === 'clue_1'" type="button" @click="host('reveal_clue_1')">Reveal clue 1</button>
          <button v-if="poker.phase === 'clue_1'" type="button" @click="host('start_betting')">Betting round 2</button>
          <button v-if="poker.phase === 'clue_2'" type="button" @click="host('reveal_clue_2')">Reveal clue 2</button>
          <button v-if="poker.phase === 'clue_2'" type="button" @click="host('start_betting')">Betting round 3</button>
          <button v-if="poker.phase === 'answer_reveal'" type="button" @click="host('reveal_answer')">
            Reveal answer
          </button>
          <button v-if="poker.phase === 'answer_reveal'" type="button" @click="host('start_betting')">
            Final betting
          </button>
          <button type="button" @click="host('reveal_guesses')">Reveal guesses</button>
          <button v-if="poker.phase === 'hand_complete'" type="button" class="primary" @click="host('next_hand')">
            Next hand
          </button>
        </div>

        <div class="host-block">
          <h4>Question library</h4>
          <textarea
            v-model="questionsDraft"
            rows="3"
            placeholder="prompt:answer:clue1:clue2 (one per line)"
          />
          <button type="button" class="primary" @click="saveQuestions">Save library</button>
          <ul v-if="poker.questionLibrary.length" class="q-list">
            <li v-for="q in poker.questionLibrary" :key="q.id">
              {{ q.prompt }}
              <button type="button" class="ghost sm" @click="host('select_question', { questionId: q.id })">
                Select
              </button>
              <button type="button" class="ghost sm" @click="host('remove_question', { questionId: q.id })">
                Remove
              </button>
            </li>
          </ul>
        </div>

        <div v-if="poker.phase === 'showdown' && poker.closestGuessRanking?.length" class="host-block showdown">
          <h4>Pick winner(s)</h4>
          <ul>
            <li v-for="r in poker.closestGuessRanking" :key="r.playerId">
              {{ playerName(r.playerId) }}: {{ r.guess }} (Δ {{ r.distance }})
              <span v-if="r.tiedForClosest && tiedClosestCount > 1" class="tag">tied</span>
              <label>
                <input
                  type="checkbox"
                  :checked="selectedWinners.includes(r.playerId)"
                  @change="toggleWinner(r.playerId)"
                />
                Award
              </label>
            </li>
          </ul>
          <button type="button" class="primary" :disabled="!selectedWinners.length" @click="confirmWinners">
            Confirm winner(s)
          </button>
        </div>

        <button type="button" class="ghost" @click="host('reset_hand')">Reset hand</button>
      </div>
    </section>

  </div>
</template>

<style scoped>
.qp {
  display: grid;
  gap: 1rem;
  max-width: 100%;
}

/* --- Table stage --- */
.table-stage {
  width: 100%;
  position: relative;
}

.leader-badge {
  position: absolute;
  top: -0.15rem;
  left: 0.25rem;
  z-index: 5;
  display: flex;
  align-items: center;
  gap: 0.45rem;
  padding: 0.35rem 0.55rem;
  border-radius: 10px;
  background: rgba(12, 20, 16, 0.8);
  border: 1px solid rgba(253, 230, 138, 0.35);
  box-shadow: 0 3px 10px rgba(0, 0, 0, 0.25);
}

.leader-dot {
  width: 26px;
  height: 26px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.7rem;
  font-weight: 700;
  color: #fde68a;
  background: linear-gradient(145deg, #5c3d1e, #2a1810);
  border: 1px solid rgba(251, 191, 36, 0.6);
}

.leader-text {
  display: flex;
  flex-direction: column;
  line-height: 1.1;
}

.leader-text strong {
  font-size: 0.72rem;
  color: #fef3c7;
}

.leader-text span {
  font-size: 0.62rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: rgba(254, 243, 199, 0.75);
}

.table-felt {
  position: relative;
  width: 100%;
  max-width: 920px;
  margin: 0 auto;
  aspect-ratio: 16 / 11;
  min-height: 320px;
  border-radius: 50% / 42%;
  overflow: visible;
  background:
    radial-gradient(ellipse 85% 75% at 50% 45%, rgba(18, 92, 62, 0.95) 0%, rgba(8, 48, 34, 0.98) 72%),
    repeating-linear-gradient(
      105deg,
      rgba(0, 0, 0, 0.03) 0 2px,
      transparent 2px 6px
    ),
    linear-gradient(160deg, #0d4a32 0%, #062a1c 55%, #041a12 100%);
  box-shadow:
    inset 0 0 80px rgba(0, 0, 0, 0.45),
    0 12px 40px rgba(0, 0, 0, 0.5);
}

.table-felt::before {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
  background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.07'/%3E%3C/svg%3E");
  pointer-events: none;
  mix-blend-mode: overlay;
}

.table-rail {
  position: absolute;
  inset: 3%;
  border: 3px solid rgba(201, 162, 39, 0.55);
  border-radius: 50% / 46%;
  box-shadow:
    inset 0 0 24px rgba(201, 162, 39, 0.15),
    0 0 0 6px rgba(30, 18, 8, 0.35);
  pointer-events: none;
}

/* --- Center hub --- */
.table-hub {
  position: absolute;
  left: 50%;
  top: 46%;
  transform: translate(-50%, -50%);
  width: min(52%, 340px);
  min-height: 42%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  padding: 1rem 1.1rem;
  text-align: center;
  background: radial-gradient(
    ellipse at center,
    rgba(12, 38, 28, 0.92) 0%,
    rgba(6, 22, 16, 0.88) 100%
  );
  border: 2px solid rgba(201, 162, 39, 0.35);
  border-radius: 50%;
  box-shadow:
    0 0 0 4px rgba(0, 0, 0, 0.25),
    inset 0 0 30px rgba(0, 0, 0, 0.35);
  z-index: 2;
}

.action-toast {
  position: absolute;
  left: 50%;
  top: 44%;
  transform: translate(-50%, -50%);
  z-index: 7;
  padding: 0.45rem 0.75rem;
  border-radius: 999px;
  background: rgba(12, 20, 16, 0.9);
  border: 1px solid rgba(148, 163, 184, 0.35);
  color: #f8fafc;
  font-size: 0.86rem;
  font-weight: 600;
  box-shadow: 0 6px 16px rgba(0, 0, 0, 0.35);
  pointer-events: none;
  white-space: nowrap;
}

.action-toast-fade-enter-active,
.action-toast-fade-leave-active {
  transition: opacity 280ms ease, transform 280ms ease;
}

.action-toast-fade-enter-from,
.action-toast-fade-leave-to {
  opacity: 0;
  transform: translate(-50%, -35%);
}

.hub-content {
  width: 100%;
  max-height: 9rem;
  overflow-y: auto;
}

.hub-waiting {
  margin: 0;
  font-size: 0.85rem;
  color: rgba(255, 255, 255, 0.55);
  font-style: italic;
}

.hub-question {
  margin: 0 0 0.4rem;
  font-size: clamp(0.85rem, 2.2vw, 1.05rem);
  line-height: 1.35;
  color: #f0fdf4;
  font-weight: 600;
}

.hub-clue {
  margin: 0.25rem 0;
  font-size: 0.78rem;
  line-height: 1.3;
  color: rgba(187, 247, 208, 0.9);
}

.clue-badge {
  display: inline-block;
  margin-right: 0.35rem;
  padding: 0.1rem 0.4rem;
  border-radius: 4px;
  background: rgba(34, 197, 94, 0.35);
  font-size: 0.65rem;
  font-weight: 700;
  text-transform: uppercase;
}

.hub-answer {
  margin: 0.35rem 0 0;
  font-size: 0.85rem;
  color: #fef08a;
}

.top-right-stack {
  position: absolute;
  top: -0.15rem;
  right: 0.25rem;
  z-index: 6;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 0.4rem;
  max-width: min(220px, 42vw);
}

.host-game-state {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 0.25rem;
  padding: 0.4rem 0.55rem;
  border-radius: 10px;
  background: rgba(12, 20, 16, 0.88);
  border: 1px solid rgba(56, 189, 248, 0.35);
  box-shadow: 0 3px 10px rgba(0, 0, 0, 0.25);
  text-align: right;
}

.host-game-state-label {
  font-size: 0.58rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: rgba(186, 230, 253, 0.7);
}

.host-game-state-meta,
.host-game-state-hint {
  font-size: 0.62rem;
  color: rgba(255, 255, 255, 0.65);
  line-height: 1.25;
}

.host-game-state-hint {
  color: #fde68a;
}

.center-pot-display {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.15rem;
  margin: 0.35rem 0;
  padding: 0.35rem 0.9rem;
  border-radius: 14px;
  background: rgba(251, 191, 36, 0.22);
  border: 1px solid rgba(253, 230, 138, 0.45);
}

.center-pot-label {
  font-size: 0.72rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: rgba(253, 230, 138, 0.85);
}

.center-pot-value {
  font-size: clamp(1.8rem, 3rem, 2.4rem);
  font-weight: 800;
  color: #fde68a;
  line-height: 1;
  text-shadow: 0 2px 10px rgba(0, 0, 0, 0.45);
}

.hub-phase {
  padding: 0.15rem 0.5rem;
  border-radius: 999px;
  background: rgba(56, 189, 248, 0.25);
  color: #bae6fd;
}

/* --- Seats on the ring --- */
.table-seat {
  position: absolute;
  width: 1px;
  height: 1px;
  z-index: 3;
}

.seat-card {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.25rem;
  width: clamp(72px, 11vw, 108px);
  overflow: visible;
}

.seat-video-wrap {
  position: relative;
  width: clamp(64px, 10vw, 96px);
  height: clamp(64px, 10vw, 96px);
  border-radius: 50%;
  overflow: hidden;
  border: 3px solid rgba(201, 162, 39, 0.5);
  background: #1a1510;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.45);
}

.table-seat.is-me .seat-video-wrap {
  border-color: rgba(56, 189, 248, 0.85);
  box-shadow: 0 0 16px rgba(56, 189, 248, 0.4);
}

.table-seat.is-actor .seat-video-wrap {
  border-color: #4ade80;
  animation: pulse-ring 1.4s ease-in-out infinite;
}

.table-seat.folded {
  opacity: 0.45;
}

.seat-video {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.seat-avatar {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.25rem;
  font-weight: 700;
  color: #d4a574;
  background: linear-gradient(160deg, #3d2914 0%, #1f140a 100%);
}

.seat-turn {
  position: absolute;
  bottom: 2px;
  left: 50%;
  transform: translateX(-50%);
  font-size: 0.55rem;
  padding: 0.1rem 0.35rem;
  border-radius: 4px;
  background: #16a34a;
  color: #fff;
  white-space: nowrap;
}

.blind-pill {
  position: absolute;
  top: -6px;
  right: -8px;
  z-index: 12;
  font-size: 0.56rem;
  padding: 0.14rem 0.38rem;
  border-radius: 999px;
  background: rgba(251, 191, 36, 0.98);
  border: 1px solid rgba(120, 53, 15, 0.7);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.45);
  color: #111827;
  font-weight: 700;
  letter-spacing: 0.03em;
}

.blind-pill.bb {
  background: rgba(220, 38, 38, 0.98);
  border-color: rgba(127, 29, 29, 0.8);
  color: #fff7f7;
}

.seat-meta {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.1rem;
  font-size: 0.65rem;
  color: rgba(255, 255, 255, 0.85);
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.8);
}

.seat-name {
  font-weight: 700;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.seat-chips {
  color: #fde68a;
  display: inline-flex;
  align-items: center;
  gap: 0.28rem;
  padding: 0.08rem 0.35rem;
  border-radius: 999px;
  background: rgba(15, 23, 42, 0.45);
  border: 1px solid rgba(253, 230, 138, 0.28);
}

.seat-chips-row,
.seat-guess-row {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
}

.chip-icon {
  width: 0.85rem;
  height: 0.85rem;
  filter: drop-shadow(0 1px 1px rgba(0, 0, 0, 0.45));
}

.seat-tag {
  font-size: 0.58rem;
  color: #fca5a5;
}

.seat-guess {
  font-size: 0.58rem;
  color: #a5f3fc;
}

.guess-pill {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.08rem 0.35rem;
  border-radius: 999px;
  background: rgba(8, 47, 73, 0.55);
  border: 1px solid rgba(125, 211, 252, 0.34);
  color: #cffafe;
}

.seat-guess.dim {
  color: rgba(255, 255, 255, 0.72);
  background: rgba(71, 85, 105, 0.45);
  border-color: rgba(203, 213, 225, 0.28);
}

.inline-tool-btn {
  border: 1px solid rgba(148, 163, 184, 0.3);
  background: rgba(15, 23, 42, 0.5);
  color: #e2e8f0;
  border-radius: 6px;
  line-height: 1;
  font-size: 0.68rem;
  padding: 0.08rem 0.24rem;
  cursor: pointer;
}

.inline-tool-btn:hover {
  background: rgba(30, 41, 59, 0.7);
}

.inline-editor {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
}

.inline-editor input {
  width: 4.2rem;
  padding: 0.15rem 0.3rem;
  font-size: 0.7rem;
  border-radius: 6px;
}

@keyframes pulse-ring {
  0%,
  100% {
    box-shadow: 0 0 0 0 rgba(74, 222, 128, 0.5);
  }
  50% {
    box-shadow: 0 0 0 6px rgba(74, 222, 128, 0);
  }
}

.table-bar {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-wrap: wrap;
  gap: 0.55rem;
  margin-top: 0.75rem;
}

.cam-btn {
  padding: 0.45rem 1rem;
  border-radius: 999px;
  border: 1px solid rgba(201, 162, 39, 0.5);
  background: rgba(12, 48, 34, 0.9);
  color: #fde68a;
  cursor: pointer;
  font-size: 0.85rem;
}

.cam-btn:hover {
  background: rgba(18, 72, 52, 0.95);
}

.turn-pill {
  padding: 0.35rem 0.75rem;
  border-radius: 999px;
  background: #16a34a;
  color: #fff;
  font-size: 0.8rem;
  font-weight: 600;
}

.turn-pill.waiting {
  background: rgba(71, 85, 105, 0.8);
}

.table-action-btn {
  border: 1px solid rgba(253, 230, 138, 0.35);
  background: linear-gradient(180deg, rgba(20, 64, 50, 0.96), rgba(10, 38, 30, 0.96));
  color: #f8fafc;
  border-radius: 999px;
  padding: 0.38rem 0.82rem;
  text-transform: capitalize;
  font-size: 0.82rem;
  font-weight: 600;
  cursor: pointer;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
}

.table-action-btn:hover:not(:disabled) {
  background: linear-gradient(180deg, rgba(24, 84, 64, 0.96), rgba(12, 54, 41, 0.96));
  transform: translateY(-1px);
}

.table-action-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.table-action-btn.betting {
  margin: 0;
}

.betting-pill {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  border-radius: 999px;
  background: rgba(12, 20, 16, 0.72);
  border: 1px solid rgba(253, 230, 138, 0.28);
  padding: 0.24rem 0.35rem 0.24rem 0.3rem;
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.03);
}

.betting-pill.disabled {
  opacity: 0.75;
}

.table-bet-label {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  font-size: 0.78rem;
  color: var(--muted);
  background: rgba(12, 20, 16, 0.6);
  border: 1px solid rgba(148, 163, 184, 0.25);
  border-radius: 999px;
  padding: 0.2rem 0.45rem;
}

.table-bet-label input {
  width: 4.25rem;
  padding: 0.2rem 0.35rem;
  border-radius: 6px;
}

/* --- Dock panels --- */
.dock {
  max-width: 920px;
  margin: 0 auto;
}

.card {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 1rem 1.25rem;
}

.dock-row {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.dock-row input {
  flex: 1;
  min-width: 120px;
}

.host-dock .host-toggle {
  width: 100%;
  padding: 0.5rem;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: transparent;
  color: var(--text);
  cursor: pointer;
  margin-bottom: 0.75rem;
}

.host-inner {
  display: grid;
  gap: 1rem;
}

.host-block h4 {
  margin: 0 0 0.5rem;
  font-size: 0.95rem;
}

textarea {
  width: 100%;
  margin-bottom: 0.5rem;
  padding: 0.5rem;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: var(--input-bg);
  color: var(--text);
  font-family: inherit;
}

.host-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  align-items: center;
}

.host-next-prompt {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.7rem;
  padding: 0.55rem 0.7rem;
  border-radius: 10px;
  background: rgba(56, 189, 248, 0.12);
  border: 1px solid rgba(56, 189, 248, 0.35);
}

.host-next-text {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}

.host-next-text strong {
  font-size: 0.85rem;
}

.host-next-text span {
  font-size: 0.78rem;
  color: var(--muted);
}

.blind-control {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.85rem;
}

.blind-control input {
  width: 6rem;
}

.blind-readout {
  font-size: 0.8rem;
  color: var(--muted);
}

.q-list {
  margin: 0.5rem 0 0;
  padding: 0;
  list-style: none;
}

.q-list li {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  align-items: center;
  margin-bottom: 0.35rem;
}

button.primary {
  background: var(--accent, #38bdf8);
  color: #0f172a;
  border: none;
  padding: 0.45rem 0.85rem;
  border-radius: 8px;
  cursor: pointer;
}

button.ghost {
  background: transparent;
  border: 1px solid var(--border);
  color: var(--text);
  padding: 0.4rem 0.75rem;
  border-radius: 8px;
  cursor: pointer;
}

button.sm {
  font-size: 0.8rem;
  padding: 0.2rem 0.5rem;
}

.action-btns {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.action-chip {
  padding: 0.45rem 0.85rem;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: var(--input-bg);
  color: var(--text);
  cursor: pointer;
  text-transform: capitalize;
}

.action-chip:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.bet-label {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-top: 0.5rem;
  font-size: 0.85rem;
}

.turn-hint {
  margin: 0 0 0.45rem;
  font-size: 0.85rem;
  color: #86efac;
}

.turn-hint.waiting {
  color: var(--muted);
}

.tag {
  font-size: 0.75rem;
  color: #fbbf24;
}

.warn {
  color: #f87171;
  font-size: 0.85rem;
}

input,
select {
  padding: 0.45rem 0.55rem;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: var(--input-bg);
  color: var(--text);
}

@media (max-width: 560px) {
  .table-hub {
    width: 58%;
    padding: 0.65rem;
  }

  .seat-card {
    width: 64px;
  }
}
</style>
