export default defineNuxtConfig({
  modules: ['@nuxt/ui'],
  css: ['~/assets/css/main.css'],
  devtools: { enabled: true },
  compatibilityDate: '2025-01-01',
  typescript: {
    strict: true,
    typeCheck: true
  },
  runtimeConfig: {
    databasePath: process.env.TREND_DB_PATH || ''
  }
})
