import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach } from "bun:test";
import { closeDatabaseForTests, initializeDatabase } from "../src/persistence/database";
import { setBrowserPushSenderForTests } from "../src/core/browser-push";
import { setLogLevel } from "../src/core/logger";
import { DEFAULT_LOG_LEVEL } from "@listen/shared";

let dataDir: string;
let homeDir: string;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "listen-data-"));
  homeDir = mkdtempSync(join(tmpdir(), "listen-home-"));
  process.env["LISTEN_DATA_DIR"] = dataDir;
  process.env["HOME"] = homeDir;
  process.env["LISTEN_DISABLE_PASSKEY"] = "true";
  process.env["LISTEN_DISABLE_SAME_ORIGIN_CHECK"] = "true";
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
