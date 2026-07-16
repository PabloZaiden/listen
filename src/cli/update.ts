import { runUpdateCommand as runInstallerUpdateCommand } from "@pablozaiden/installer";
import { hasFlag, readOption, type CliCommandResult } from "@pablozaiden/webapp/cli";
import { LISTEN_VERSION } from "../version";

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
