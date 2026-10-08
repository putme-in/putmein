/** Ordered, deterministic framework signatures. Specific frameworks precede runtimes.
 * Add a definition here to extend detection and setup choices without using AI.
 * Commands are suggestions for review, never executed during detection.
 */
export interface FrameworkDefinition {
  slug: string;
  name: string;
  language: string;
  port: number;
  files?: string[];
  dependencies?: string[];
  manifestPatterns?: Record<string, string>;
  startCommand?: string;
}
export const FRAMEWORKS: FrameworkDefinition[] = [
  { slug: "nextjs", name: "Next.js", language: "JavaScript", port: 3000, dependencies: ["next"], startCommand: "npm start" },
  { slug: "nuxt", name: "Nuxt", language: "JavaScript", port: 3000, dependencies: ["nuxt"], startCommand: "node .output/server/index.mjs" },
  { slug: "sveltekit", name: "SvelteKit", language: "JavaScript", port: 3000, dependencies: ["@sveltejs/kit"] },
  { slug: "vue", name: "Vue", language: "JavaScript", port: 8080, dependencies: ["vue"] },
  { slug: "react", name: "React", language: "JavaScript", port: 8080, dependencies: ["react"] },
  { slug: "express", name: "Express", language: "JavaScript", port: 3000, dependencies: ["express"], startCommand: "npm start" },
  { slug: "fastify", name: "Fastify", language: "JavaScript", port: 3000, dependencies: ["fastify"], startCommand: "npm start" },
  { slug: "django", name: "Django", language: "Python", port: 8000, files: ["manage.py"], manifestPatterns: { "requirements.txt": "django", "pyproject.toml": "django" } },
  { slug: "fastapi", name: "FastAPI", language: "Python", port: 8000, manifestPatterns: { "requirements.txt": "fastapi", "pyproject.toml": "fastapi" } },
  { slug: "flask", name: "Flask", language: "Python", port: 8000, manifestPatterns: { "requirements.txt": "flask", "pyproject.toml": "flask" } },
  { slug: "laravel", name: "Laravel", language: "PHP", port: 80, files: ["artisan"], manifestPatterns: { "composer.json": "laravel/framework" } },
  { slug: "ruby", name: "Ruby / Rails", language: "Ruby", port: 3000, files: ["Gemfile"] },
  { slug: "go", name: "Go", language: "Go", port: 8080, files: ["go.mod"] },
  { slug: "rust", name: "Rust", language: "Rust", port: 8080, files: ["Cargo.toml"] },
  { slug: "java", name: "Java", language: "Java", port: 8080, files: ["pom.xml", "build.gradle", "build.gradle.kts"] },
  { slug: "php", name: "PHP", language: "PHP", port: 80, files: ["composer.json", "index.php"] },
  { slug: "python", name: "Python", language: "Python", port: 8000, files: ["requirements.txt", "pyproject.toml", "Pipfile", "setup.py"] },
  { slug: "node", name: "Node.js", language: "JavaScript", port: 3000, files: ["package.json"], startCommand: "npm start" },
  { slug: "static", name: "Static HTML", language: "HTML", port: 8080, files: ["index.html"] },
  { slug: "docker", name: "Docker", language: "Container", port: 3000, files: ["Dockerfile"] },
];

/** Production assumptions shown before deployment. Custom Dockerfiles take precedence. */
export const FRAMEWORK_TEMPLATE_NOTES: Record<string, string> = {
 nextjs: "Builds with your package manager and runs Next.js in production. Build-time secrets require a custom Dockerfile/secret integration.",
 nuxt: "Requires a Node server build producing .output/server/index.mjs.",
 sveltekit: "Configure @sveltejs/adapter-node with the default build directory.",
 react: "Builds dist (or build for Create React App) and serves it with nginx, including SPA fallback.",
 vue: "Requires a build script producing dist; nginx serves the SPA in production.",
 django: "Detects one <package>/wsgi.py. Include gunicorn in dependencies or provide your own start command.",
 fastapi: "Defaults to uvicorn main:app. Include uvicorn in dependencies; override the module when needed.",
 flask: "Defaults to gunicorn app:app. Include gunicorn in dependencies; override the module when needed.",
 python: "Requires a production start command and requirements.txt or an installable pyproject.toml.",
 rust: "Requires Cargo.lock and an explicit start command naming the release binary.",
 java: "Requires a Maven/Gradle wrapper and an explicit start command naming the built JAR. Uses Java 21.",
 ruby: "Uses bundle install and Rails production server when bin/rails exists. Other Ruby apps need a start command; native libraries may need a custom Dockerfile.",
 go: "Builds the root package into /out/server. Build overrides must produce that file; CGO/system libraries may need a custom Dockerfile.",
 php: "Serves the selected directory through Apache. Extra PHP extensions require a custom Dockerfile.",
 laravel: "Serves public through Apache with pdo_mysql. Configure APP_KEY, database, persistent storage and any extra extensions separately. No migrations run automatically.",
 docker: "Provide your own Dockerfile. Setup never rewrites custom Dockerfiles.",
};
