const workspaceDir = `${import.meta.dir}/..`;
const sharedSrcDir = `${workspaceDir}/../../src`;
const outDir = `${workspaceDir}/dist`;

await Bun.$`rm -rf ${outDir}`.quiet();
await Bun.$`mkdir -p ${outDir}`.quiet();

const result = await Bun.build({
  entrypoints: [`${sharedSrcDir}/index.html`],
  outdir: outDir,
  minify: true,
  sourcemap: "external",
  target: "browser",
});

if (!result.success) {
  for (const log of result.logs) {
    console.error(log);
  }
  process.exit(1);
}

export {};
