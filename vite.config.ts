import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // VITE_USE_OPTIMIZED_MODELS (.env, default true): "@models" -> src/assets/models (optimized) or src/assets/models_original.
  // Resolved here so only the selected GLB set is bundled (see src/constants/modelAssets.ts).
  const useOptimizedModels = loadEnv(mode, process.cwd(), "VITE_").VITE_USE_OPTIMIZED_MODELS !== "false";
  return {
    plugins: [react(), tailwindcss()],
    assetsInclude: ["**/*.glb", "**/*.gltf"],
    resolve: {
      alias: {
        "@models": path.resolve(__dirname, useOptimizedModels ? "./src/assets/models" : "./src/assets/models_original"),
        "@": path.resolve(__dirname, "./src"),
      },
    },
  };
});