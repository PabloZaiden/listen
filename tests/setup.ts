import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach } from "bun:test";
import { DEFAULT_LOG_LEVEL, setLogLevel } from "@pablozaiden/webapp/server";
import { closeDatabaseForTests, initializeDatabase } from "../src/persistence/database";
import { setBrowserPushSenderForTests } from "../src/core/browser-push";

let dataDir: string;
let homeDir: string;

beforeEach(() => {
  mkdirSync(".cache/tests", { recursive: true });
  dataDir = mkdtempSync(join(process.cwd(), ".cache/tests/listen-data-"));
  homeDir = mkdtempSync(join(process.cwd(), ".cache/tests/listen-home-"));
  process.env["LISTEN_DATA_DIR"] = dataDir;
  process.env["HOME"] = homeDir;
  delete process.env["LISTEN_LOG_LEVEL"];
  initializeDatabase(dataDir);
});

afterEach(() => {
  setBrowserPushSenderForTests();
  setLogLevel(DEFAULT_LOG_LEVEL);
  closeDatabaseForTests();
  delete process.env["LISTEN_WEBHOOK_URL"];
  delete process.env["LISTEN_LOG_LEVEL"];
  rmSync(dataDir, { recursive: true, force: true });
  rmSync(homeDir, { recursive: true, force: true });
});
