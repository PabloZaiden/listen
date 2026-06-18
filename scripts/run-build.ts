const steps = [
  ["bun", "run", "build:workspaces"],
  ["bun", "run", "tsc"],
] as const;

for (const cmd of steps) {
  const proc = Bun.spawn({ cmd: [...cmd], stdout: "inherit", stderr: "inherit", stdin: "inherit" });
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    process.exit(exitCode);
  }
}
