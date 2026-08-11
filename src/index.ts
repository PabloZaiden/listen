import { createListenCli } from "./cli";

try {
  process.exitCode = await createListenCli().run();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Fatal: ${message}`);
  process.exitCode = 1;
}
