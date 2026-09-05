import { defineConfig } from "vite";
import { resolve } from "path";

export default defineConfig({
  server: { port: 5273, open: true },
  build: {
    target: "es2020",
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        editor: resolve(__dirname, "editor.html")
      }
    }
  }
});
