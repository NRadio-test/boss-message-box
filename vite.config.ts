import { cloudflare } from "@cloudflare/vite-plugin";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), cloudflare()],
  build: {
    target: ["chrome66", "safari12"],
    cssTarget: "chrome61",
    sourcemap: true,
  },
});
