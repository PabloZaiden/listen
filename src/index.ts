import { getWebAppServer } from "./server";

try {
  await getWebAppServer().start();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Fatal: ${message}`);
  process.exit(1);
}
