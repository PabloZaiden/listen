import { runMain } from "./entrypoint";

const exitCode = await runMain(Bun.argv.slice(2));
if (exitCode !== undefined) {
  process.exit(exitCode);
}
