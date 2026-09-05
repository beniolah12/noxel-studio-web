import { defineConfig } from "vite";

export default defineConfig({
  server: { port: 5273, open: true },
  build: { target: "es2020" }
});
