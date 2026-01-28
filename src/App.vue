<template>
  <div class="app">
    <div id="thumbs" ref="thumbsEl"></div>
    <div id="loading" ref="loadingEl">图片加载中…</div>
    <canvas id="c" ref="canvasEl"></canvas>
  </div>
</template>

<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

const PANO_LIST = [
  { id: 'pano1', src: new URL('../assets/97b16f01995764d14ac91aa435604bec.jpg', import.meta.url).href },
  { id: 'pano2', src: new URL('../assets/a98b0e5cee1b778588ae6b48e5643b72.jpg', import.meta.url).href },
  { id: 'pano3', src: new URL('../assets/beea51b1dbe12ccd4f47349bc4489e1a.jpg', import.meta.url).href }
];

const canvasEl = ref(null);
const thumbsEl = ref(null);
const loadingEl = ref(null);

let cleanups = [];

onMounted(() => {
  const { renderer } = createRenderer(canvasEl.value);
  const { scene, camera } = createSceneCamera();
  const controls = createControls(camera, renderer.domElement);
  const panoManager = createPanoManager({
    renderer,
    scene,
    panoList: PANO_LIST,
    loadingEl: loadingEl.value,
    transitionDuration: 300
  });
  const zoomController = createZoomController(camera, renderer.domElement, {
    min: 30,
    max: 100,
    ease: 0.15
  });
  const firstPanoId = buildThumbs(thumbsEl.value, PANO_LIST, (id) => panoManager.showById(id));
  panoManager.showById(firstPanoId, true);
  cleanups.push(setupResize(renderer, camera));
  cleanups.push(startLoop({ renderer, scene, camera, controls, zoomController, panoManager }));
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

function createPanoManager({ renderer, scene, panoList, loadingEl, transitionDuration }) {
  const sphereGeo = new THREE.SphereGeometry(1, 64, 64);
  const baseMat = new THREE.MeshBasicMaterial({ side: THREE.BackSide, transparent: true, opacity: 1 });
  const baseMesh = new THREE.Mesh(sphereGeo, baseMat);
  scene.add(baseMesh);
  const nextMat = new THREE.MeshBasicMaterial({ side: THREE.BackSide, transparent: true, opacity: 0 });
  const nextMesh = new THREE.Mesh(sphereGeo, nextMat);
  scene.add(nextMesh);

  const textureLoader = new THREE.TextureLoader();
  const textureCache = new Map();
  let currentId = null;
  let transitionState = null;

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
    nextMat.opacity = 0;
    nextMat.map = null;
    loadingEl.style.display = 'none';
  }

  function crossfadeTo(t, nextId) {
    nextMat.map = t;
    nextMat.opacity = 0;
    nextMat.needsUpdate = true;
    transitionState = { start: performance.now(), duration: transitionDuration, target: t, nextId };
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
    if (id === currentId && !transitionState) return;
    loadingEl.style.display = '';
    loadTextureById(id, (tex) => {
      if (immediate || currentId === null) {
        applyTextureImmediate(tex);
        currentId = id;
        return;
      }
      crossfadeTo(tex, id);
    });
  }

  function updateTransition() {
    if (!transitionState) return;
    const p = Math.min(1, (performance.now() - transitionState.start) / transitionState.duration);
    baseMat.opacity = 1 - p;
    nextMat.opacity = p;
    if (p === 1) {
      const nextId = transitionState.nextId;
      baseMat.map = transitionState.target;
      baseMat.opacity = 1;
      nextMat.opacity = 0;
      nextMat.map = null;
      transitionState = null;
      currentId = nextId;
      loadingEl.style.display = 'none';
    }
  }

  return { showById, updateTransition };
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

function buildThumbs(container, panoList, onSelect) {
  container.innerHTML = '';
  let firstId = null;
  panoList.forEach((x, i) => {
    const img = document.createElement('img');
    img.src = x.src;
    img.alt = x.id;
    img.dataset.id = x.id;
    img.addEventListener('click', () => {
      container.querySelectorAll('img').forEach(el => el.classList.remove('active'));
      img.classList.add('active');
      onSelect(x.id);
    });
    if (i === 0) {
      img.classList.add('active');
      firstId = x.id;
    }
    container.appendChild(img);
  });
  return firstId;
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

function startLoop({ renderer, scene, camera, controls, zoomController, panoManager }) {
  let rafId = 0;
  const animate = () => {
    rafId = requestAnimationFrame(animate);
    controls.update();
    zoomController.update();
    panoManager.updateTransition();
    renderer.render(scene, camera);
  };
  animate();
  return () => cancelAnimationFrame(rafId);
}
</script>

<style>
:global(html, body) {
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
  box-shadow: 0 6px 16px rgba(0, 0, 0, 0.35);
}

#thumbs img.active {
  opacity: 1;
  border-color: rgba(2, 132, 199, 0.8);
  box-shadow: 0 0 0 2px rgba(2, 132, 199, 0.45);
}

#loading {
  position: fixed;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  color: #fff;
  background: rgba(0, 0, 0, 0.5);
  padding: 12px 16px;
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.15);
  z-index: 9;
}

canvas {
  display: block;
  width: 100vw;
  height: 100vh;
}
</style>
