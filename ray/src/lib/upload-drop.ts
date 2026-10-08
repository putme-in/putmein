/** Resolve directory drops into readable files; directory placeholders cannot be uploaded. */
export async function readDroppedFiles(entries: FileSystemEntry[]): Promise<File[]> {
  const files: File[] = [];
  const walk = async (entry: FileSystemEntry, prefix: string, depth: number): Promise<void> => {
    if (depth > 50) throw new Error("Folder nesting exceeds 50 levels.");
    const relativePath = `${prefix}${entry.name}`;
    if (entry.isFile) {
      const file = await new Promise<File>((resolve, reject) =>
        (entry as FileSystemFileEntry).file(resolve, reject));
      if (files.length >= 10000) throw new Error("Select a folder with fewer than 10,000 files. Exclude dependencies and build output.");
      Object.defineProperty(file, "webkitRelativePath", { value: relativePath });
      files.push(file);
    } else if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      // Chromium returns entries in batches, not necessarily the entire directory.
      while (true) {
        const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));
        if (!batch.length) break;
        for (const child of batch) await walk(child, `${relativePath}/`, depth + 1);
      }
    }
  };
  for (const entry of entries) await walk(entry, "", 0);
  return files;
}
