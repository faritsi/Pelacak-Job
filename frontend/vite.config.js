import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Konfigurasi Vite. Proxy /api diarahkan ke backend Express saat development,
// supaya frontend tidak perlu hardcode "http://localhost:5000" di semua tempat.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:5000",
        changeOrigin: true,
      },
    },
  },
});
