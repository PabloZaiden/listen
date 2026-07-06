import { buildWebAppBinary, getBunCompileTargetFromArgs } from "@pablozaiden/webapp/build";

const target = getBunCompileTargetFromArgs();
const releaseTarget = target?.startsWith("bun-") ? target.slice("bun-".length) : target;
const outfile = releaseTarget ? `dist/listen-${releaseTarget}` : "dist/listen";

await buildWebAppBinary({
  entrypoint: "src/index.ts",
  outfile,
  target,
  define: {
    LISTEN_BINARY_BUILD: "true",
  },
});
