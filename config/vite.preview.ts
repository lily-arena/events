import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
const workspace = fileURLToPath(new URL("../", import.meta.url));
export default defineConfig({
  root: workspace + "apps/preview",
  publicDir: workspace + "packages/ui/assets",
  plugins: [
    react(),
    {
      name: "no-public-root",
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          if ((req.url ?? "").split("?")[0] === "/") {
            res.statusCode = 404;
            res.end();
            return;
          }
          next();
        });
      },
    },
  ],
  server: {
    host: "127.0.0.1",
    port: 5190,
    strictPort: true,
    proxy: { "/api/events": "http://127.0.0.1:8792", "/api/admin": "http://127.0.0.1:8791" },
    fs: { allow: [workspace] },
  },
  build: { outDir: workspace + "dist/preview", emptyOutDir: true },
});
