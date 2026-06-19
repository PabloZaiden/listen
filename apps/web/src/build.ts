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

await Bun.write(`${outDir}/service-worker`, Bun.file(`${sharedSrcDir}/web/service-worker.ts`));
await Bun.write(`${outDir}/manifest.webmanifest`, Bun.file(`${sharedSrcDir}/web/manifest.webmanifest`));
await Bun.$`mkdir -p ${outDir}/icons`.quiet();
for (const icon of ["listen-192.png", "listen-512.png", "apple-touch-icon.png"]) {
  await Bun.write(`${outDir}/icons/${icon}`, Bun.file(`${sharedSrcDir}/web/icons/${icon}`));
}

export {};
