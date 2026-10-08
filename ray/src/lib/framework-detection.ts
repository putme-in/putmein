import fs from "fs";
import path from "path";
import { FRAMEWORKS } from "./framework-registry";

export function detectFramework(directory: string) {
  const read = (name: string) => {
    try {
      const file = path.join(directory, name);
      const stat = fs.lstatSync(file);
      if (!stat.isFile() || stat.size > 1024 * 1024) return "";
      return fs.readFileSync(file, "utf8");
    } catch { return ""; }
  };
  let dependencies: Record<string, unknown> = {};
  let scripts: Record<string, string> = {};
  let workspaces: unknown;
  try {
    const pkg = JSON.parse(read("package.json"));
    dependencies = { ...pkg.dependencies, ...pkg.devDependencies };
    scripts = pkg.scripts || {};
    workspaces = pkg.workspaces;
  } catch { /* Other runtimes do not have package.json. */ }
  const definition = FRAMEWORKS.find(entry =>
    entry.dependencies?.some(name => name in dependencies) ||
    entry.files?.some(name => fs.existsSync(path.join(directory, name))) ||
    Object.entries(entry.manifestPatterns || {}).some(([file, pattern]) =>
      read(file).toLowerCase().includes(pattern.toLowerCase()))
  );
  if (!definition) return null;
  return {
    ...definition,
    language: definition.language === "JavaScript" && fs.existsSync(path.join(directory, "tsconfig.json")) ? "TypeScript" : definition.language,
    startCommand: scripts.start ? "npm start" : definition.startCommand || "",
    isMonorepo: Boolean(workspaces || fs.existsSync(path.join(directory, "pnpm-workspace.yaml"))),
  };
}
