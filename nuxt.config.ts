export default defineNuxtConfig({
  modules: ['@nuxt/ui'],
  css: ['~/assets/css/main.css'],
  devtools: { enabled: true },
  compatibilityDate: '2025-01-01',
  app: {
    baseURL: '/dashboard/'
  },
  typescript: {
    strict: true,
    typeCheck: true
  },
  runtimeConfig: {
    databasePath: process.env.TREND_DB_PATH || ''
  }
})
