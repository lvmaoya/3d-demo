<template>
  <div class="model-page">
    <canvas ref="canvasEl"></canvas>
    <div class="panel">
      <select v-model="selectedModel" @change="handleSelect" class="model-select">
        <option v-for="item in modelOptions" :key="item.value" :value="item.value">
          {{ item.label }}
        </option>
      </select>
    </div>
    <div v-if="statusText" class="status">{{ statusText }}</div>
    <div v-if="errorText" class="error">{{ errorText }}</div>
  </div>
</template>

<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const canvasEl = ref(null);
const statusText = ref('模型加载中…');
const errorText = ref('');

const modelModules = import.meta.glob('../../assets/models/**/*.{glb,gltf}', { eager: true, import: 'default' });
const modelOptions = Object.entries(modelModules)
  .map(([path, url]) => {
    const name = (path.split('/').pop() || '').replace(/\.[^/.]+$/, '');
    return { label: name || path, value: url };
  })
  .sort((a, b) => a.label.localeCompare(b.label));
const selectedModel = ref(modelOptions[0]?.value || '');
const hintText = '模型加载失败，请确认模型与贴图文件在 assets/models 目录下。';
const textureModules = import.meta.glob('../../assets/models/**/*.{png,jpg,jpeg,webp,ktx2}', {
  eager: true,
  import: 'default'
});
const textureUrlMap = new Map();
Object.entries(textureModules).forEach(([path, url]) => {
  const fileName = (path.split('/').pop() || '').toLowerCase();
  if (fileName) textureUrlMap.set(fileName, url);
  const rel = path.split('/assets/models/')[1];
  if (rel) textureUrlMap.set(rel.toLowerCase(), url);
});

let renderer = null;
let scene = null;
let camera = null;
let controls = null;
let rafId = 0;
let resizeHandler = null;
let currentModel = null;
let loader = null;

onMounted(() => {
  const canvas = canvasEl.value;
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0x000000, 1);

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(60, 1, 0.1, 5000);
  camera.position.set(2, 2, 2);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;

  const ambient = new THREE.AmbientLight(0xffffff, 0.6);
  scene.add(ambient);
  const dir = new THREE.DirectionalLight(0xffffff, 0.8);
  dir.position.set(5, 8, 6);
  scene.add(dir);

  const manager = new THREE.LoadingManager();
  manager.setURLModifier((url) => {
    if (url.startsWith('data:') || url.startsWith('blob:')) return url;
    const cleanUrl = url.split('?')[0].split('#')[0];
    const fileName = (cleanUrl.split('/').pop() || '').toLowerCase();
    if (fileName && textureUrlMap.has(fileName)) return textureUrlMap.get(fileName);
    const rel = cleanUrl.replace(/^\.\//, '').toLowerCase();
    if (textureUrlMap.has(rel)) return textureUrlMap.get(rel);
    return url;
  });
  loader = new GLTFLoader(manager);
  if (selectedModel.value) {
    loadModel(selectedModel.value);
  } else {
    statusText.value = '';
    errorText.value = '未找到模型文件，请将 glb/gltf 放在 assets/models 下。';
  }

  resizeHandler = () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  window.addEventListener('resize', resizeHandler);
  resizeHandler();

  const animate = () => {
    rafId = requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
  };
  animate();
});

onBeforeUnmount(() => {
  if (rafId) cancelAnimationFrame(rafId);
  if (resizeHandler) window.removeEventListener('resize', resizeHandler);
  if (controls) controls.dispose();
  if (renderer) renderer.dispose();
  clearModel();
  renderer = null;
  scene = null;
  camera = null;
  controls = null;
  loader = null;
});

function handleSelect() {
  loadModel(selectedModel.value);
}

function loadModel(url) {
  if (!loader || !url) return;
  statusText.value = '模型加载中…';
  errorText.value = '';
  loader.load(
    url,
    (gltf) => {
      clearModel();
      currentModel = gltf.scene;
      scene.add(currentModel);
      fitCameraToObject(currentModel);
      statusText.value = '';
    },
    undefined,
    () => {
      statusText.value = '';
      errorText.value = hintText;
    }
  );
}

function clearModel() {
  if (!currentModel || !scene) return;
  scene.remove(currentModel);
  currentModel.traverse((obj) => {
    if (obj.geometry) obj.geometry.dispose();
    if (obj.material) {
      if (Array.isArray(obj.material)) {
        obj.material.forEach((mat) => mat && mat.dispose && mat.dispose());
      } else if (obj.material.dispose) {
        obj.material.dispose();
      }
    }
  });
  currentModel = null;
}

function fitCameraToObject(object) {
  const box = new THREE.Box3().setFromObject(object);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z);
  const fov = camera.fov * (Math.PI / 180);
  const distance = Math.abs(maxDim / (2 * Math.tan(fov / 2)));
  camera.position.set(center.x + distance, center.y + distance * 0.6, center.z + distance);
  camera.near = Math.max(0.01, distance / 100);
  camera.far = distance * 100;
  camera.updateProjectionMatrix();
  controls.target.copy(center);
  controls.update();
}
</script>

<style scoped>
.model-page {
  position: fixed;
  inset: 0;
  background: #000;
}

canvas {
  display: block;
  width: 100vw;
  height: 100vh;
}

.panel {
  position: fixed;
  top: 16px;
  right: 16px;
  z-index: 6;
}

.model-select {
  background: rgba(0, 0, 0, 0.6);
  color: #fff;
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 6px;
  padding: 6px 10px;
  font-size: 0.875rem;
}

.status,
.error {
  position: fixed;
  left: 16px;
  bottom: 16px;
  color: #fff;
  background: rgba(0, 0, 0, 0.5);
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 6px;
  padding: 8px 12px;
  font-size: 0.875rem;
  max-width: min(520px, calc(100vw - 32px));
  z-index: 5;
}

.error {
  left: 16px;
  bottom: 56px;
  color: #ffb4b4;
  border-color: rgba(255, 180, 180, 0.4);
}
</style>
