import fs from "fs";
import { detectFramework } from "./framework-detection";
import path from "path";

export interface DetectedStack {
  framework: string; // e.g. "Next.js", "Python", "React / Vite", "Node.js", "FastAPI", "Go", "Rust"
  frameworkSlug: string; // e.g. "nextjs", "python", "react", "node", "fastapi", "go", "rust"
  language: string; // e.g. "TypeScript", "JavaScript", "Python", "Go", "Rust"
  hasDockerfile: boolean;
  icon: string; // Iconify icon identifier (e.g. "logos:nextjs-icon", "logos:python", "logos:react")
  colorClasses: string; // Tailwind color styling for chip badge
}

/**
 * Returns Iconify icon and badge color styling for a given framework slug.
 */
export function getFrameworkVisuals(slug: string): { icon: string; colorClasses: string } {
  switch (slug.toLowerCase()) {
    case "nextjs":
    case "next.js":
    case "next":
      return {
        icon: "logos:nextjs-icon",
        colorClasses: "bg-white/[0.08] border-white/20 text-white",
      };
    case "python":
      return {
        icon: "logos:python",
        colorClasses: "bg-yellow-500/[0.08] border-yellow-500/20 text-yellow-300",
      };
    case "fastapi":
      return {
        icon: "logos:fastapi-icon",
        colorClasses: "bg-emerald-500/[0.08] border-emerald-500/20 text-emerald-300",
      };
    case "flask":
      return {
        icon: "logos:flask",
        colorClasses: "bg-slate-500/[0.08] border-slate-500/20 text-slate-300",
      };
    case "django":
      return {
        icon: "logos:django-icon",
        colorClasses: "bg-emerald-600/[0.08] border-emerald-600/20 text-emerald-300",
      };
    case "react":
    case "vite":
      return {
        icon: "logos:react",
        colorClasses: "bg-cyan-500/[0.08] border-cyan-500/20 text-cyan-300",
      };
    case "vue":
    case "nuxt":
      return {
        icon: "logos:vue",
        colorClasses: "bg-emerald-500/[0.08] border-emerald-500/20 text-emerald-300",
      };
    case "svelte":
    case "sveltekit":
      return {
        icon: "logos:svelte-icon",
        colorClasses: "bg-orange-500/[0.08] border-orange-500/20 text-orange-300",
      };
    case "node":
    case "nodejs":
      return {
        icon: "logos:nodejs-icon",
        colorClasses: "bg-emerald-500/[0.08] border-emerald-500/20 text-emerald-300",
      };
    case "express":
      return {
        icon: "skill-icons:expressjs-dark",
        colorClasses: "bg-white/[0.08] border-white/20 text-white/90",
      };
    case "fastify":
      return {
        icon: "logos:fastify-icon",
        colorClasses: "bg-white/[0.08] border-white/20 text-white",
      };
    case "hono":
      return {
        icon: "logos:hono",
        colorClasses: "bg-orange-500/[0.08] border-orange-500/20 text-orange-300",
      };
    case "bun":
      return {
        icon: "logos:bun",
        colorClasses: "bg-amber-500/[0.08] border-amber-500/20 text-amber-300",
      };
    case "go":
    case "golang":
      return {
        icon: "logos:go",
        colorClasses: "bg-sky-500/[0.08] border-sky-500/20 text-sky-300",
      };
    case "rust":
      return {
        icon: "logos:rust",
        colorClasses: "bg-orange-500/[0.08] border-orange-500/20 text-orange-300",
      };
    case "php":
      return {
        icon: "logos:php",
        colorClasses: "bg-indigo-500/[0.08] border-indigo-500/20 text-indigo-300",
      };
    case "ruby":
      return {
        icon: "logos:ruby",
        colorClasses: "bg-red-500/[0.08] border-red-500/20 text-red-300",
      };
    case "java":
      return {
        icon: "logos:java",
        colorClasses: "bg-amber-500/[0.08] border-amber-500/20 text-amber-300",
      };
    case "redis":
      return {
        icon: "logos:redis",
        colorClasses: "bg-red-500/[0.08] border-red-500/20 text-red-300",
      };
    case "postgres":
    case "postgresql":
      return {
        icon: "logos:postgresql",
        colorClasses: "bg-sky-600/[0.08] border-sky-600/20 text-sky-300",
      };
    case "mysql":
      return {
        icon: "logos:mysql",
        colorClasses: "bg-blue-500/[0.08] border-blue-500/20 text-blue-300",
      };
    case "mariadb":
      return {
        icon: "logos:mariadb-icon",
        colorClasses: "bg-teal-500/[0.08] border-teal-500/20 text-teal-300",
      };
    case "mongodb":
    case "mongo":
      return {
        icon: "logos:mongodb-icon",
        colorClasses: "bg-emerald-500/[0.08] border-emerald-500/20 text-emerald-300",
      };
    case "nginx":
      return {
        icon: "logos:nginx",
        colorClasses: "bg-emerald-600/[0.08] border-emerald-600/20 text-emerald-300",
      };
    case "wordpress":
    case "wp":
      return {
        icon: "logos:wordpress-icon",
        colorClasses: "bg-sky-600/[0.08] border-sky-600/20 text-sky-300",
      };
    case "laravel":
      return {
        icon: "logos:laravel",
        colorClasses: "bg-red-500/[0.08] border-red-500/20 text-red-300",
      };
    case "php":
      return {
        icon: "logos:php",
        colorClasses: "bg-indigo-500/[0.08] border-indigo-500/20 text-indigo-300",
      };
    default:
      return {
        icon: "logos:nodejs-icon",
        colorClasses: "bg-white/[0.04] border-white/[0.08] text-white/70",
      };
  }
}

/**
 * Inspects a project filesystem directory to identify the runtime stack,
 * framework, and language. Falls back to analyzing runCommand or memory text.
 */
export function detectProjectStack(
  projectPath?: string | null,
  fallbackMetadata?: {
    runCommand?: string | null;
    memory?: string | null;
    projectName?: string | null;
    containerImage?: string | null;
  }
): DetectedStack {
  if (projectPath) {
    const detected = detectFramework(projectPath);
    if (detected) return {
      framework: detected.name, frameworkSlug: detected.slug, language: detected.language,
      hasDockerfile: fs.existsSync(path.join(projectPath, "Dockerfile")),
      ...getFrameworkVisuals(detected.slug),
    };
  }
  let framework = "Unknown";
  let frameworkSlug = "unknown";
  let language = "Unknown";
  let hasDockerfile = false;

  const projName = (fallbackMetadata?.projectName || "").toLowerCase();
  const contImg = (fallbackMetadata?.containerImage || "").toLowerCase();
  const cmd = (fallbackMetadata?.runCommand || "").toLowerCase();
  const mem = (fallbackMetadata?.memory || "").toLowerCase();

  // Fast-path for WordPress / PHP from container image or project name
  if (
    contImg.includes("wordpress") ||
    projName.includes("wordpress") ||
    projName.startsWith("wp-") ||
    projName.endsWith("-wp") ||
    mem.includes("wordpress")
  ) {
    const visuals = getFrameworkVisuals("wordpress");
    return {
      framework: "WordPress",
      frameworkSlug: "wordpress",
      language: "PHP",
      hasDockerfile: true,
      ...visuals,
    };
  }

  if (projectPath && typeof projectPath === "string") {
    try {
      if (fs.existsSync(projectPath)) {
        // Check Dockerfile
        const dockerfilePath = path.join(projectPath, "Dockerfile");
        if (
          fs.existsSync(dockerfilePath) ||
          fs.existsSync(path.join(projectPath, "docker-compose.yml")) ||
          fs.existsSync(path.join(projectPath, "docker-compose.yaml"))
        ) {
          hasDockerfile = true;
          // Inspect Dockerfile content for WordPress / PHP / Nginx
          if (fs.existsSync(dockerfilePath)) {
            try {
              const dfContent = fs.readFileSync(dockerfilePath, "utf8").toLowerCase();
              if (dfContent.includes("wordpress") || dfContent.includes("from wordpress")) {
                const visuals = getFrameworkVisuals("wordpress");
                return {
                  framework: "WordPress",
                  frameworkSlug: "wordpress",
                  language: "PHP",
                  hasDockerfile: true,
                  ...visuals,
                };
              }
              if (dfContent.includes("laravel")) {
                const visuals = getFrameworkVisuals("laravel");
                return {
                  framework: "Laravel",
                  frameworkSlug: "laravel",
                  language: "PHP",
                  hasDockerfile: true,
                  ...visuals,
                };
              }
              if (dfContent.includes("php:")) {
                const visuals = getFrameworkVisuals("php");
                return {
                  framework: "PHP",
                  frameworkSlug: "php",
                  language: "PHP",
                  hasDockerfile: true,
                  ...visuals,
                };
              }
            } catch { /* silent */ }
          }
        }

        // WordPress filesystem checks
        if (
          fs.existsSync(path.join(projectPath, "wp-config.php")) ||
          fs.existsSync(path.join(projectPath, "wp-config-sample.php")) ||
          fs.existsSync(path.join(projectPath, "wp-content")) ||
          fs.existsSync(path.join(projectPath, "wp-login.php")) ||
          fs.existsSync(path.join(projectPath, "wp-includes"))
        ) {
          const visuals = getFrameworkVisuals("wordpress");
          return {
            framework: "WordPress",
            frameworkSlug: "wordpress",
            language: "PHP",
            hasDockerfile,
            ...visuals,
          };
        }

        // Laravel / PHP filesystem checks
        if (
          fs.existsSync(path.join(projectPath, "artisan")) ||
          (fs.existsSync(path.join(projectPath, "composer.json")) &&
            (() => {
              try {
                const cJson = fs.readFileSync(path.join(projectPath, "composer.json"), "utf8");
                return cJson.toLowerCase().includes("laravel");
              } catch { return false; }
            })())
        ) {
          const visuals = getFrameworkVisuals("laravel");
          return {
            framework: "Laravel",
            frameworkSlug: "laravel",
            language: "PHP",
            hasDockerfile,
            ...visuals,
          };
        }

        if (fs.existsSync(path.join(projectPath, "composer.json"))) {
          const visuals = getFrameworkVisuals("php");
          return {
            framework: "PHP",
            frameworkSlug: "php",
            language: "PHP",
            hasDockerfile,
            ...visuals,
          };
        }

        // 1. Next.js check
        if (
          fs.existsSync(/*turbopackIgnore: true*/ path.join(projectPath, "next.config.js")) ||
          fs.existsSync(/*turbopackIgnore: true*/ path.join(projectPath, "next.config.ts")) ||
          fs.existsSync(/*turbopackIgnore: true*/ path.join(projectPath, "next.config.mjs"))
        ) {
          framework = "Next.js";
          frameworkSlug = "nextjs";
          language = fs.existsSync(path.join(projectPath, "tsconfig.json"))
            ? "TypeScript"
            : "JavaScript";
          const visuals = getFrameworkVisuals(frameworkSlug);
          return { framework, frameworkSlug, language, hasDockerfile, ...visuals };
        }

        // 2. Python checks (FastAPI, Flask, Django, generic Python)
        if (
          fs.existsSync(path.join(projectPath, "requirements.txt")) ||
          fs.existsSync(path.join(projectPath, "Pipfile")) ||
          fs.existsSync(path.join(projectPath, "pyproject.toml")) ||
          fs.existsSync(path.join(projectPath, "setup.py"))
        ) {
          language = "Python";
          framework = "Python";
          frameworkSlug = "python";

          try {
            let reqText = "";
            if (fs.existsSync(path.join(projectPath, "requirements.txt"))) {
              reqText += fs.readFileSync(path.join(projectPath, "requirements.txt"), "utf8");
            }
            if (fs.existsSync(path.join(projectPath, "pyproject.toml"))) {
              reqText += fs.readFileSync(path.join(projectPath, "pyproject.toml"), "utf8");
            }
            const lowerReq = reqText.toLowerCase();
            if (lowerReq.includes("fastapi")) {
              framework = "FastAPI";
              frameworkSlug = "fastapi";
            } else if (lowerReq.includes("flask")) {
              framework = "Flask";
              frameworkSlug = "flask";
            } else if (lowerReq.includes("django")) {
              framework = "Django";
              frameworkSlug = "django";
            }
          } catch { /* silent */ }

          const visuals = getFrameworkVisuals(frameworkSlug);
          return { framework, frameworkSlug, language, hasDockerfile, ...visuals };
        }

        // 3. Go check
        if (fs.existsSync(path.join(projectPath, "go.mod"))) {
          const visuals = getFrameworkVisuals("go");
          return {
            framework: "Go",
            frameworkSlug: "go",
            language: "Go",
            hasDockerfile,
            ...visuals,
          };
        }

        // 4. Rust check
        if (fs.existsSync(path.join(projectPath, "Cargo.toml"))) {
          const visuals = getFrameworkVisuals("rust");
          return {
            framework: "Rust",
            frameworkSlug: "rust",
            language: "Rust",
            hasDockerfile,
            ...visuals,
          };
        }

        // 5. Node.js & React / Vite / Nuxt / Express check
        if (fs.existsSync(path.join(projectPath, "package.json"))) {
          try {
            const pkgRaw = fs.readFileSync(path.join(projectPath, "package.json"), "utf8");
            const pkg = JSON.parse(pkgRaw);
            const deps = { ...pkg.dependencies, ...pkg.devDependencies };

            const isTS = fs.existsSync(path.join(projectPath, "tsconfig.json"));
            language = isTS ? "TypeScript" : "JavaScript";

            if (deps["next"]) {
              framework = "Next.js";
              frameworkSlug = "nextjs";
            } else if (deps["vite"] || deps["@vitejs/plugin-react"] || deps["react-scripts"]) {
              framework = "React";
              frameworkSlug = "react";
            } else if (deps["nuxt"] || deps["vue"]) {
              framework = "Vue";
              frameworkSlug = "vue";
            } else if (deps["@sveltejs/kit"] || deps["svelte"]) {
              framework = "Svelte";
              frameworkSlug = "svelte";
            } else if (deps["express"]) {
              framework = "Express";
              frameworkSlug = "express";
            } else if (deps["fastify"]) {
              framework = "Fastify";
              frameworkSlug = "fastify";
            } else if (deps["hono"]) {
              framework = "Hono";
              frameworkSlug = "hono";
            } else {
              framework = "Node.js";
              frameworkSlug = "node";
            }

            const visuals = getFrameworkVisuals(frameworkSlug);
            return { framework, frameworkSlug, language, hasDockerfile, ...visuals };
          } catch {
            const visuals = getFrameworkVisuals("node");
            return { framework: "Node.js", frameworkSlug: "node", language: "JavaScript", hasDockerfile, ...visuals };
          }
        }
      }
    } catch {
      // Fall through to metadata fallback
    }
  }

  // Fallback check from memory, project name, or runCommand
  if (cmd.includes("next") || mem.includes("next.js") || mem.includes("nextjs")) {
    framework = "Next.js";
    frameworkSlug = "nextjs";
    language = "TypeScript";
  } else if (cmd.includes("python") || cmd.includes("uvicorn") || cmd.includes("gunicorn") || mem.includes("python")) {
    framework = "Python";
    frameworkSlug = "python";
    language = "Python";
    if (cmd.includes("uvicorn") || mem.includes("fastapi")) {
      framework = "FastAPI";
      frameworkSlug = "fastapi";
    }
  } else if (cmd.includes("go run") || mem.includes("golang")) {
    framework = "Go";
    frameworkSlug = "go";
    language = "Go";
  } else if (cmd.includes("cargo") || mem.includes("rust")) {
    framework = "Rust";
    frameworkSlug = "rust";
    language = "Rust";
  } else if (cmd.includes("artisan") || mem.includes("laravel")) {
    framework = "Laravel";
    frameworkSlug = "laravel";
    language = "PHP";
  } else if (cmd.includes("php") || mem.includes("php")) {
    framework = "PHP";
    frameworkSlug = "php";
    language = "PHP";
  } else if (hasDockerfile) {
    framework = "Docker";
    frameworkSlug = "docker";
    language = "Container";
  }

  const visuals = getFrameworkVisuals(frameworkSlug);
  return { framework, frameworkSlug, language, hasDockerfile, ...visuals };
}

/**
 * Infers framework and stack for a Docker container based on its image, name, or project metadata.
 */
export function detectContainerStack(
  container: { name?: string; image?: string },
  linkedProject?: { projectPath?: string | null; memory?: string | null; runCommand?: string | null; projectName?: string | null }
): DetectedStack {
  if (linkedProject?.projectPath) {
    const fromProj = detectProjectStack(linkedProject.projectPath, {
      memory: linkedProject.memory,
      runCommand: linkedProject.runCommand,
      projectName: linkedProject.projectName,
      containerImage: container.image,
    });
    return fromProj;
  }

  const img = (container.image || "").toLowerCase();
  const name = (container.name || "").toLowerCase();

  let slug = "docker";
  let framework = "Docker";
  let language = "Container";

  if (img.includes("wordpress") || name.includes("wordpress") || name.startsWith("ray-wp-") || name.startsWith("wp-")) {
    slug = "wordpress";
    framework = "WordPress";
    language = "PHP";
  } else if (img.includes("laravel") || name.includes("laravel")) {
    slug = "laravel";
    framework = "Laravel";
    language = "PHP";
  } else if (img.includes("php") || name.includes("php")) {
    slug = "php";
    framework = "PHP";
    language = "PHP";
  } else if (img.includes("next") || name.includes("next")) {
    slug = "nextjs";
    framework = "Next.js";
    language = "TypeScript";
  } else if (img.includes("python") || img.includes("fastapi") || img.includes("flask") || img.includes("django")) {
    language = "Python";
    if (img.includes("fastapi") || name.includes("fastapi")) {
      slug = "fastapi";
      framework = "FastAPI";
    } else if (img.includes("flask") || name.includes("flask")) {
      slug = "flask";
      framework = "Flask";
    } else if (img.includes("django") || name.includes("django")) {
      slug = "django";
      framework = "Django";
    } else {
      slug = "python";
      framework = "Python";
    }
  } else if (img.includes("node") || img.includes("express") || name.includes("node")) {
    slug = "node";
    framework = "Node.js";
    language = "JavaScript";
  } else if (img.includes("react") || img.includes("vite")) {
    slug = "react";
    framework = "React";
    language = "JavaScript";
  } else if (img.includes("golang") || img.includes("go:") || name.includes("go-")) {
    slug = "go";
    framework = "Go";
    language = "Go";
  } else if (img.includes("rust") || name.includes("rust")) {
    slug = "rust";
    framework = "Rust";
    language = "Rust";
  } else if (img.includes("redis")) {
    slug = "redis";
    framework = "Redis";
    language = "Database";
  } else if (img.includes("postgres")) {
    slug = "postgres";
    framework = "PostgreSQL";
    language = "Database";
  } else if (img.includes("mysql")) {
    slug = "mysql";
    framework = "MySQL";
    language = "Database";
  } else if (img.includes("mariadb")) {
    slug = "mariadb";
    framework = "MariaDB";
    language = "Database";
  } else if (img.includes("mongo")) {
    slug = "mongodb";
    framework = "MongoDB";
    language = "Database";
  } else if (img.includes("nginx")) {
    slug = "nginx";
    framework = "Nginx";
    language = "Web Server";
  }

  const visuals = getFrameworkVisuals(slug);
  return { framework, frameworkSlug: slug, language, hasDockerfile: true, ...visuals };
}

