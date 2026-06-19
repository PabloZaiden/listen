import React from "react";
import { LISTEN_VERSION } from "../version";

export function VersionLegend(): React.ReactElement {
  return <footer className="version-legend">listen {LISTEN_VERSION}</footer>;
}

