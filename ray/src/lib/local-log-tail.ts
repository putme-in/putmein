import fs from "node:fs/promises";
import path from "node:path";

const MAX_BYTES = 2 * 1024 * 1024;

async function readEnd(filename: string, budget: number): Promise<Buffer> {
  const before = await fs.lstat(filename);
  if (!before.isFile()) throw new Error("Log segment is not a regular file");
  const handle = await fs.open(filename, "r");
  try {
    const info = await handle.stat();
    if (before.ino !== info.ino || before.dev !== info.dev) throw new Error("Log changed while opening");
    const length = Math.min(info.size, budget);
    const buffer = Buffer.alloc(length);
    let read = 0;
    while (read < length) {
      const result = await handle.read(buffer, read, length - read, info.size - length + read);
      if (!result.bytesRead) break;
      read += result.bytesRead;
    }
    return buffer.subarray(0, read);
  } finally {
    await handle.close();
  }
}

// Supports legacy files and the collector's logical .log directory while keeping
// the offline dashboard fallback bounded, including for very large legacy files.
export async function readLocalLogTail(filename: string, lines: number): Promise<string> {
  const info = await fs.lstat(filename);
  let data: Buffer;
  if (info.isDirectory()) {
    const metadata = path.join(filename, "format.json");
    const metaInfo = await fs.lstat(metadata);
    if (!metaInfo.isFile() || metaInfo.size > 1024) throw new Error("Invalid managed log format");
    const format = JSON.parse(await fs.readFile(metadata, "utf8"));
    if (format.format !== "ray-host-logs-v1") throw new Error("Unknown managed log format");
    const names = (await fs.readdir(filename)).filter(name => /^\d{20}\.log$/.test(name)).sort().reverse();
    const chunks: Buffer[] = [];
    let remaining = MAX_BYTES;
    for (const name of names) {
      const chunk = await readEnd(path.join(filename, name), remaining);
      chunks.unshift(chunk);
      remaining -= chunk.length;
      if (remaining === 0) break;
    }
    data = Buffer.concat(chunks);
  } else {
    data = await readEnd(filename, MAX_BYTES);
  }
  const count = Math.max(1, Math.min(10000, Number.isFinite(lines) ? Math.floor(lines) : 100));
  return data.toString("utf8").replace(/\r\n/g, "\n").replace(/\n$/, "").split("\n").slice(-count).join("\n");
}
