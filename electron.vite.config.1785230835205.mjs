// electron.vite.config.ts
import { resolve } from "node:path";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";
var alias = {
  "@main": resolve("src/main"),
  "@renderer": resolve("src/renderer/src"),
  "@services": resolve("src/services"),
  "@repositories": resolve("src/repositories"),
  "@db": resolve("src/db"),
  "@shared": resolve("src/shared")
};
var electron_vite_config_default = defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias }
  },
  renderer: {
    root: "src/renderer",
    resolve: { alias },
    plugins: [react()],
    build: {
      rollupOptions: {
        input: resolve("src/renderer/index.html")
      }
    }
  }
});
export {
  electron_vite_config_default as default
};
