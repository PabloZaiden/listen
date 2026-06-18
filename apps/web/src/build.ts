await Bun.$`rm -rf ../../src/public/assets && mkdir -p ../../src/public/assets`;

const result = await Bun.build({
  entrypoints: ["../../src/web/main.tsx"],
  outdir: "../../src/public/assets",
  target: "browser",
  naming: {
    entry: "main.js",
    chunk: "[name]-[hash].js",
    asset: "[name].[ext]",
  },
});

if (!result.success) {
  for (const log of result.logs) {
    console.error(log);
  }
  process.exit(1);
}

export {};
