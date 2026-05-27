<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import type { QuizBuzzerState, QuizHostAction, RoomSnapshot } from '../../../shared/protocol'
import { isQuizState } from '../../../shared/protocol'
import { getSocket } from '../socket'
import { playBuzzSound, playWrongSound } from '../utils/playBuzz'

const props = defineProps<{
  snapshot: RoomSnapshot
  playerId: string
  isHost: boolean
  hostSecret: string
}>()

const socket = getSocket()

const quiz = computed(() =>
  isQuizState(props.snapshot.type, props.snapshot.state) ? (props.snapshot.state as QuizBuzzerState) : null,
)

const questionsDraft = ref('')
/** When false and there are saved questions, show summary + "Edit questions". */
const questionsEditorOpen = ref(true)

watch(
  () => quiz.value?.questions,
  (qs) => {
    if (!props.isHost || !qs?.length || questionsDraft.value.trim()) return
    questionsDraft.value = qs.map((q) => (q.answer ? `${q.prompt}:${q.answer}` : q.prompt)).join('\n')
  },
  { immediate: true },
)

onMounted(() => {
  if (quiz.value?.questions?.length) {
    questionsEditorOpen.value = false
  }
  socket.on('quiz:sound', onQuizSound)
})

onUnmounted(() => {
  socket.off('quiz:sound', onQuizSound)
})

function onQuizSound(payload: { kind?: string }) {
  if (payload?.kind === 'wrong') {
    playWrongSound()
  }
}

const typingSubmitDraft = ref('')
const typingCorrectSelection = ref<string[]>([])

watch(
  () => quiz.value?.phase,
  (ph) => {
    if (ph === 'typing_open') {
      typingCorrectSelection.value = []
      typingSubmitDraft.value = ''
    }
  },
)

const playerName = (id: string) => props.snapshot.players.find((p) => p.id === id)?.name ?? id

const contestants = computed(() => props.snapshot.players.filter((p) => !p.isHost))

const leaderboard = computed(() =>
  [...contestants.value].sort((a, b) => (quiz.value?.scores[b.id] ?? 0) - (quiz.value?.scores[a.id] ?? 0)),
)

const scoreDrafts = ref<Record<string, string>>({})

function scoreInput(id: string) {
  return scoreDrafts.value[id] ?? String(quiz.value?.scores[id] ?? 0)
}

function setScoreInput(id: string, v: string) {
  scoreDrafts.value = { ...scoreDrafts.value, [id]: v }
}

watch(
  () => quiz.value?.scores,
  (s) => {
    if (!s) return
    const next: Record<string, string> = { ...scoreDrafts.value }
    for (const p of contestants.value) {
      if (next[p.id] === undefined) {
        next[p.id] = String(s[p.id] ?? 0)
      }
    }
    scoreDrafts.value = next
  },
  { deep: true },
)

const hasBuzzed = computed(() => quiz.value?.buzzOrder.some((b) => b.playerId === props.playerId) ?? false)

const canBuzz = computed(
  () =>
    Boolean(
      quiz.value?.phase === 'question_open' &&
        !props.isHost &&
        !hasBuzzed.value &&
        quiz.value.currentPrompt,
    ),
)

const prevFirstBuzz = ref<string | null>(null)
watch(
  () => quiz.value?.firstBuzz?.playerId ?? null,
  (id) => {
    if (id && prevFirstBuzz.value === null) {
      playBuzzSound()
    }
    prevFirstBuzz.value = id
  },
)

watch(
  () => quiz.value?.questionIndex,
  () => {
    prevFirstBuzz.value = null
  },
)

function emitHost(action: QuizHostAction, extra: Record<string, unknown> = {}) {
  if (!props.isHost || !props.hostSecret) return
  socket.emit('quiz:host', { hostSecret: props.hostSecret, action, ...extra })
}

function buzz() {
  socket.emit('quiz:buzz')
}

function hydrateQuestionsDraft() {
  const qs = quiz.value?.questions
  if (!qs?.length) return
  questionsDraft.value = qs.map((q) => (q.answer ? `${q.prompt}:${q.answer}` : q.prompt)).join('\n')
}

function saveQuestions() {
  emitHost('set_questions', { questionsText: questionsDraft.value })
  questionsEditorOpen.value = false
}

function openQuestionEditor() {
  hydrateQuestionsDraft()
  questionsEditorOpen.value = true
}

const myTypingSubmission = computed(
  () => quiz.value?.typingResponses.find((r) => r.playerId === props.playerId) ?? null,
)

function submitTyping() {
  socket.emit('quiz:typing_submit', { text: typingSubmitDraft.value })
}

const hostCurrentQuestionPreview = computed(() => {
  const q = quiz.value
  if (!q?.questions.length) return ''
  const item = q.questions[q.questionIndex]
  return (item?.prompt ?? '').trim() || '—'
})

const canOpenTyping = computed(
  () =>
    Boolean(
      quiz.value?.questions.length &&
        quiz.value.questionIndex < quiz.value.questions.length &&
        quiz.value.phase !== 'typing_open' &&
        (quiz.value.phase === 'idle' || quiz.value.phase === 'revealed'),
    ),
)

function openTypingRound() {
  emitHost('open_typing')
}

function confirmTypingScores() {
  emitHost('typing_confirm', { correctPlayerIds: [...typingCorrectSelection.value] })
}

function applyScore(playerId: string) {
  const raw = scoreDrafts.value[playerId] ?? '0'
  const n = Math.max(0, Math.floor(Number.parseInt(raw, 10) || 0))
  emitHost('set_score', { playerId, points: n })
}

const showPrompt = computed(
  () =>
    Boolean(
      quiz.value?.currentPrompt &&
        (quiz.value.phase === 'question_open' ||
          quiz.value.phase === 'judging' ||
          quiz.value.phase === 'revealed' ||
          quiz.value.phase === 'typing_open'),
    ),
)

const promptKindLabel = computed(() => {
  if (quiz.value?.phase === 'typing_open') return 'Type-in round'
  if (quiz.value?.questions?.length) return `Question ${quiz.value.questionIndex + 1} / ${quiz.value.questions.length}`
  return 'Question'
})

const showAnswerPublic = computed(() => quiz.value?.phase === 'revealed' && quiz.value.currentAnswer !== '')

const showAnswerHost = computed(
  () =>
    props.isHost &&
    quiz.value?.currentAnswer != null &&
    quiz.value.currentAnswer !== '' &&
    quiz.value.phase !== 'typing_open',
)

const canNext = computed(
  () =>
    Boolean(
      quiz.value &&
        quiz.value.phase !== 'typing_open' &&
        quiz.value.phase !== 'judging' &&
        quiz.value.questionIndex + 1 < quiz.value.questions.length,
    ),
)

const canOpen = computed(
  () =>
    Boolean(
      quiz.value?.questions.length &&
        quiz.value.questionIndex < quiz.value.questions.length &&
        quiz.value.phase !== 'typing_open' &&
        (quiz.value.phase === 'idle' || quiz.value.phase === 'revealed'),
    ),
)

const showQuestionEditor = computed(
  () => props.isHost && (questionsEditorOpen.value || !quiz.value?.questions?.length),
)
</script>

<template>
  <section v-if="quiz" class="quiz">
    <div v-if="isHost && quiz.questions.length" class="host-current-q">
      <p class="host-current-q-label">Current question (host)</p>
      <p class="host-current-q-meta">Slot {{ quiz.questionIndex + 1 }} / {{ quiz.questions.length }}</p>
      <p class="host-current-q-text">{{ hostCurrentQuestionPreview }}</p>
    </div>

    <div v-if="showPrompt" class="prompt-box">
      <p class="q-label">{{ promptKindLabel }}</p>
      <p class="q-text">{{ quiz.currentPrompt }}</p>
      <p v-if="showAnswerPublic" class="answer">Answer: {{ quiz.currentAnswer }}</p>
    </div>

    <div v-if="isHost && showAnswerHost && quiz.phase !== 'revealed'" class="host-answer">
      <strong>Answer (host only in UI):</strong>
      {{ quiz.currentAnswer || '—' }}
    </div>

    <p class="phase">
      Status:
      <strong>{{ quiz.phase.replaceAll('_', ' ') }}</strong>
    </p>

    <div v-if="quiz.phase === 'typing_open' && !isHost" class="typing-player">
      <template v-if="!myTypingSubmission">
        <h3>Your answer</h3>
        <textarea v-model="typingSubmitDraft" class="q-edit" rows="3" maxlength="500" placeholder="Type your answer" />
        <button type="button" class="primary" @click="submitTyping">Submit answer</button>
      </template>
      <template v-else>
        <p class="locked-label">Your answer (locked)</p>
        <p class="locked-text">{{ myTypingSubmission.text }}</p>
      </template>
    </div>

    <div v-if="isHost" class="typing-host">
      <p v-if="quiz.phase === 'typing_open'" class="hint tiny">
        Select every correct answer, then apply points (N points each, N = players in lobby).
      </p>
      <div v-if="quiz.phase === 'typing_open'" class="typing-grade">
        <h4>Submissions</h4>
        <p v-if="!quiz.typingResponses.length" class="hint">No answers yet.</p>
        <ul v-else class="typing-list">
          <li v-for="(r, ri) in quiz.typingResponses" :key="`${r.playerId}-${ri}`">
            <label class="typing-row">
              <input v-model="typingCorrectSelection" type="checkbox" :value="r.playerId" />
              <span class="tn">{{ playerName(r.playerId) }}</span>
              <span class="tt">{{ r.text }}</span>
            </label>
          </li>
        </ul>
        <button type="button" class="primary" :disabled="quiz.phase !== 'typing_open'" @click="confirmTypingScores">
          Apply points for selected
        </button>
      </div>
    </div>

    <div v-if="quiz.firstBuzz && (quiz.phase === 'judging' || quiz.phase === 'revealed')" class="first">
      First buzz:
      <strong>{{ playerName(quiz.firstBuzz.playerId) }}</strong>
    </div>
    <p v-else-if="quiz.phase === 'question_open'" class="hint">Nobody has buzzed yet.</p>

    <ol v-if="quiz.buzzOrder.length && quiz.phase !== 'idle' && quiz.phase !== 'typing_open'" class="order">
      <li v-for="(b, i) in quiz.buzzOrder" :key="`${b.playerId}-${b.atServerMs}-${i}`">
        {{ i + 1 }}. {{ playerName(b.playerId) }}
      </li>
    </ol>

    <div v-if="!isHost && quiz.phase !== 'typing_open'" class="actions">
      <button type="button" class="buzzer" :disabled="!canBuzz" @click="buzz">Buzz</button>
    </div>

    <div v-if="isHost" class="host">
      <div v-if="showQuestionEditor" class="q-block">
        <h3>Questions (one per line; use <code>Prompt:Answer</code>)</h3>
        <textarea
          v-model="questionsDraft"
          class="q-edit"
          rows="8"
          maxlength="50000"
          placeholder="Capital of France?:Paris&#10;2+2?:4"
        />
        <button type="button" class="secondary" @click="saveQuestions">Save questions</button>
      </div>
      <div v-else-if="quiz.questions.length" class="q-block">
        <p class="saved-line">{{ quiz.questions.length }} question(s) saved on server.</p>
        <button type="button" class="secondary" @click="openQuestionEditor">Edit questions</button>
      </div>

      <h3>Round (buzzer)</h3>
      <div class="row">
        <button type="button" class="secondary" :disabled="!canOpen" @click="emitHost('open')">Open question</button>
        <button type="button" class="secondary" :disabled="!canOpenTyping" @click="openTypingRound">
          Open typing round
        </button>
        <button type="button" class="secondary" :disabled="!canNext" @click="emitHost('next_question')">
          Next question
        </button>
        <button type="button" class="secondary" @click="emitHost('reset')">Reset buzzers</button>
        <button type="button" class="secondary" @click="emitHost('reveal')">Reveal answer</button>
      </div>

      <div v-if="quiz.phase === 'judging' && quiz.firstBuzz" class="judge">
        <h3>Judging</h3>
        <div class="row">
          <button type="button" class="primary" @click="emitHost('verdict_correct')">Correct</button>
          <button type="button" class="secondary" @click="emitHost('verdict_wrong')">Wrong</button>
        </div>
      </div>

      <h3>Leaderboard (contestants)</h3>
      <table class="board">
        <thead>
          <tr>
            <th>#</th>
            <th>Player</th>
            <th>Points</th>
            <th>Edit</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(p, i) in leaderboard" :key="p.id">
            <td>{{ i + 1 }}</td>
            <td>{{ p.name }}</td>
            <td>{{ quiz.scores[p.id] ?? 0 }}</td>
            <td class="edit-cell">
              <input class="score-in" type="number" min="0" :value="scoreInput(p.id)" @input="setScoreInput(p.id, ($event.target as HTMLInputElement).value)" />
              <button type="button" class="small secondary" @click="applyScore(p.id)">Apply</button>
            </td>
          </tr>
        </tbody>
      </table>

      <p v-if="!hostSecret" class="warn">Host key missing (e.g. after refresh). Create a new room to host.</p>
    </div>

    <div v-else class="guest-board">
      <h3>Leaderboard</h3>
      <table class="board">
        <thead>
          <tr>
            <th>#</th>
            <th>Player</th>
            <th>Points</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(p, i) in leaderboard" :key="p.id">
            <td>{{ i + 1 }}</td>
            <td>{{ p.name }}</td>
            <td>{{ quiz.scores[p.id] ?? 0 }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>

<style scoped>
.quiz {
  display: grid;
  gap: 1rem;
}

.host-current-q {
  padding: 0.85rem 1rem;
  border-radius: 12px;
  border: 1px solid var(--border);
  background: rgba(99, 102, 241, 0.1);
}

.host-current-q-label {
  margin: 0;
  font-size: 0.8rem;
  color: var(--muted);
  font-weight: 600;
}

.host-current-q-meta {
  margin: 0.2rem 0 0;
  font-size: 0.75rem;
  color: var(--muted);
}

.host-current-q-text {
  margin: 0.35rem 0 0;
  font-size: 1.1rem;
  font-weight: 600;
  color: var(--text-h);
}

.prompt-box {
  padding: 1rem 1.25rem;
  border-radius: 12px;
  border: 1px solid var(--border);
  background: var(--card);
}

.q-label {
  margin: 0 0 0.35rem;
  font-size: 0.85rem;
  color: var(--muted);
}

.q-text {
  margin: 0;
  font-size: 1.25rem;
  font-weight: 600;
  color: var(--text-h);
}

.answer {
  margin: 0.75rem 0 0;
  color: #34d399;
  font-weight: 600;
}

.host-answer {
  padding: 0.65rem 0.85rem;
  border-radius: 8px;
  background: rgba(251, 191, 36, 0.12);
  border: 1px solid rgba(251, 191, 36, 0.35);
  font-size: 0.95rem;
}

.phase,
.first,
.hint {
  margin: 0;
}

.tiny {
  font-size: 0.8rem;
}

.order {
  margin: 0;
  padding-left: 1.2rem;
}

.actions {
  display: flex;
  justify-content: center;
  margin: 0.5rem 0;
}

.buzzer {
  min-width: 180px;
  min-height: 120px;
  border-radius: 999px;
  font-size: 1.25rem;
  font-weight: 700;
  border: none;
  cursor: pointer;
  background: linear-gradient(145deg, #ef4444, #b91c1c);
  color: white;
  box-shadow: 0 8px 24px rgba(185, 28, 28, 0.35);
}

.buzzer:disabled {
  opacity: 0.45;
  cursor: not-allowed;
  box-shadow: none;
}

.typing-player {
  padding: 1rem;
  border-radius: 12px;
  border: 1px solid var(--border);
  background: var(--card);
  display: grid;
  gap: 0.5rem;
}

.typing-player h3 {
  margin: 0;
  font-size: 1rem;
}

.locked-label {
  margin: 0;
  font-size: 0.85rem;
  color: var(--muted);
}

.locked-text {
  margin: 0.35rem 0 0;
  font-weight: 600;
  color: var(--text-h);
}

.typing-host {
  padding: 1rem;
  border-radius: 12px;
  border: 1px dashed var(--border);
  display: grid;
  gap: 0.65rem;
}

.typing-host h4 {
  margin: 0;
  font-size: 1rem;
}

.typing-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: grid;
  gap: 0.35rem;
}

.typing-row {
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
  cursor: pointer;
}

.tn {
  font-weight: 600;
  min-width: 6rem;
}

.tt {
  color: var(--muted);
  word-break: break-word;
}

.host {
  margin-top: 0.5rem;
  padding-top: 1rem;
  border-top: 1px solid var(--border);
  display: grid;
  gap: 0.75rem;
}

.host h3 {
  margin: 0;
  font-size: 1rem;
}

.q-block {
  display: grid;
  gap: 0.5rem;
}

.saved-line {
  margin: 0;
  color: var(--muted);
}

.q-edit {
  width: 100%;
  box-sizing: border-box;
  padding: 0.5rem;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: var(--input-bg);
  color: var(--text);
  font-family: inherit;
  resize: vertical;
}

.row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  align-items: center;
}

.judge {
  padding: 0.75rem 0;
}

.board {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.95rem;
}

.board th,
.board td {
  border: 1px solid var(--border);
  padding: 0.4rem 0.5rem;
  text-align: left;
}

.board th {
  background: rgba(99, 102, 241, 0.08);
}

.edit-cell {
  display: flex;
  gap: 0.35rem;
  align-items: center;
}

.score-in {
  width: 4rem;
  padding: 0.25rem 0.35rem;
}

.small {
  font-size: 0.8rem;
  padding: 0.25rem 0.45rem;
}

.guest-board {
  margin-top: 0.5rem;
}

.guest-board h3 {
  margin: 0 0 0.5rem;
  font-size: 1rem;
}

.warn {
  color: #fbbf24;
  font-size: 0.85rem;
  margin: 0;
}
</style>
