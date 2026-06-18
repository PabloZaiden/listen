const target = Bun.argv[2] ?? "all";

const testArgs = {
  all: ["test", "--max-concurrency=1"],
  backend: ["test", "--max-concurrency=1", "tests/api", "tests/integration"],
  frontend: ["test", "--max-concurrency=1", "tests/cli"],
}[target];

if (!testArgs) {
  console.error(`Unknown test target: ${target}`);
  process.exit(1);
}

const proc = Bun.spawn({ cmd: ["bun", ...testArgs], stdout: "inherit", stderr: "inherit", stdin: "inherit" });
process.exit(await proc.exited);
