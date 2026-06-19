const targetArg = Bun.argv.find((arg) => arg.startsWith("--target="));
const target = targetArg?.slice("--target=".length);
const releaseTarget = target?.startsWith("bun-") ? target.slice("bun-".length) : target;
const outfile = releaseTarget ? `dist/listen-${releaseTarget}` : "dist/listen";

await Bun.$`mkdir -p dist`;

const result = await Bun.build({
  entrypoints: ["src/index.ts"],
  target: "bun",
  minify: true,
  sourcemap: "external",
  compile: target ? { target: target as "bun-linux-x64", outfile } : { outfile },
});

if (!result.success) {
  for (const log of result.logs) {
    console.error(log);
  }
  process.exit(1);
}

export {};
