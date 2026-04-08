function splitLines(text) {
  return String(text || "").replace(/\r\n/g, "\n").split("\n");
}

export function createLineDiff(beforeText, afterText) {
  const before = splitLines(beforeText);
  const after = splitLines(afterText);
  const max = Math.max(before.length, after.length);
  const lines = [];

  for (let index = 0; index < max; index += 1) {
    const beforeLine = before[index] ?? "";
    const afterLine = after[index] ?? "";
    if (beforeLine === afterLine) {
      lines.push({ type: "same", before: beforeLine, after: afterLine });
      continue;
    }
    if (beforeLine) {
      lines.push({ type: "removed", before: beforeLine, after: "" });
    }
    if (afterLine) {
      lines.push({ type: "added", before: "", after: afterLine });
    }
  }

  return lines;
}
