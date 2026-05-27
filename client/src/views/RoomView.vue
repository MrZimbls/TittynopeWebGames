<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { JoinRoomErr, JoinRoomOk, RoomSnapshot } from '../../../shared/protocol'
import { useSessionStore } from '../stores/session'
import { getSocket } from '../socket'
import QuizBuzzerPanel from '../rooms/QuizBuzzerPanel.vue'
import GuessLockPanel from '../rooms/GuessLockPanel.vue'
import QuizPokerPanel from '../rooms/QuizPokerPanel.vue'

const route = useRoute()
const router = useRouter()
const session = useSessionStore()

const code = computed(() => String(route.params.code || '').toUpperCase())
const isHostRoute = computed(() => route.query.host === '1')

const snapshot = ref<RoomSnapshot | null>(null)
const error = ref('')
const closed = ref('')
const inRoom = ref(false)
const pending = ref(true)
const joinName = ref(session.displayName)

const socket = getSocket()

function hostSecretKey(c: string) {
  return `webgames_hostsecret_${c}`
}

function playerIdKey(c: string) {
  return `webgames_player_${c}`
}

const playerId = computed(() => {
  const k = playerIdKey(code.value)
  return sessionStorage.getItem(k) || ''
})

const isHost = computed(() => {
  if (!snapshot.value || !playerId.value) return false
  const self = snapshot.value.players.find((p) => p.id === playerId.value)
  return Boolean(self?.isHost)
})

const hostSecret = computed(() => sessionStorage.getItem(hostSecretKey(code.value)) || '')

function applyBootstrap() {
  const boot = session.bootstrapSnapshot
  if (boot && boot.code === code.value) {
    snapshot.value = boot
    session.setBootstrapSnapshot(null)
  }
}

function onState(snap: RoomSnapshot) {
  if (snap.code !== code.value) return
  snapshot.value = snap
}

function onClosed(payload: { reason: string }) {
  closed.value = payload.reason === 'host_left' ? 'The host left; this room is closed.' : 'The room has ended.'
  inRoom.value = false
}

function bindSocket() {
  socket.off('room:state', onState)
  socket.off('room:closed', onClosed)
  socket.on('room:state', onState)
  socket.on('room:closed', onClosed)
}

function tryEnterRoom() {
  error.value = ''
  closed.value = ''
  pending.value = true

  const c = code.value
  if (!c) {
    error.value = 'Invalid room link.'
    pending.value = false
    return
  }

  if (!socket.connected) {
    socket.connect()
  }

  bindSocket()

  const skipJoin = isHostRoute.value && Boolean(sessionStorage.getItem(hostSecretKey(c)))

  applyBootstrap()

  if (skipJoin) {
    inRoom.value = true
    pending.value = false
    return
  }

  const name = joinName.value.trim() || session.displayName.trim()
  if (!name) {
    error.value = 'Enter your name to join.'
    inRoom.value = false
    pending.value = false
    return
  }
  session.setDisplayName(name)

  socket.emit('room:join', { code: c, name }, (res: JoinRoomOk | JoinRoomErr) => {
    pending.value = false
    if ('error' in res) {
      error.value = res.error
      inRoom.value = false
      return
    }
    sessionStorage.setItem(playerIdKey(c), res.playerId)
    snapshot.value = res.snapshot
    inRoom.value = true
  })
}

onMounted(() => {
  tryEnterRoom()
})

watch(
  () => code.value,
  (c, prev) => {
    if (!c || c === prev) return
    if (inRoom.value) {
      socket.emit('room:leave')
    }
    inRoom.value = false
    snapshot.value = null
    tryEnterRoom()
  },
)

onBeforeUnmount(() => {
  socket.off('room:state', onState)
  socket.off('room:closed', onClosed)
  if (inRoom.value) {
    socket.emit('room:leave')
  }
})

function leave() {
  void router.push('/')
}
</script>

<template>
  <div class="room">
    <header class="room-head">
      <div>
        <h1>Room {{ code }}</h1>
        <p v-if="snapshot" class="meta">
          Mode:
          <strong>{{
            snapshot.type === 'quiz_buzzer'
              ? 'Quiz buzzer'
              : snapshot.type === 'quiz_poker'
                ? 'Quizz Poker'
                : 'Guess & lock'
          }}</strong>
          · Players: {{ snapshot.players.length }}
        </p>
      </div>
      <button type="button" class="ghost" @click="leave">Leave</button>
    </header>

    <div v-if="closed" class="banner">{{ closed }}</div>

    <p v-else-if="pending" class="muted">Loading…</p>

    <form v-else-if="!inRoom && !isHostRoute" class="card join-card" @submit.prevent="tryEnterRoom">
      <h2>Join {{ code }}</h2>
      <label class="field">
        <span>Your name</span>
        <input v-model="joinName" maxlength="32" type="text" autocomplete="nickname" />
      </label>
      <button class="primary" type="submit">Join</button>
      <p v-if="error" class="err">{{ error }}</p>
    </form>

    <p v-else-if="error && !inRoom" class="err">{{ error }}</p>

    <div v-else-if="snapshot && playerId" class="panels">
      <QuizBuzzerPanel
        v-if="snapshot.type === 'quiz_buzzer'"
        :snapshot="snapshot"
        :player-id="playerId"
        :is-host="isHost"
        :host-secret="hostSecret"
      />
      <QuizPokerPanel
        v-else-if="snapshot.type === 'quiz_poker'"
        :snapshot="snapshot"
        :player-id="playerId"
        :is-host="isHost"
        :host-secret="hostSecret"
      />
      <GuessLockPanel
        v-else
        :snapshot="snapshot"
        :player-id="playerId"
        :is-host="isHost"
        :host-secret="hostSecret"
      />
    </div>

    <p v-else-if="inRoom && !snapshot" class="muted">Waiting for room state…</p>
  </div>
</template>

<style scoped>
.room {
  max-width: 980px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}

.room-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
}

h1 {
  margin: 0;
  font-size: 1.35rem;
}

.meta {
  margin: 0.35rem 0 0;
  color: var(--muted);
  font-size: 0.9rem;
}

.banner {
  padding: 0.85rem 1rem;
  border-radius: 10px;
  background: rgba(248, 113, 113, 0.12);
  border: 1px solid rgba(248, 113, 113, 0.35);
}

.join-card {
  max-width: 400px;
}

.card {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 1.25rem 1.5rem;
  display: grid;
  gap: 1rem;
}

.field {
  display: grid;
  gap: 0.35rem;
}

.field span {
  font-size: 0.85rem;
  color: var(--muted);
}

input {
  padding: 0.55rem 0.65rem;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: var(--input-bg);
  color: var(--text);
}

.err {
  color: #f87171;
  margin: 0;
}

.muted {
  color: var(--muted);
}

.panels {
  width: 100%;
}
</style>
