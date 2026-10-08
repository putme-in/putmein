---
title: Git Sources & Private Repositories
---

# Git sources and private repositories

The **Git** sidebar entry keeps the existing GitHub account browser and adds saved HTTPS Git sources. **Settings → Git sources** manages public repository bookmarks and private credentials. Saved sources open the same deployment setup used by uploads and GitHub. Preparing a repository downloads and detects source; it does not build or start the application.

## Use the flow

1. For a private external repository, save its HTTPS clone URL, a connection name, and the username/token required by its provider. Use a token with repository read access. No credentials belong in the URL. Public repositories can be saved without credentials or entered directly in deployment setup.
2. Choose **Set up deployment** from the Git page, or enter the URL in Deployments → New. Specify a branch or leave it blank to discover the remote default branch.
3. Choose **Prepare repository**, review the detected application and shared setup, then deploy.
4. Use **Run pipeline** to fetch a new commit later. Rebuild uses the existing source snapshot. External Git sources default to manual runs; GitHub account webhooks remain supported.
5. Edit a saved connection to rotate its token. A blank token field keeps the previous token. The repository URL is immutable in the editor; save a new source for a different repository. Removal leaves running applications alone but future private fetches require access credentials.

Private GitHub repositories can use the existing GitHub integration without a saved source. An explicitly saved Git source for the same repository takes precedence, including a public source that deliberately sends no credentials. Removing that saved source restores the normal GitHub integration fallback.

## Credential and network boundaries

- Connections are owner-scoped and matched to the exact canonical repository, not merely its host. `.git` suffixes and trailing slashes identify the same repository; GitHub repository identity is case-insensitive. Subgroup paths are supported.
- Records are encrypted using AES-256-GCM, with a key derived from `JWT_SECRET` using a separate Git-credential context. Authenticated encryption binds each record to its owner and repository ID. New files use mode `0600`; storage directories use `0700` on Unix.
- Credentials are never returned by the list/save APIs. They are supplied through the child Git process environment as a repository-scoped HTTP authorization header, not as command arguments, remote URLs, source proofs or setup fields. Raw Git stderr is not sent to application logs or browser errors.
- Git uses an isolated temporary home, ignores global/system Git configuration and credential helpers, disables hooks, rejects redirects and verifies TLS certificates. Only HTTPS transport is allowed. Process trace settings, proxy settings and platform secrets are not inherited.
- Every fetch resolves DNS and pins the selected address using Git's `http.curloptResolve`. Public destinations are allowed by default; loopback, private and reserved addresses are rejected. Git must support this option (verified before a fetch).
- For an intentional internal Git server, the operator may set `RAY_GIT_PRIVATE_HOSTS=git.internal.example,another.internal.example` in Ray's environment. Entries are exact hostnames without scheme, path or port. They permit private addresses for those hosts only; HTTPS certificate validation and address pinning still apply. Corporate HTTP proxies and custom CA configuration are not implemented by this path.

## Storage and recovery

The default connection store is `~/.ray/git-connections`; set `RAY_GIT_CONNECTIONS_DIR` to a persistent absolute directory to override it. Back up this directory and preserve `JWT_SECRET` securely. Changing the authentication secret makes existing records unreadable until the original key is restored; alternatively remove/recreate the connections. Encryption does not replace access control on the server account.

Records are written by atomic replacement. Multiple writers use last-completed-write behavior; this is not a distributed vault. No database migration is required. Existing GitHub integration storage is unchanged by this feature.

Prepared source lives under `<deployments-directory>/.git-setup`. Failed preparations are cleaned up; successful or abandoned preparations are retained pending the release-retention work. Source proofs expire after one hour and are bound to the signed-in user. CI/CD uses new `.releases` checkouts and the same credential resolver. GitHub standalone legacy webhook updates now use isolated `.webhook-releases` and stop on Git failure rather than deploying an old checkout.

GitHub webhooks match the repository and branch and restrict integration secrets to their owners. The explicit server-wide `GITHUB_WEBHOOK_SECRET` retains server-wide authorization. All managed deployment dispatches now enter the shared pre-build security gate; see [Security Rules](./security-rules.md).

## Current limits

HTTPS username/token authentication is supported; SSH keys, interactive authentication, client certificates, submodules and Git LFS downloads are not. Clone operations are shallow and have a 90-second timeout; default-branch discovery has a separate 30-second timeout. Use the final canonical clone URL because redirects are disabled.

External GitLab/Bitbucket/self-hosted webhook handlers and scheduled Git polling remain future work. There is no external-provider account-wide repository browser: saved sources are listed by repository. Guided chat setup also remains separate; enter credentials in Settings rather than chat.

## Contributor file map

| File | Responsibility |
| --- | --- |
| `ray/src/lib/git-url.ts` | HTTPS validation, repository identity and URL redaction |
| `ray/src/lib/git-connections.ts` | Owner-scoped encrypted connection storage and rotation |
| `ray/src/lib/git-source.ts` | Shared checkout, scoped authentication and network restrictions |
| `ray/app/api/git/connections/route.ts` | Authenticated list/save/remove API; never returns tokens |
| `ray/app/api/deploy/prepare-git/route.ts` | Isolated source preparation and signed proof |
| `ray/app/api/deploy/prepare-github/route.ts` | Compatibility route to shared preparation |
| `ray/src/lib/prepared-source.ts` | User-bound, expiring source proof |
| `ray/src/components/GitConnections.tsx` | Settings editor and saved-source list |
| `ray/src/lib/cicd-runner.ts` | Uses shared Git checkout before the existing security/deploy steps |
| `ray/src/lib/cicd-sync.ts` | Registers credential-free HTTPS origins as pipelines |
| `ray/app/api/webhooks/github/route.ts` | GitHub owner/repository matching and legacy checkout handling |
| `ray/scripts/git-sources.test.mjs` | Isolated credential, URL and network-policy regression checks |

## Manual review

Prepare a public external repository and a private repository, deploy after reviewing setup, then run CI/CD after a new commit. Rotate the token and repeat. Verify a wrong token/branch fails without exposing credentials, another user cannot list or use the source, and removing credentials leaves the running app intact. Recheck a private GitHub repository through the existing account connection.

Verification for this stage uses TypeScript checking, focused isolated credential/network tests and the documentation build. No real repository credentials, live private clones, application deployments or pushes were used for verification.
