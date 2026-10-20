import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// El front solo habla con el gateway (NestJS, :3000). El proxy evita CORS en desarrollo.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: { "/api": "http://localhost:3000" },
  },
});
