// Polyfill crypto.hash for Node versions < 19 that don't expose crypto.hash
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const nodeCrypto = require('node:crypto');
if (typeof nodeCrypto.hash !== 'function') {
  nodeCrypto.hash = async (algorithm: string, data: Uint8Array | string) => {
    const h = nodeCrypto.createHash(algorithm);
    h.update(data);
    return h.digest();
  };
}

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import legacy from "@vitejs/plugin-legacy";

export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8081,
  },
  plugins: [
    react(),
    mode === "development" && componentTagger(),
    mode !== "development" &&
      legacy({
        targets: ["ie >= 11"],
        additionalLegacyPolyfills: ["regenerator-runtime/runtime"],
      }),
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    target: "es2015",
    outDir: path.resolve(__dirname, "../server/public"),
    emptyOutDir: true,
  },
}));