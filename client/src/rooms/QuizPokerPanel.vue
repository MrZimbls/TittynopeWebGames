<script setup lang="ts">
import { computed, ref, toRef } from 'vue'
import type {
  QuizPokerHostAction,
  QuizPokerPhase,
  QuizPokerState,
  RoomSnapshot,
} from '../../../shared/protocol'
import { isQuizPokerState } from '../../../shared/protocol'
import { getSocket } from '../socket'
import { useQuizPokerWebcam } from '../composables/useQuizPokerWebcam'

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
const contestants = computed(() => props.snapshot.players.filter((p) => !p.isHost))

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

/** Seats around the table; current player anchored at bottom (180°). */
const ringSeats = computed(() => {
  const order = poker.value?.seatOrder ?? []
  const n = order.length
  if (n === 0) return []
  const myIdx = order.indexOf(props.playerId)
  const base = myIdx >= 0 ? myIdx : 0
  return order.map((id, i) => {
    const rel = (i - base + n) % n
    const deg = 180 + (rel / n) * 360
    const ps = poker.value?.players[id]
    return {
      id,
      deg,
      name: playerName(id),
      isMe: id === props.playerId,
      chips: ps?.chips ?? 0,
      bet: ps?.betThisRound ?? 0,
      folded: ps?.folded ?? false,
      allIn: ps?.allIn ?? false,
      guessSubmitted: ps?.guessSubmitted ?? false,
      guess: ps?.guess,
      isActor:
        poker.value?.betting?.subPhase === 'action' &&
        poker.value.betting.seatOrder[poker.value.betting.currentActorIndex] === id,
      webcamEnabled: ps?.webcamEnabled ?? false,
    }
  })
})

const questionsDraft = ref('')
const guessDraft = ref('')
const betAmount = ref(20)
const selectedWinners = ref<string[]>([])
const chipAdjust = ref<Record<string, string>>({})
const overrideGuessPlayer = ref('')
const overrideGuessValue = ref('')
const hostControlsOpen = ref(props.isHost)

const { webcamOn, toggleWebcam, registerSeatVideo, hasVideo } = useQuizPokerWebcam(
  snapshotRef,
  playerIdRef,
)

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
  if (!st?.betting) return 0
  let t = st.betting.mainPot
  for (const sp of st.betting.sidePots) t += sp.amount
  for (const id of st.seatOrder) {
    t += st.players[id]?.betThisRound ?? 0
  }
  return t
})

const allGuessesIn = computed(() => {
  const st = poker.value
  if (!st) return false
  return st.seatOrder.every((id) => st.players[id]?.guessSubmitted)
})

const showGuess = (id: string) => {
  const st = poker.value
  if (!st) return false
  return (
    st.guessesRevealed ||
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

function adjustChips(id: string) {
  const delta = Number(chipAdjust.value[id] ?? 0)
  if (!Number.isFinite(delta) || delta === 0) return
  host('adjust_chips', { playerId: id, chipsDelta: delta })
  chipAdjust.value = { ...chipAdjust.value, [id]: '0' }
}

function seatStyle(deg: number) {
  const radius = 'min(38vw, 42%)'
  return {
    '--seat-deg': `${deg}deg`,
    '--seat-radius': radius,
  }
}
</script>

<template>
  <div v-if="poker" class="qp">
    <!-- Round table overlay -->
    <div class="table-stage">
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
            <div class="seat-meta">
              <span class="seat-name">{{ seat.isMe ? 'You' : seat.name }}</span>
              <span class="seat-chips">{{ seat.chips }}</span>
              <span v-if="seat.folded" class="seat-tag">Fold</span>
              <span v-if="seat.allIn" class="seat-tag">All-in</span>
              <span v-if="seat.guess !== null && showGuess(seat.id)" class="seat-guess">{{ seat.guess }}</span>
              <span v-else-if="seat.guessSubmitted" class="seat-guess dim">Locked</span>
            </div>
          </div>
        </div>

        <!-- Center hub: host + question -->
        <div class="table-hub">
          <div v-if="hostPlayer" class="hub-host">
            <div class="hub-host-avatar host-glow">
              <video
                v-if="isHost && webcamOn && hostPlayer"
                :ref="(el) => registerSeatVideo(hostPlayer!.id, el as HTMLVideoElement | null)"
                autoplay
                playsinline
                muted
                class="hub-host-video"
              />
              <span v-else class="hub-host-initials">{{ initials(hostPlayer.name) }}</span>
            </div>
            <span class="hub-host-label">{{ hostPlayer.name }}</span>
            <span class="hub-host-role">Game leader</span>
          </div>

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

          <div class="hub-status">
            <span class="hub-phase">{{ phaseLabel[poker.phase] }}</span>
            <span v-if="potTotal > 0" class="hub-pot">Pot {{ potTotal }}</span>
            <span v-if="poker.betting && !isHost" class="hub-bet">
              To call: {{ poker.betting.currentBet }}
            </span>
          </div>
        </div>
      </div>

      <div class="table-bar">
        <button type="button" class="cam-btn" @click="toggleWebcam">
          {{ webcamOn ? 'Camera off' : 'Camera on' }}
        </button>
        <span v-if="isMyTurn" class="turn-pill">Your action</span>
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

    <section
      v-if="!isHost && poker.betting?.subPhase === 'action' && poker.legalActions?.length"
      class="dock card actions"
    >
      <h3>Poker action</h3>
      <div class="action-btns">
        <button
          v-for="act in poker.legalActions"
          :key="act"
          type="button"
          class="action-chip"
          @click="
            act === 'bet' || act === 'raise'
              ? playerAction(act, { amount: betAmount })
              : playerAction(act)
          "
        >
          {{ act }}{{ act === 'bet' || act === 'raise' ? ` ${betAmount}` : '' }}
        </button>
      </div>
      <label v-if="poker.legalActions.includes('bet') || poker.legalActions.includes('raise')" class="bet-label">
        Amount
        <input v-model.number="betAmount" type="number" min="1" />
      </label>
    </section>

    <!-- Host controls -->
    <section v-if="isHost" class="dock card host-dock">
      <button type="button" class="host-toggle" @click="hostControlsOpen = !hostControlsOpen">
        {{ hostControlsOpen ? 'Hide' : 'Show' }} leader controls
      </button>

      <div v-show="hostControlsOpen" class="host-inner">
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

        <div class="host-actions">
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

        <div v-if="poker.phase === 'showdown' && poker.closestGuessRanking?.length" class="host-block showdown">
          <h4>Pick winner(s)</h4>
          <ul>
            <li v-for="r in poker.closestGuessRanking" :key="r.playerId">
              {{ playerName(r.playerId) }}: {{ r.guess }} (Δ {{ r.distance }})
              <span v-if="r.tiedForClosest" class="tag">tied</span>
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

        <details class="host-block overrides">
          <summary>Overrides</summary>
          <div v-for="c in contestants" :key="c.id" class="override-row">
            <span>{{ c.name }}</span>
            <input v-model="chipAdjust[c.id]" type="number" placeholder="±chips" />
            <button type="button" class="ghost sm" @click="adjustChips(c.id)">Adjust</button>
          </div>
          <div class="override-row">
            <select v-model="overrideGuessPlayer">
              <option value="">Player</option>
              <option v-for="c in contestants" :key="c.id" :value="c.id">{{ c.name }}</option>
            </select>
            <input v-model="overrideGuessValue" type="number" placeholder="Guess" />
            <button
              type="button"
              class="ghost sm"
              @click="
                host('set_guess', {
                  playerId: overrideGuessPlayer,
                  guess: Number(overrideGuessValue),
                })
              "
            >
              Set guess
            </button>
          </div>
          <button type="button" class="ghost" @click="host('reset_hand')">Reset hand</button>
        </details>
      </div>
    </section>

    <p v-if="!isHost && !hostSecret" class="warn">Reconnect as host with secret to run the table.</p>
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

.hub-host {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.2rem;
  margin-bottom: 0.15rem;
}

.hub-host-avatar {
  width: 56px;
  height: 56px;
  border-radius: 50%;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(145deg, #5c3d1e, #2a1810);
  border: 2px solid rgba(251, 191, 36, 0.7);
}

.host-glow {
  box-shadow: 0 0 18px rgba(251, 191, 36, 0.35);
}

.hub-host-video {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.hub-host-initials {
  font-size: 1.1rem;
  font-weight: 700;
  color: #fde68a;
}

.hub-host-label {
  font-size: 0.8rem;
  font-weight: 600;
  color: #fde68a;
}

.hub-host-role {
  font-size: 0.65rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: rgba(253, 230, 138, 0.65);
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

.hub-status {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem 0.6rem;
  justify-content: center;
  font-size: 0.7rem;
}

.hub-phase {
  padding: 0.15rem 0.5rem;
  border-radius: 999px;
  background: rgba(56, 189, 248, 0.25);
  color: #bae6fd;
}

.hub-pot {
  padding: 0.15rem 0.5rem;
  border-radius: 999px;
  background: rgba(251, 191, 36, 0.2);
  color: #fde68a;
  font-weight: 600;
}

.hub-bet {
  color: rgba(255, 255, 255, 0.6);
}

/* --- Seats on the ring --- */
.table-seat {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 0;
  height: 0;
  z-index: 3;
  transform: rotate(var(--seat-deg)) translateY(calc(-1 * var(--seat-radius))) rotate(calc(-1 * var(--seat-deg)));
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
}

.seat-tag {
  font-size: 0.58rem;
  color: #fca5a5;
}

.seat-guess {
  font-size: 0.58rem;
  color: #a5f3fc;
}

.seat-guess.dim {
  color: rgba(255, 255, 255, 0.45);
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
  gap: 0.75rem;
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

.bet-label {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-top: 0.5rem;
  font-size: 0.85rem;
}

.tag {
  font-size: 0.75rem;
  color: #fbbf24;
}

.override-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  align-items: center;
  margin-bottom: 0.5rem;
}

.overrides summary {
  cursor: pointer;
  font-weight: 600;
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

  .hub-host-avatar {
    width: 44px;
    height: 44px;
  }

  .seat-card {
    width: 64px;
  }
}
</style>
