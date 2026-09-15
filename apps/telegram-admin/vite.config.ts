import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "/tg/",
  plugins: [react()],
  build: {
    sourcemap: false,
    target: "es2022",
  },
  server: {
    proxy: {
      "/tg-api": {
        target: "http://127.0.0.1:4310",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/tg-api/, "/internal/telegram"),
      },
    },
  },
});
