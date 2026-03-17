import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    environment: "node",
    exclude: ["frontend/**", "node_modules/**"],
    setupFiles: ["./src/test-setup.ts"],
  },
});
