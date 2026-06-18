import { runUpdateCommand as runInstallerUpdateCommand } from "@pablozaiden/installer";
import { LISTEN_VERSION } from "../version";
import { hasFlag, readOption, type CliCommandResult } from "./runtime";

export async function runUpdateCommand(args: string[]): Promise<CliCommandResult> {
  const exitCode = await runInstallerUpdateCommand({
    checkOnly: hasFlag(args, ["--check"]),
    version: readOption(args, ["--version"]),
  }, {
    repository: "pablozaiden/listen",
    binaryName: "listen",
    currentVersion: LISTEN_VERSION,
    productName: "Listen",
    checksum: { required: true },
  });
  return { exitCode: typeof exitCode === "number" ? exitCode : 0 };
}
