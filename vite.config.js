import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    // Force every dependency to share the application's React instance. This
    // also keeps linked/hybrid installs from creating invalid hook calls.
    dedupe: ['react', 'react-dom'],
  },
  define: {
    'globalThis.__FINTRACK_BUILD__': JSON.stringify({
      version: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) || process.env.npm_package_version || 'local',
      environment: process.env.VERCEL_ENV || process.env.NODE_ENV || 'development',
    }),
  },
  server: {
    port: 5173,
    host: true,
    allowedHosts: true
  },
  build: {
    outDir: 'dist',
    // Keep application source out of public production artifacts. Error
    // monitoring can upload hidden maps in a separate authenticated step.
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks(id) {
          const moduleId = id.replaceAll('\\', '/')
          if (!moduleId.includes('/node_modules/')) return undefined
          if (/\/node_modules\/(react|react-dom|react-router|react-router-dom)\//.test(moduleId)) return 'vendor-react'
          if (moduleId.includes('/node_modules/@supabase/')) return 'vendor-supabase'
          if (moduleId.includes('/node_modules/lucide-react/')) return 'vendor-ui'
          if (moduleId.includes('/node_modules/date-fns/')) return 'vendor-date'
          return undefined
        }
      }
    }
  }
})
