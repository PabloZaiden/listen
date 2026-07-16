export interface CliCommandResult {
  exitCode: number;
  output?: string;
  error?: string;
}

export function readOption(args: string[], names: string[]): string | undefined {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg) {
      continue;
    }
    for (const name of names) {
      if (arg === name) {
        return args[index + 1];
      }
      if (arg.startsWith(`${name}=`)) {
        return arg.slice(name.length + 1);
      }
    }
  }
  return undefined;
}

export function hasFlag(args: string[], names: string[]): boolean {
  return args.some((arg) => names.includes(arg));
}
