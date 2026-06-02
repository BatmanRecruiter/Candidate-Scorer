import { build as esbuild } from "esbuild";
import { build as viteBuild } from "vite";
import { rm, readFile } from "node:fs/promises";

// Server deps to bundle into the CJS output to reduce cold-start openat(2)
// syscalls. Only list packages that are actually imported by server code.
// Large/native packages (googleapis, mammoth, pdf-parse, word-extractor,
// @anthropic-ai/sdk) are kept external so Node loads them from node_modules.
const allowlist = [
  "date-fns",
  "drizzle-orm",
  "drizzle-zod",
  "express",
  "helmet",
  "multer",
  "nanoid",
  "postgres",
  "ws",
  "zod",
];

async function buildAll() {
  await rm("dist", { recursive: true, force: true });

  console.log("building client...");
  await viteBuild();

  console.log("building server...");
  const pkg = JSON.parse(await readFile("package.json", "utf-8"));
  const allDeps = [
    ...Object.keys(pkg.dependencies || {}),
    ...Object.keys(pkg.devDependencies || {}),
  ];
  const externals = allDeps.filter((dep) => !allowlist.includes(dep));

  await esbuild({
    entryPoints: ["server/index.ts"],
    platform: "node",
    bundle: true,
    format: "cjs",
    outfile: "dist/index.cjs",
    define: {
      "process.env.NODE_ENV": '"production"',
    },
    minify: true,
    external: externals,
    logLevel: "info",
  });
}

buildAll().catch((err) => {
  console.error(err);
  process.exit(1);
});
