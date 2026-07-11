import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
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
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          'vendor-supabase': ['@supabase/supabase-js'],
          'vendor-ui': ['lucide-react'],
          'vendor-date': ['date-fns'],
        }
      }
    }
  }
})
