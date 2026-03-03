import { createRouter, createWebHistory } from 'vue-router';
const PanoPage = () => import('../pages/PanoPage.vue');
const LottiePage = () => import('../pages/LottiePage.vue');
const ModelPage = () => import('../pages/ModelPage.vue');

const routes = [
  { path: '/', redirect: '/lantern' },
  { path: '/pano', component: PanoPage },
  { path: '/lantern', component: LottiePage },
  { path: '/model', component: ModelPage }
];

const router = createRouter({
  history: createWebHistory(),
  routes
});

export default router;
