declare const LISTEN_BINARY_BUILD: boolean | undefined;

function isListenBinaryBuild(): boolean {
  return typeof LISTEN_BINARY_BUILD !== "undefined" && LISTEN_BINARY_BUILD;
}

export function resolveServerDevelopmentMode(nodeEnv: string | undefined, binaryBuild: boolean): boolean {
  if (nodeEnv !== undefined) {
    return nodeEnv !== "production";
  }
  return !binaryBuild;
}

export function isServerDevelopmentMode(): boolean {
  return resolveServerDevelopmentMode(process.env["NODE_ENV"], isListenBinaryBuild());
}
