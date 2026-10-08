import fs from "fs";
import path from "path";

/** Resolve a selected app inside a source tree, including symlink containment. */
export function resolveProjectSource(sourceRoot: unknown, appDirectory: unknown = ".") {
  if (typeof sourceRoot !== "string" || !path.isAbsolute(sourceRoot)) {
    throw new Error("Choose an absolute project directory on the server.");
  }
  if (typeof appDirectory !== "string" || path.isAbsolute(appDirectory) || appDirectory.includes("\0")) {
    throw new Error("Application directory must be relative to the source directory.");
  }
  const root = fs.realpathSync(sourceRoot);
  const selected = fs.realpathSync(path.resolve(root, appDirectory || "."));
  const relative = path.relative(root, selected);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error("Application directory must stay inside the source directory.");
  }
  if (!fs.statSync(selected).isDirectory()) throw new Error("Choose a directory, not a file.");
  return { sourceRoot: root, projectPath: selected, appDirectory: relative.split(path.sep).join("/") || "." };
}
