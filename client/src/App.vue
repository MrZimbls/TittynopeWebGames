<script setup lang="ts">
import { RouterLink, RouterView } from 'vue-router'
</script>

<template>
  <div class="app">
    <header class="top">
      <RouterLink to="/" class="brand">Tittynope browser games</RouterLink>
      <span class="tagline">Rooms · real-time</span>
    </header>
    <main class="main">
      <RouterView />
    </main>
  </div>
</template>

<style scoped>
.app {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

.top {
  display: flex;
  align-items: baseline;
  gap: 0.75rem;
  padding: 1rem 1.5rem;
  border-bottom: 1px solid var(--border);
  background: var(--bar);
}

.brand {
  font-weight: 700;
  font-size: 1.1rem;
  color: var(--text);
  text-decoration: none;
}

.brand:hover {
  text-decoration: underline;
}

.tagline {
  font-size: 0.85rem;
  color: var(--muted);
}

.main {
  flex: 1;
  padding: 1.5rem;
}
</style>
