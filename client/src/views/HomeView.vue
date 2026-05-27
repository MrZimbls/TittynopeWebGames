<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import type { CreateRoomOk, JoinRoomErr, RoomType } from '../../../shared/protocol'
import { useSessionStore } from '../stores/session'
import { getSocket } from '../socket'

const router = useRouter()
const session = useSessionStore()

const name = ref(session.displayName || '')
const joinCode = ref('')
const joinName = ref(session.displayName || '')
const roomType = ref<RoomType>('quiz_buzzer')
const busy = ref(false)
const message = ref('')

function hostSecretKey(code: string) {
  return `webgames_hostsecret_${code}`
}

function createRoom() {
  const n = name.value.trim()
  if (!n) {
    message.value = 'Enter your display name.'
    return
  }
  busy.value = true
  message.value = ''
  session.setDisplayName(n)
  const socket = getSocket()
  if (!socket.connected) {
    socket.connect()
  }
  socket.emit(
    'room:create',
    { type: roomType.value, hostName: n },
    (res: CreateRoomOk | JoinRoomErr) => {
      busy.value = false
      if ('error' in res) {
        message.value = res.error
        return
      }
      sessionStorage.setItem(hostSecretKey(res.code), res.hostSecret)
      sessionStorage.setItem(`webgames_player_${res.code}`, res.playerId)
      session.setBootstrapSnapshot(res.snapshot)
      void router.push({ path: `/r/${res.code}`, query: { host: '1' } })
    },
  )
}

function joinRoom() {
  const code = joinCode.value.trim().toUpperCase()
  const n = joinName.value.trim()
  if (!code || !n) {
    message.value = 'Enter room code and your name.'
    return
  }
  busy.value = true
  message.value = ''
  session.setDisplayName(n)
  void router.push({ path: `/r/${code}` })
}
</script>

<template>
  <div class="home">
    <section class="card">
      <h2>Create a room</h2>
      <label class="field">
        <span>Your name</span>
        <input v-model="name" maxlength="32" type="text" autocomplete="nickname" placeholder="Alex" />
      </label>
      <label class="field">
        <span>Game mode</span>
        <select v-model="roomType">
          <option value="quiz_buzzer">Quiz buzzer</option>
          <option value="guess_lock">Guess & lock grid</option>
          <option value="quiz_poker">Quizz Poker</option>
        </select>
      </label>
      <button class="primary" type="button" :disabled="busy" @click="createRoom">Create room</button>
    </section>

    <section class="card">
      <h2>Join a room</h2>
      <label class="field">
        <span>Room code</span>
        <input v-model="joinCode" maxlength="8" type="text" autocomplete="off" placeholder="ABC123" />
      </label>
      <label class="field">
        <span>Your name</span>
        <input v-model="joinName" maxlength="32" type="text" autocomplete="nickname" placeholder="Sam" />
      </label>
      <button class="primary" type="button" :disabled="busy" @click="joinRoom">Join room</button>
    </section>

    <p v-if="message" class="message" role="status">{{ message }}</p>
  </div>
</template>

<style scoped>
.home {
  display: grid;
  gap: 1.5rem;
  max-width: 520px;
  margin: 0 auto;
}

.card {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 1.25rem 1.5rem;
  display: grid;
  gap: 1rem;
}

h2 {
  margin: 0;
  font-size: 1.1rem;
}

.field {
  display: grid;
  gap: 0.35rem;
}

.field span {
  font-size: 0.85rem;
  color: var(--muted);
}

input,
select {
  padding: 0.55rem 0.65rem;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: var(--input-bg);
  color: var(--text);
}

.message {
  color: #f87171;
  margin: 0;
}
</style>
