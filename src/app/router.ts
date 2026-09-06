import { createRouter, createWebHashHistory, type RouteRecordRaw } from 'vue-router'

export const appPages = ['dashboard', 'accounts', 'tags', 'transactions', 'analytics', 'settings'] as const
export type AppPage = (typeof appPages)[number]

const routeComponent = { render: () => null }
const routes: RouteRecordRaw[] = [
  { path: '/', redirect: '/login' },
  { path: '/login', name: 'login', component: routeComponent },
  ...appPages.map((page) => ({ path: `/${page}`, name: page, component: routeComponent })),
  { path: '/:pathMatch(.*)*', redirect: '/login' },
]

export const router = createRouter({ history: createWebHashHistory(), routes })
