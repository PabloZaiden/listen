const scriptName = Bun.argv[2];

if (!scriptName) {
  console.error("Usage: bun scripts/run-workspace-script.ts <script>");
  process.exit(1);
}

const workspaceGlobs = ["apps/*/package.json", "packages/*/package.json"];
const packageFiles = (await Promise.all(workspaceGlobs.map((glob) => Array.fromAsync(new Bun.Glob(glob).scan("."))))).flat();

for (const packageFile of packageFiles.sort()) {
  const manifest = await Bun.file(packageFile).json() as { scripts?: Record<string, string> };
  if (!manifest.scripts?.[scriptName]) {
    continue;
  }

  const cwd = packageFile.slice(0, -"package.json".length);
  const proc = Bun.spawn({
    cmd: ["bun", "run", scriptName],
    cwd,
    stdout: "inherit",
    stderr: "inherit",
    stdin: "inherit",
  });
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    process.exit(exitCode);
  }
}
