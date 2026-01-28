<template>
  <div class="app">
    <!-- 缩略图容器：由 buildThumbs 动态插入缩略图按钮 -->
    <div id="thumbs" ref="thumbsEl"></div>
    <!-- 加载提示层：贴图加载或切换时显示 -->
    <div id="loading" ref="loadingEl">图片加载中…</div>
    <!-- WebGL 画布：Three.js 渲染输出目标 -->
    <canvas id="c" ref="canvasEl"></canvas>
  </div>
</template>

<script setup>
// Vue 组合式 API：生命周期与响应式引用
import { onBeforeUnmount, onMounted, ref } from 'vue';
// Three.js 核心库：场景、相机、材质、纹理等
import * as THREE from 'three';
// 轨道控制器：实现拖拽旋转视角
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

// 全景贴图列表
// - id：用于缩略图高亮与状态记录
// - src：通过 import.meta.url 生成资源 URL，适配 Vite 打包
const PANO_LIST = [
  { id: 'pano1', src: new URL('../assets/97b16f01995764d14ac91aa435604bec.jpg', import.meta.url).href },
  { id: 'pano2', src: new URL('../assets/a98b0e5cee1b778588ae6b48e5643b72.jpg', import.meta.url).href },
  { id: 'pano3', src: new URL('../assets/beea51b1dbe12ccd4f47349bc4489e1a.jpg', import.meta.url).href }
];

// DOM 引用：用于获取画布、缩略图容器、加载提示层
const canvasEl = ref(null);
const thumbsEl = ref(null);
const loadingEl = ref(null);

// 统一回收函数集合：在组件卸载时清理监听与动画
let cleanups = [];

onMounted(() => {
  // 创建渲染器并绑定画布
  const { renderer } = createRenderer(canvasEl.value);
  // 创建场景与相机
  const { scene, camera } = createSceneCamera();
  // 创建控制器：负责旋转与阻尼
  const controls = createControls(camera, renderer.domElement);
  // 全景管理器：贴图加载、缓存与切换
  const panoManager = createPanoManager({
    renderer,
    scene,
    panoList: PANO_LIST,
    loadingEl: loadingEl.value
  });
  // 缩放控制器：通过 FOV 插值实现平滑缩放
  const zoomController = createZoomController(camera, renderer.domElement, {
    min: 30,
    max: 100,
    ease: 0.15
  });
  // 构建缩略图并返回首个 id
  const firstPanoId = buildThumbs(thumbsEl.value, PANO_LIST, (id) => panoManager.showById(id));
  // 首屏直接加载第一张，避免进入时空白
  panoManager.showById(firstPanoId, true);
  // 注册自适应与渲染循环
  cleanups.push(setupResize(renderer, camera));
  cleanups.push(startLoop({ renderer, scene, camera, controls, zoomController }));
  // 渲染器资源回收
  cleanups.push(() => renderer.dispose());
});

onBeforeUnmount(() => {
  // 逐一执行清理函数，释放事件与动画
  cleanups.forEach((fn) => fn && fn());
  cleanups = [];
});

// 创建渲染器
// - antialias: 减少锯齿，但会略增加开销
// - outputColorSpace: sRGB 保证颜色一致
// - setPixelRatio: 限制像素比，避免高分屏过度渲染
function createRenderer(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  return { renderer };
}

// 创建场景与相机
// - fov: 初始视角，越大视野越宽
// - aspect: 初始设为 1，后续在 resize 中更新
// - near/far: 裁剪面范围
function createSceneCamera() {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(75, 1, 0.1, 1000);
  // 相机位于球体中心附近，确保能看到内侧贴图
  camera.position.set(0, 0, 0.1);
  return { scene, camera };
}

// 创建轨道控制器
// - 禁止平移，只允许旋转
// - 关闭自带缩放，交给自定义 FOV 缩放控制
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

// 全景管理器
// - 管理球体、材质、纹理加载与缓存
// - 直接切换贴图
function createPanoManager({ renderer, scene, panoList, loadingEl }) {
  // 球体几何：从内部观看，所以使用 BackSide
  const sphereGeo = new THREE.SphereGeometry(1, 64, 64);
  // 基础材质：当前显示的全景
  const baseMat = new THREE.MeshBasicMaterial({ side: THREE.BackSide, transparent: true, opacity: 1 });
  const baseMesh = new THREE.Mesh(sphereGeo, baseMat);
  scene.add(baseMesh);

  // 纹理加载器与缓存
  const textureLoader = new THREE.TextureLoader();
  const textureCache = new Map();
  let currentId = null;

  // 统一设置纹理参数
  // - RepeatWrapping + repeat.x = -1 完成水平翻转，纠正镜像
  // - ClampToEdge 防止上下出现拉伸缝隙
  // - anisotropy 提升斜角清晰度
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

  // 立即切换：首屏加载或强制替换
  function applyTextureImmediate(t) {
    baseMat.map = t;
    baseMat.opacity = 1;
    baseMat.needsUpdate = true;
    loadingEl.style.display = 'none';
  }

  // 按 id 加载纹理
  // - 已缓存则直接返回
  // - 未缓存则异步加载并写入缓存
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

  // 对外入口：切换到指定 id 的全景
  // - immediate 为 true 时跳过过渡
  function showById(id, immediate = false) {
    if (!id) return;
    if (id === currentId) return;
    loadingEl.style.display = '';
    loadTextureById(id, (tex) => {
      applyTextureImmediate(tex);
      currentId = id;
    });
  }

  return { showById };
}

// 创建缩放控制器：使用滚轮修改相机 FOV
// - 通过插值更新避免突兀跳变
function createZoomController(camera, domElement, { min, max, ease }) {
  let targetFov = camera.fov;
  const onWheel = (e) => {
    e.preventDefault();
    const delta = -e.deltaY;
    targetFov = THREE.MathUtils.clamp(targetFov + delta * 0.05, min, max);
  };
  domElement.addEventListener('wheel', onWheel, { passive: false });

  // 每帧渐进式逼近目标 FOV
  function update() {
    if (Math.abs(targetFov - camera.fov) > 0.01) {
      camera.fov += (targetFov - camera.fov) * ease;
      camera.fov = THREE.MathUtils.clamp(camera.fov, min, max);
      camera.updateProjectionMatrix();
    }
  }

  return {
    update,
    // 清理滚轮事件
    cleanup() {
      domElement.removeEventListener('wheel', onWheel);
    }
  };
}

// 构建缩略图列表
// - onSelect: 点击回调，传出对应 id
// - 返回首个 id 用于首屏显示
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

// 自适应窗口尺寸
// - 更新渲染器尺寸与相机宽高比
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

// 主循环
// - controls.update 处理阻尼与旋转
// - zoomController.update 平滑缩放
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

<style>
/* 全局基础样式：移除边距，锁定全屏展示 */
:global(html, body) {
  margin: 0;
  padding: 0;
  height: 100%;
  overflow: hidden;
  background: #000;
  font-family: -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica, Arial, sans-serif;
}

/* 根容器 */
.app {
  position: relative;
}

/* 缩略图条容器：固定底部居中、横向滚动 */
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

/* 缩略图项：固定尺寸、裁剪填充、默认半透明 */
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

/* 悬停态：增强反馈 */
#thumbs img:hover {
  opacity: 1;
  transform: translateY(-1px);
  box-shadow: 0 6px 16px rgba(0, 0, 0, 0.35);
}

/* 激活态：高亮当前选中 */
#thumbs img.active {
  opacity: 1;
  border-color: rgba(2, 132, 199, 0.8);
  box-shadow: 0 0 0 2px rgba(2, 132, 199, 0.45);
}

/* 加载提示层：居中覆盖 */
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

/* 画布铺满视口 */
canvas {
  display: block;
  width: 100vw;
  height: 100vh;
}
</style>
