/** Cross-platform: macOS (open), Linux (xdg-open), Windows (start). */
export async function open(url: string): Promise<boolean> {
  const commands: Record<string, string[]> = {
    darwin: ["open", url],
    linux: ["xdg-open", url],
    win32: ["cmd", "/c", "start", url],
  };

  const cmd = commands[process.platform];
  if (!cmd) return false;

  try {
    const proc = Bun.spawn(cmd);
    await proc.exited;
    return true;
  } catch {
    return false;
  }
}
