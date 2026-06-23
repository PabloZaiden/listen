import { runMain } from "./entrypoint";

try {
  const exitCode = await runMain(Bun.argv.slice(2));
  if (exitCode !== undefined) {
    process.exit(exitCode);
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Fatal: ${message}`);
  process.exit(1);
}
