<template>
  <div class="lottie-page" ref="pageEl">
    <div class="lottie-canvas" ref="lottieEl"></div>
  </div>
</template>

<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue';
import lottie from 'lottie-web';
import lanternData from '../../assets/json/lantern.json';

const pageEl = ref(null);
const lottieEl = ref(null);
let lottieInstance = null;
let cleanupMotion = null;
let rafId = 0;

onMounted(() => {
  lottieInstance = lottie.loadAnimation({
    container: lottieEl.value,
    renderer: 'svg',
    loop: true,
    autoplay: true,
    animationData: lanternData
  });
  let targetProgress = 0;
  let totalFrames = 0;

  const onReady = () => {
    totalFrames = lottieInstance.totalFrames || 0;
  };

  const update = () => {
    if (!totalFrames) return;
    const frame = Math.max(0, Math.min(totalFrames - 1, targetProgress * (totalFrames - 1)));
    lottieInstance.goToAndStop(frame, true);
  };

  const scheduleUpdate = () => {
    if (!rafId) {
      rafId = requestAnimationFrame(() => {
        rafId = 0;
        update();
      });
    }
  };

  const onDeviceOrientation = (event) => {
    const gamma = event.gamma || 0;
    const normalized = Math.max(-45, Math.min(45, gamma));
    targetProgress = (normalized + 45) / 90;
    scheduleUpdate();
  };

  lottieInstance.addEventListener('DOMLoaded', onReady);
  lottieInstance.pause();
  let orientationBound = false;
  const bindOrientation = () => {
    if (orientationBound) return;
    orientationBound = true;
    window.addEventListener('deviceorientation', onDeviceOrientation);
  };
  const requestPermissionIfNeeded = async () => {
    const DeviceOrientation = window.DeviceOrientationEvent;
    if (DeviceOrientation && typeof DeviceOrientation.requestPermission === 'function') {
      try {
        const result = await DeviceOrientation.requestPermission();
        if (result === 'granted') {
          bindOrientation();
        }
      } catch {}
      return;
    }
    bindOrientation();
  };
  const onPointerDown = () => {
    requestPermissionIfNeeded();
  };
  pageEl.value.addEventListener('pointerdown', onPointerDown);
  requestPermissionIfNeeded();

  cleanupMotion = () => {
    lottieInstance.removeEventListener('DOMLoaded', onReady);
    if (orientationBound) {
      window.removeEventListener('deviceorientation', onDeviceOrientation);
    }
    pageEl.value.removeEventListener('pointerdown', onPointerDown);
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
  };
});

onBeforeUnmount(() => {
  if (cleanupMotion) {
    cleanupMotion();
    cleanupMotion = null;
  }
  if (lottieInstance) {
    lottieInstance.destroy();
    lottieInstance = null;
  }
});
</script>

<style scoped>
.lottie-page {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #000;
}

.lottie-canvas {
  width: min(70vmin, 520px);
  height: min(70vmin, 520px);
}
</style>
