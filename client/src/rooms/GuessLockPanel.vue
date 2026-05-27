<script setup lang="ts">
import { computed, ref } from 'vue'
import type { GuessLockState, RoomSnapshot } from '../../../shared/protocol'
import { isGuessState } from '../../../shared/protocol'
import { getSocket } from '../socket'

const props = defineProps<{
  snapshot: RoomSnapshot
  playerId: string
  isHost: boolean
  hostSecret: string
}>()

const socket = getSocket()

const guess = computed(() =>
  isGuessState(props.snapshot.type, props.snapshot.state) ? (props.snapshot.state as GuessLockState) : null,
)

const drafts = ref<Record<string, string>>({})

const playerName = (id: string) => props.snapshot.players.find((p) => p.id === id)?.name ?? id

function draft(cellId: string) {
  return drafts.value[cellId] ?? ''
}

function setDraft(cellId: string, v: string) {
  drafts.value = { ...drafts.value, [cellId]: v }
}

function lockCell(cellId: string) {
  const g = draft(cellId).trim()
  if (!g) return
  socket.emit('guess:lock', { cellId, guess: g })
}

function host(action: 'unlock_all' | 'new_round' | 'resize', rows?: number, cols?: number) {
  if (!props.isHost || !props.hostSecret) return
  socket.emit('guess:host', { hostSecret: props.hostSecret, action, rows, cols })
}

const rowsInput = ref(3)
const colsInput = ref(3)
</script>

<template>
  <section v-if="guess" class="guess">
    <p class="grid-meta">Grid {{ guess.rows }}×{{ guess.cols }} — pick a cell and lock your guess.</p>

    <div class="grid" :style="{ gridTemplateColumns: `repeat(${guess.cols}, minmax(0, 1fr))` }">
      <div v-for="cell in guess.cells" :key="cell.id" class="cell" :class="{ locked: !!cell.lockedBy }">
        <div class="label">{{ cell.label }}</div>
        <template v-if="cell.lockedBy">
          <div class="guess-text">{{ cell.guess }}</div>
          <div class="owner">{{ playerName(cell.lockedBy) }}</div>
        </template>
        <template v-else>
          <input
            :value="draft(cell.id)"
            maxlength="64"
            type="text"
            placeholder="Guess"
            @input="setDraft(cell.id, ($event.target as HTMLInputElement).value)"
          />
          <button type="button" class="small primary" @click="lockCell(cell.id)">Lock in</button>
        </template>
      </div>
    </div>

    <div v-if="isHost" class="host">
      <h3>Host controls</h3>
      <div class="row">
        <button type="button" class="secondary" @click="host('unlock_all')">Unlock all</button>
        <button type="button" class="secondary" @click="host('new_round')">New round (same size)</button>
      </div>
      <div class="resize">
        <label>Rows <input v-model.number="rowsInput" min="1" max="12" type="number" /></label>
        <label>Cols <input v-model.number="colsInput" min="1" max="12" type="number" /></label>
        <button type="button" class="secondary" @click="host('resize', rowsInput, colsInput)">Resize grid</button>
      </div>
      <p v-if="!hostSecret" class="warn">Host key missing (e.g. after refresh). Create a new room to host.</p>
    </div>
  </section>
</template>

<style scoped>
.guess {
  display: grid;
  gap: 1.25rem;
}

.grid-meta {
  margin: 0;
  color: var(--muted);
}

.grid {
  display: grid;
  gap: 0.65rem;
}

.cell {
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 0.65rem;
  display: grid;
  gap: 0.4rem;
  background: var(--card);
}

.cell.locked {
  background: rgba(99, 102, 241, 0.08);
}

.label {
  font-size: 0.75rem;
  color: var(--muted);
  font-weight: 600;
}

.guess-text {
  font-weight: 600;
}

.owner {
  font-size: 0.8rem;
  color: var(--muted);
}

input {
  padding: 0.45rem 0.5rem;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: var(--input-bg);
  color: var(--text);
}

.small {
  font-size: 0.85rem;
  padding: 0.35rem 0.5rem;
}

.host {
  padding-top: 1rem;
  border-top: 1px solid var(--border);
}

.host h3 {
  margin: 0 0 0.5rem;
  font-size: 1rem;
}

.row,
.resize {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  align-items: flex-end;
  margin-bottom: 0.5rem;
}

.resize label {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  font-size: 0.8rem;
  color: var(--muted);
}

.resize input {
  width: 4rem;
}

.warn {
  color: #fbbf24;
  font-size: 0.85rem;
  margin: 0.5rem 0 0;
}
</style>
