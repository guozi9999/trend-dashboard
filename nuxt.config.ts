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
    databasePath: process.env.TREND_DB_PATH || '',
    supabaseUrl: process.env.SUPABASE_URL || '',
    supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || ''
  }
})
