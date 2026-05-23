# OpsMind Endpoint Agent (Phase 7 MVP)

## Purpose

`opsmind-endpoint-agent` is a terminal-run macOS MVP that consumes queued Agent Tasks from `opsmind-agentic-ai-service` and executes only predefined safe local diagnostic handlers.

## Architecture Fit

1. AI planner proposes remediation plan.
2. Technician approves plan.
3. Backend queues Agent Task for a registered endpoint device.
4. Endpoint agent polls queue, runs safe handlers, and submits step results.
5. Backend stores task lifecycle + step logs.

## MVP Safety Model

- No GUI.
- No Docker orchestration for this agent.
- No real download.
- No real install.
- No arbitrary command/script/url execution.
- Only allowlisted action handlers are dispatched by `actionKey`.
- Unsupported actions are submitted as `SKIPPED` with explicit reason.

## Setup

```bash
cd Services/opsmind-endpoint-agent
npm install
cp .env.example .env
# Fill OPSMIND_JWT with a logged-in user token from OpsMind frontend
npm start
```

## Local Device Identity

Identity file path:

`~/.opsmind-agent/config.json`

Stored fields:

- `deviceId`
- `deviceName`
- `osType`
- `registeredAt`
- `lastSeenAt`

If no identity exists, agent registers device automatically.

If identity exists but backend device is missing, agent fails fast and asks for reset.

Reset command:

```bash
rm -rf ~/.opsmind-agent
```

## Environment Variables

```env
AGENTIC_AI_BASE_URL=http://localhost:4010
OPSMIND_JWT=copy_logged_in_user_jwt_here
DEVICE_NAME=Mo MacBook
DEVICE_OS=MACOS
HEARTBEAT_INTERVAL_MS=30000
POLL_INTERVAL_MS=10000
```

## Supported Actions (MVP)

- `COLLECT_SYSTEM_INFO`
- `CHECK_CONNECTIVITY`
- `CHECK_DISK_SPACE`
- `CHECK_MEMORY_USAGE`
- `CHECK_INSTALLED_APPS`

## Skipped / Not Implemented Actions (MVP)

- `DOWNLOAD_APPROVED_SOFTWARE`
- `VERIFY_DOWNLOADED_SOFTWARE`
- `OPEN_DOWNLOADED_INSTALLER`
- `INSTALL_APPROVED_SOFTWARE`

For skipped actions, the agent reports:

- no download was performed
- no install was performed
- reason: `NOT_IMPLEMENTED_IN_ENDPOINT_AGENT_MVP`

## Current Limitations

- Terminal MVP only.
- Uses user JWT for development auth.
- Production should use device enrollment tokens/secrets.
- No real endpoint software deployment behavior yet.

## Expected Demo Flow

1. Start backend services.
2. Start endpoint agent.
3. Confirm device appears ONLINE in Registered Devices.
4. Create eligible software ticket (Chrome or Rectangle).
5. Generate + approve plan.
6. Queue Agent Task.
7. Agent claims task, runs supported diagnostics, skips unsupported download/verify steps, and completes task lifecycle.
