import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { RoomSnapshot } from '../../../shared/protocol'

export const useSessionStore = defineStore('session', () => {
  const displayName = ref('')
  /** Snapshot from `room:create` until first `room:state` (avoids race on navigate). */
  const bootstrapSnapshot = ref<RoomSnapshot | null>(null)

  function setDisplayName(name: string) {
    displayName.value = name.trim().slice(0, 32)
  }

  function setBootstrapSnapshot(snapshot: RoomSnapshot | null) {
    bootstrapSnapshot.value = snapshot
  }

  return { displayName, setDisplayName, bootstrapSnapshot, setBootstrapSnapshot }
})
