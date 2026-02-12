<template>
  <div class="app">
    <div class="nav">
      <RouterLink to="/pano" class="nav-link" :class="{ active: route.path === '/pano' }">全景</RouterLink>
      <RouterLink to="/lantern" class="nav-link" :class="{ active: route.path === '/lantern' }">灯笼</RouterLink>
    </div>
    <RouterView />
  </div>
</template>

<script setup>
import { RouterLink, RouterView, useRoute } from 'vue-router';

const route = useRoute();
</script>

<style>
:global(html),
:global(body) {
  margin: 0;
  padding: 0;
  height: 100%;
  overflow: hidden;
  background: #000;
  font-family: -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica, Arial, sans-serif;
}

.app {
  position: relative;
}

.nav {
  position: fixed;
  top: 16px;
  left: 16px;
  z-index: 20;
  display: flex;
  gap: 8px;
}

.nav-link {
  text-decoration: none;
  background: rgba(0, 0, 0, 0.45);
  color: #fff;
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 6px;
  padding: 6px 12px;
  font-size: 0.875rem;
}

.nav-link.active {
  background: rgba(2, 132, 199, 0.6);
  border-color: rgba(2, 132, 199, 0.9);
}
</style>
