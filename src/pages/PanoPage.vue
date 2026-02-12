<template>
  <div class="pano-page">
    <div id="thumbs">
      <img
        v-for="item in PANO_LIST"
        :key="item.id"
        :src="item.src"
        :alt="item.id"
        :class="{ active: item.id === selectedId }"
        @click="handleSelect(item.id)"
      />
    </div>
    <div id="loading" v-show="isLoading">loading...</div>
    <canvas id="c" ref="canvasEl"></canvas>
  </div>
</template>

<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

const modules = import.meta.glob('../../assets/*.{jpg,jpeg,png,webp}', { eager: true, import: 'default' });
const PANO_LIST = Object.entries(modules)
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([path, url], idx) => {
    const name = (path.split('/').pop() || `pano${idx + 1}`);
    const id = name.replace(/\.[^/.]+$/, '');
    return { id, src: url };
  });

const canvasEl = ref(null);
const isLoading = ref(true);
const selectedId = ref('');
let panoManager = null;
let cleanups = [];

onMounted(() => {
  const { renderer } = createRenderer(canvasEl.value);
  const { scene, camera } = createSceneCamera();
  const controls = createControls(camera, renderer.domElement);
  panoManager = createPanoManager({
    renderer,
    scene,
    panoList: PANO_LIST,
    setLoading: (value) => {
      isLoading.value = value;
    }
  });
  const zoomController = createZoomController(camera, renderer.domElement, {
    min: 30,
    max: 100,
    ease: 0.15
  });
  const firstPanoId = PANO_LIST[0]?.id;
  if (firstPanoId) {
    selectedId.value = firstPanoId;
    panoManager.showById(firstPanoId, true);
    panoManager.preloadAll([firstPanoId]);
  }
  cleanups.push(setupResize(renderer, camera));
  cleanups.push(startLoop({ renderer, scene, camera, controls, zoomController }));
  cleanups.push(() => renderer.dispose());
});

onBeforeUnmount(() => {
  cleanups.forEach((fn) => fn && fn());
  cleanups = [];
});

function createRenderer(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  return { renderer };
}

function createSceneCamera() {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(75, 1, 0.1, 1000);
  camera.position.set(0, 0, 0.1);
  return { scene, camera };
}

function createControls(camera, domElement) {
  const controls = new OrbitControls(camera, domElement);
  controls.enableZoom = false;
  controls.enablePan = false;
  controls.rotateSpeed = 0.3;
  controls.zoomSpeed = 0.5;
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  return controls;
}

function createPanoManager({ renderer, scene, panoList, setLoading }) {
  const sphereGeo = new THREE.SphereGeometry(1, 64, 64);
  const baseMat = new THREE.MeshBasicMaterial({ side: THREE.BackSide, transparent: true, opacity: 1 });
  const baseMesh = new THREE.Mesh(sphereGeo, baseMat);
  scene.add(baseMesh);

  const textureLoader = new THREE.TextureLoader();
  const textureCache = new Map();
  let currentId = null;
  const schedule = (fn) => {
    if (window.requestIdleCallback) {
      window.requestIdleCallback(fn);
    } else {
      setTimeout(fn, 16);
    }
  };

  function setupTexture(t) {
    t.colorSpace = THREE.SRGBColorSpace;
    t.minFilter = THREE.LinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.generateMipmaps = false;
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.ClampToEdgeWrapping;
    t.repeat.x = -1;
    t.offset.x = 1;
    t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  }

  function applyTextureImmediate(t) {
    baseMat.map = t;
    baseMat.opacity = 1;
    baseMat.needsUpdate = true;
    setLoading(false);
  }

  function loadTextureById(id, cb) {
    const info = panoList.find(x => x.id === id);
    if (!info) return;
    if (textureCache.has(id)) {
      cb && cb(textureCache.get(id));
      return;
    }
    const t = textureLoader.load(info.src, () => {
      setupTexture(t);
      textureCache.set(id, t);
      cb && cb(t);
    });
  }

  function showById(id, immediate = false) {
    if (!id) return;
    if (id === currentId) return;
    setLoading(true);
    loadTextureById(id, (tex) => {
      applyTextureImmediate(tex);
      currentId = id;
    });
  }

  function preloadAll(excludeIds = []) {
    const excludeSet = new Set(excludeIds);
    const ids = panoList.map(x => x.id).filter(id => !excludeSet.has(id));
    let index = 0;
    const loadNext = () => {
      if (index >= ids.length) return;
      const id = ids[index++];
      if (textureCache.has(id)) {
        schedule(loadNext);
        return;
      }
      loadTextureById(id, () => schedule(loadNext));
    };
    schedule(loadNext);
  }

  return { showById, preloadAll };
}

function createZoomController(camera, domElement, { min, max, ease }) {
  let targetFov = camera.fov;
  const onWheel = (e) => {
    e.preventDefault();
    const delta = -e.deltaY;
    targetFov = THREE.MathUtils.clamp(targetFov + delta * 0.05, min, max);
  };
  domElement.addEventListener('wheel', onWheel, { passive: false });

  function update() {
    if (Math.abs(targetFov - camera.fov) > 0.01) {
      camera.fov += (targetFov - camera.fov) * ease;
      camera.fov = THREE.MathUtils.clamp(camera.fov, min, max);
      camera.updateProjectionMatrix();
    }
  }

  return {
    update,
    cleanup() {
      domElement.removeEventListener('wheel', onWheel);
    }
  };
}

function handleSelect(id) {
  if (!id || id === selectedId.value) return;
  selectedId.value = id;
  panoManager.showById(id);
}

function setupResize(renderer, camera) {
  const resize = () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  window.addEventListener('resize', resize);
  resize();
  return () => window.removeEventListener('resize', resize);
}

function startLoop({ renderer, scene, camera, controls, zoomController }) {
  let rafId = 0;
  const animate = () => {
    rafId = requestAnimationFrame(animate);
    controls.update();
    zoomController.update();
    renderer.render(scene, camera);
  };
  animate();
  return () => cancelAnimationFrame(rafId);
}
</script>

<style scoped>
.pano-page {
  position: fixed;
  inset: 0;
}

#thumbs {
  position: fixed;
  bottom: 16px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  gap: 10px;
  z-index: 10;
  background: rgba(0, 0, 0, 0.25);
  padding: 8px 10px;
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  backdrop-filter: blur(6px);
  max-width: calc(100vw - 40px);
  overflow-x: auto;
}

#thumbs img {
  width: 96px;
  height: 56px;
  object-fit: cover;
  border-radius: 8px;
  cursor: pointer;
  border: 1px solid rgba(255, 255, 255, 0.25);
  opacity: 0.85;
  transition: transform .12s ease, opacity .12s ease, box-shadow .12s ease;
}

#thumbs img:hover {
  opacity: 1;
  transform: translateY(-1px);
}

#thumbs img.active {
  opacity: 1;
  border-color: rgba(2, 132, 199, 0.8);
}

#loading {
  position: fixed;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  color: #fff;
  background: rgba(0, 0, 0, 0.2);
  padding: 6px 16px;
  border-radius: 6px;
  border: 1px solid rgba(255, 255, 255, 0.05);
  z-index: 9;
  font-size: 0.875rem;
}

canvas {
  display: block;
  width: 100vw;
  height: 100vh;
}
</style>
