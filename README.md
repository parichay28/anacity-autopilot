# anacity-autopilot

Anacity (ApnaComplex) sends a push when a visitor or delivery arrives at the gate. Someone has to tap Approve — miss it and the guard calls, or the delivery leaves.

This runs on your laptop or a home server, listens on the same FCM channel as the app, and approves automatically. Your phones still get the notification; this just acts on it too.

## Setup

Needs Bun 1.4+.

```bash
bun install
bun run bin/anacity.ts --help

bun link          # optional: puts `anacity` on your PATH
```

Only two things are required:

```bash
export ANACITY_USERNAME=<mobile number or email>
export ANACITY_PASSWORD=<password>
```

With those set, the session refreshes on expiry without prompting.

**Other variables:**

| Variable               | What it does                                                                  |
| ---------------------- | ----------------------------------------------------------------------------- |
| `ANACITY_COMM_ID`      | Selects a community if your account spans multiple societies.                 |
| `ANACITY_RU_ID`        | Default unit for delivery pre-auth (when `--unit` is omitted).                |
| `ANACITY_HOST_ID`      | Default host for visitor decisions (when the push doesn't include one).       |
| `ANACITY_COUNTRY_CODE` | Dialing code for delivery pre-auth (default `+91`).                           |
| `ANACITY_TO_MEET`      | `to_meet` field for delivery pre-auth.                                        |

**State files** — all written under `~/.anacity-autopilot/`, each path overridable:

| File                  | Contents                                    | Override                 |
| --------------------- | ------------------------------------------- | ------------------------ |
| `session.json`        | Cached session cookie.                      | `ANACITY_SESSION_FILE`   |
| `fcm.json`            | FCM device credentials.                     | `ANACITY_FCM_CREDS_FILE` |
| `listener-state.json` | Push IDs already acted on (dedupe).         | `ANACITY_STATE_FILE`     |
| `events.jsonl`        | Full event log — one JSON object per line.  | `ANACITY_LOG_FILE`       |

## Usage

**One-off commands:**

```bash
anacity login / whoami / logout

anacity brands                              # grouped by type
anacity brands --type delivery
anacity brands -s amazon                   # case-insensitive search

anacity visitors list                      # at the gate right now
anacity visitors passes --type inside      # history | inside | upcoming | packages
anacity visitors approve <gate_pass_id>
anacity visitors reject  <gate_pass_id>
anacity visitors accept  <gate_pass_id>    # accept a leave-at-gate parcel

anacity deliveries list
anacity deliveries add --brand "Amazon" --start 2026-01-10 --end 2026-01-15
anacity deliveries cancel <guid>
```

**Always-on listener:**

```bash
anacity serve                                            # observe and log only
anacity serve --action approve                           # auto-approve every push
anacity serve --action approve --brands "Amazon,Swiggy" # only matching orgs
anacity serve --stop                                     # detach token from account
```

Background:

```bash
nohup bun bin/anacity.ts serve --action approve > ~/anacity-serve.log 2>&1 &
```

## How the listener works

The first run mints a real Android device token — the same Firebase Installations → GCM check-in → c2dm register flow the app does — and caches the credentials in `fcm.json`. It then attaches that token to your account, so the backend fans pushes to it alongside your phones, not instead of them.

From there it holds an MCS socket open to Google. The underlying library doesn't heartbeat, so the listener sends its own pings, acks the server's, and force-reconnects if the socket goes silent. When a push arrives:

- **Approval request notification** (`notify_choice=12`) — resolves the `host_id` from the push or the pass lists, then calls approve or reject.
- **Follow-up push notifications** (check-in, "guest approved") — logged and skipped, so the same visit isn't acted on twice.

Every push gets appended to `events.jsonl` with the raw payload, extracted IDs, and what was decided.

Sessions are a sliding ~2h cookie with no refresh token. When one expires, the listener re-logins from `ANACITY_USERNAME`/`ANACITY_PASSWORD` and retries.

## Architecture

Two front-ends over a shared core. CLI mode is imperative — runs and exits. Server mode is reactive — waits, then acts. Both share config, session handling, and the API client.

```
src/
  config.ts        env settings + fixed Firebase/platform constants
  http.ts          apiPost, envelope unwrapping, guardSession, APIError
  session.ts       Session/CookieJar + disk persistence
  logger.ts        timestamped console + append-only JSONL log
  api/             typed Anacity API client, one folder per resource
    auth/            login, logout, silent re-login
    device/          attach/detach FCM token
    visitors/        gate activity, pass lists, brands, decisions, resolveHostID
    deliveries/      pre-authorize + cancel
  fcm/             FCM transport
    fcm.ts           mint token + MCS socket + heartbeat
    utils.ts         credential reader, push payload → flat map
    constants.ts     MCS tags, keepalive cadence
  cli/             CLI layer
    cli.ts           help + dispatch
    utils.ts         argument parser, option readers, row renderers
  commands/        one file per verb
  server/          listener
    server.ts        lifecycle + approval logic
    utils.ts         push classification + dedupe
    keepalive.ts     periodic session refresh
    constants.ts     push key aliases, dedupe cap
  utils/           leaf helpers (guards, terminal, errors, fs)
bin/
  anacity.ts       entry point
```

Imports use the `#src/…` alias and flow one way:

```
commands/ ─→ cli/ ──┐
                    ├─→ api/ ─→ { http, session, config } ─→ utils/
server/ ──→ fcm/ ───┘
```