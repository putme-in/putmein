---
id: chat-deployment
title: Chat Deployment Setup
slug: /developer/chat-deployment
---

# Chat Deployment Setup

When asked to deploy a repository or server folder, the assistant requests an inline **Review deployment setup** card. Opening a card does not clone, deploy or register monitoring. Select **Open setup**, prepare the source, review the settings and explicitly deploy.

The same `DeploymentWizard` powers this card and Deployments → New deployment. It supports Git preparation, ZIP/folder uploads, and analysis of a proposed absolute server path. Framework detection, application-directory selection, Docker/host execution, ports, domain/HTTPS, health checks, commands, environment variables and pipeline logs use the existing deployment APIs. Existing source validation and deployment security gates still apply.

Advanced fields are expanded in chat. Submission requires a review checkbox; changing a setup field clears it. The form collects choices without sending field values back to the language model. Git sources resolve saved credentials through the preparation API. **Private Git connection** exposes the existing dedicated connection editor inside the card; tokens are not copied into chat messages. Runtime values are masked in the form. Users should never paste credentials into ordinary chat: existing chat messages are still saved normally.

## Server behavior

`<deploy name="suggested-name" path="/absolute/path-or-https-url">` now produces a `deployment_setup` event containing a structured proposal. The tool does not call the deployment engine. The agent turn ends after the proposal, including in autonomous mode, so it cannot continue that deployment action before review. Opening setup is a read-only action and does not require the previous shell permission prompt.

The chat runner no longer retrieves or forwards GitHub access tokens for shell-command injection. Private source access belongs to the deployment preparation service. The prompt also instructs the assistant not to bypass setup through shell deployment commands. General-purpose shell tools retain their existing permissions; this is not a new shell sandbox or a general restriction on separately requested administration commands.

After explicit submission the normal deployment API creates deployment/project records, runs security and health checks, and registers monitoring. The inline wizard displays pipeline progress and success/failure. The card synchronizes a sanitized status summary into the conversation. The next user message includes that summary in model context; synchronization does not automatically start a new agent turn.

## State and compatibility

Chat history retains the setup proposal and a server-verified deployment summary. Non-secret draft choices are saved separately in browser local storage, scoped to the session and proposal: project name, ports, framework, Docker mode, application directory and a credential-free domain origin/routing mode. Commands, environment values, credentials, source proofs and health settings are not stored in the draft. Re-enter those values, prepare the source again and review before deployment. A restored application directory must be analyzed against the prepared source before submission.

Once the deployment response supplies its ID, the browser retains that association. Reopening the card shows the existing deployment instead of a fresh deploy form. This recovery is browser-local, not cross-device; clearing browser storage removes it. If a tab closes before receiving the deployment ID, check Deployments before retrying. Local drafts never authorize deployment and are validated before use.

While the card is open, it synchronizes status every ten seconds until the deployment is healthy, failed or stopped. Reopening the card resynchronizes. The result endpoint verifies ownership of both the chat and deployment and derives status from the database. One stable message per chat/deployment is updated idempotently. It includes only a known status and deployment link, excluding names, credentials, environment values, URLs and logs. Closed chats do not run a status-sync worker; their existing summary can be stale until reopened. Terminal clients receive guidance to open the web deployment setup instead of directly deploying through the old tool.

Deploy Brain and Ray together for the new event contract. No database migration is required. Live review should cover public/private Git, uploads, server paths, Docker-off setup, field changes invalidating review, failed deployments and reopening history.

| File | Responsibility |
| --- | --- |
| `brain/internal/api/chat.go` | Non-deploying setup proposal and end-of-turn handling. |
| `brain/internal/ai/prompt.go` | Setup-first instructions and credential handling guidance. |
| `ray/src/lib/chatRunner.ts` | Background chat persistence and credential-free context forwarding. |
| `ray/src/components/ChatInterface.tsx` | Rendering setup events in the conversation. |
| `ray/src/components/ChatDeploymentSetup.tsx` | Inline setup and private Git controls. |
| `ray/src/lib/chat-deployment-draft.ts` | Browser draft allowlist and validation. |
| `ray/app/api/sessions/[id]/deployment-result/route.ts` | Owner-scoped, database-derived conversation result updates. |
| `ray/src/components/DeploymentWizard.tsx` | Shared deployment workflow and explicit chat review. |
| `ray/app/(dashboard)/deployments/new/page.tsx` | Standalone wrapper around the shared wizard. |


## Compact chat deployment (October 2026)

Chat no longer embeds the standalone deployment wizard. The assistant asks for missing source/name/address information and emits a compact confirmation. On submission, Ray prepares HTTPS Git using saved credentials, analyzes the chosen source directory, fills framework/port defaults, and submits the existing deployment API. The standard deployment page retains its full editor.

Additional non-secret preferences travel in a JSON `deployment_settings` tag alongside `deploy`. Supported fields are branch, appDirectory, framework, buildCommand, startCommand, hostPort, containerPort, projectUrl, dockerEnabled, routingMode and healthCheck. Values are validated by the shared setup contract and saved through the normal deployment endpoint. Secret environment values stay in project settings; Git credentials stay in Settings. Source inspection does not prove that a generic template supports every application.

The chat card shows deployment progress without a separate AI troubleshooting action. A persisted failed status queues one automatic diagnostic follow-up while this chat is open and idle. The assistant receives diagnostic data with instructions to inspect evidence, attempt scoped reversible corrections, and explain requirements needing user attention. A corrected deployment still uses the managed pipeline and compact confirmation. This is model-directed recovery, not a guarantee of repair. No automatic security override, credential invention or unchanged retry loop is implemented. Navigating away does not start a background AI investigation; the failed deployment remains available for review.

Deployment IDs are recovered from browser-local storage; a successful submission without a tracking ID is not submitted again automatically. Polling failures produce a visible notice. The progress stream is bounded in memory. Setup protocol payloads are excluded from the terminal and process viewer.

Framework selection is resolved by Ray's shared registry before passing settings to Brain, including saved automatic configurations on rebuild. This prevents a Python application with frontend tooling from being reviewed as Flask and then built as generic Node. Applications with unusual production entry points or Dockerfiles still require explicit configuration; they are not silently assumed to work.
