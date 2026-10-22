import esbuild from "esbuild";
import path from "node:path";

const root = process.cwd();
const sourceRoot = path.join(root, "src");

await esbuild.build({
  entryPoints: [path.join(root, "tests/frontend/routes.test.tsx")],
  bundle: true,
  platform: "node",
  format: "cjs",
  jsx: "automatic",
  outfile: path.join(root, "dist-test/routes.test.cjs"),
  external: ["node:test", "node:assert/strict"],
  plugins: [
    {
      name: "at-alias",
      setup(build) {
        build.onResolve({ filter: /^@\// }, async (args) => {
          const resolved = await build.resolve(`./${args.path.slice(2)}`, {
            resolveDir: sourceRoot,
            kind: args.kind,
          });
          return resolved;
        });
      },
    },
  ],
});
