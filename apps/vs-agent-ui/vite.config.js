import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: '../vs-agent/public',
    emptyOutDir: true,
    commonjsOptions: {
      include: [/node_modules/, /packages\/model/],
    },
  },
})
