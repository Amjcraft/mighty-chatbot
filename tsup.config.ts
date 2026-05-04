import { readFileSync } from "node:fs";
import { defineConfig } from "tsup";

const { dependencies = {}, peerDependencies = {} } = JSON.parse(
  readFileSync("./package.json", "utf-8")
);

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  splitting: false,
  clean: true,
  tsconfig: "tsconfig.json",
  external: [...Object.keys(dependencies), ...Object.keys(peerDependencies)],
});
