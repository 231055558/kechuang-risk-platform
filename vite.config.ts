import { realpathSync } from "node:fs"
import path from "path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

const projectRoot = __dirname
const dependencyRoot = realpathSync(path.resolve(projectRoot, "node_modules"))
const apiPort = process.env.API_PORT ?? "5001"
// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  if (mode === "server") {
    return {
      build: {
        ssr: "server/production-server.ts",
        outDir: "dist/server",
        emptyOutDir: false,
        target: "node20",
        rolldownOptions: {
          output: {
            entryFileNames: "production-server.js",
          },
        },
      },
    }
  }

  return {
    base: "./",
    plugins: [react(), tailwindcss()],
    server: {
      fs: {
        allow: [projectRoot, dependencyRoot],
      },
      proxy: {
        "/api": {
          target: `http://127.0.0.1:${apiPort}`,
        },
      },
    },
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
    build: {
      rolldownOptions: {
        output: {
          codeSplitting: {
            maxSize: 400_000,
            groups: [
              {
                name: "enterprise-research-data",
                test: /src[\\/]data[\\/]company-research-highlights\.json$/,
                priority: 30,
              },
              {
                name: "snapshot-data",
                test: /src[\\/]data[\\/]/,
                priority: 20,
              },
              {
                name: "liquid-glass",
                test: /node_modules[\\/]liquid-glass-react[\\/]/,
                priority: 20,
                includeDependenciesRecursively: false,
              },
            ],
          },
        },
      },
    },
  }
})
