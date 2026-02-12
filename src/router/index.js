import { createRouter, createWebHistory } from 'vue-router';
const PanoPage = () => import('../pages/PanoPage.vue');
const LottiePage = () => import('../pages/LottiePage.vue');

const routes = [
  { path: '/', redirect: '/lantern' },
  { path: '/pano', component: PanoPage },
  { path: '/lantern', component: LottiePage }
];

const router = createRouter({
  history: createWebHistory(),
  routes
});

export default router;
