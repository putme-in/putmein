export interface GithubRepoValidationResult {
  valid: boolean;
  error?: string;
  normalizedUrl?: string;
  owner?: string;
  repo?: string;
}

const RESERVED_GITHUB_NAMES = new Set([
  "settings", "apps", "login", "features", "marketplace", "orgs",
  "explore", "topics", "collections", "trending", "events", "about",
  "contact", "pricing", "security", "customer-stories", "readme",
  "site", "dashboard", "new", "organizations", "notifications",
]);

/**
 * Validates that an input string is a valid GitHub repository URL.
 *
 * Supported formats:
 * - https://github.com/owner/repository
 * - https://github.com/owner/repository.git
 * - http://github.com/owner/repository
 * - github.com/owner/repository
 * - git@github.com:owner/repository.git
 * - git@github.com:owner/repository
 * - ssh://git@github.com/owner/repository.git
 */
export function validateGithubRepoUrl(input: unknown): GithubRepoValidationResult {
  if (typeof input !== "string" || !input.trim()) {
    return {
      valid: false,
      error: "GitHub repository URL is required",
    };
  }

  const trimmed = input.trim();

  // Reject shell command injection characters, whitespace, newlines, control characters
  if (/[\s;`$|&><\\]/.test(trimmed)) {
    return {
      valid: false,
      error: "Repository URL contains invalid characters or whitespace",
    };
  }

  // Check if non-GitHub host is entered
  const genericUrlMatch = trimmed.match(/^https?:\/\/([^/]+)/i);
  if (genericUrlMatch && !/(?:^|\.)github\.com$/i.test(genericUrlMatch[1])) {
    return {
      valid: false,
      error: `Unsupported repository host "${genericUrlMatch[1]}". Only GitHub repositories are supported.`,
    };
  }

  let owner = "";
  let repo = "";

  const httpsMatch = trimmed.match(/^(?:https?:\/\/)?(?:www\.)?github\.com\/([^\/\s?#]+)\/([^\/\s?#]+?)(?:\.git|\/)?(?:[?#].*)?$/i);
  const sshMatch = trimmed.match(/^git@github\.com:([^\/\s?#]+)\/([^\/\s?#]+?)(?:\.git|\/)?$/i);
  const sshProtocolMatch = trimmed.match(/^ssh:\/\/git@github\.com\/([^\/\s?#]+)\/([^\/\s?#]+?)(?:\.git|\/)?$/i);

  if (httpsMatch) {
    owner = httpsMatch[1];
    repo = httpsMatch[2];
  } else if (sshMatch) {
    owner = sshMatch[1];
    repo = sshMatch[2];
  } else if (sshProtocolMatch) {
    owner = sshProtocolMatch[1];
    repo = sshProtocolMatch[2];
  } else {
    // Detailed feedback for common malformed GitHub URL mistakes
    if (/github\.com/i.test(trimmed)) {
      if (/github\.com\/?$/i.test(trimmed)) {
        return {
          valid: false,
          error: "URL is missing repository owner and name (expected https://github.com/owner/repository)",
        };
      }
      if (/github\.com\/[^\/]+\/?$/i.test(trimmed)) {
        return {
          valid: false,
          error: "URL is missing repository name (expected https://github.com/owner/repository)",
        };
      }
      if (/(?:\/blob\/|\/tree\/|\/pull\/|\/commits?\/|\/releases\/)/i.test(trimmed)) {
        return {
          valid: false,
          error: "Please enter the root repository URL, not a file, branch, or pull request URL",
        };
      }
      return {
        valid: false,
        error: "Malformed GitHub repository URL. Expected format: https://github.com/owner/repository",
      };
    }

    return {
      valid: false,
      error: "Invalid repository URL. Please enter a valid GitHub repository URL (e.g. https://github.com/owner/repository)",
    };
  }

  // Validate GitHub owner (username / org: 1-39 chars, alphanumeric and single hyphens, no leading/trailing hyphen)
  if (!/^[a-zA-Z0-9](?:[a-zA-Z0-9]|-(?=[a-zA-Z0-9])){0,38}$/.test(owner)) {
    return {
      valid: false,
      error: `Invalid GitHub owner or organization name: "${owner}"`,
    };
  }

  if (RESERVED_GITHUB_NAMES.has(owner.toLowerCase())) {
    return {
      valid: false,
      error: `"${owner}" is a reserved GitHub system path, not a user or organization repository`,
    };
  }

  // Clean trailing .git if present
  const cleanRepo = repo.replace(/\.git$/i, "");

  // Validate GitHub repository name (1-100 characters, alphanumeric, hyphens, underscores, dots)
  if (!cleanRepo || cleanRepo === "." || cleanRepo === ".." || !/^[a-zA-Z0-9_.-]{1,100}$/.test(cleanRepo)) {
    return {
      valid: false,
      error: `Invalid GitHub repository name: "${cleanRepo}"`,
    };
  }

  const normalizedUrl = `https://github.com/${owner}/${cleanRepo}`;

  return {
    valid: true,
    normalizedUrl,
    owner,
    repo: cleanRepo,
  };
}
