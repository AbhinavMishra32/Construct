import type { AnchorLocation } from "../types";

export function findAnchorLocation(
  content: string,
  marker: string
): AnchorLocation | null {
  const lines = content.split("\n");

  for (const [index, line] of lines.entries()) {
    const startColumn = line.indexOf(marker);

    if (startColumn >= 0) {
      return {
        marker,
        lineNumber: index + 1,
        startColumn: startColumn + 1,
        endColumn: startColumn + marker.length + 1
      };
    }
  }

  return null;
}

