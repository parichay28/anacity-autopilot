# anacity-autopilot

CLI + always-on listener for ANACITY / ApnaComplex gate and visitor approvals,
speaking the same REST API and FCM push channel the mobile app uses.

- **CLI mode** — one-shot commands: log in, browse brands, list gate visitors
  and passes, approve/reject a visitor, pre-authorize deliveries.
- **Server mode** — a long-lived listener that reacts to visitor-approval
  pushes the instant the backend sends them, with no phone in the loop.

## Install

Node.js 22.18+. TypeScript runs directly via native type-stripping — no build.

```bash
npm install
node bin/anacity.ts --help

npm link          # optional: expose globally as `anacity`
```

## Configuration

Settings come from environment variables only — there is no `.env` loading.
Only `ANACITY_USERNAME` and `ANACITY_PASSWORD` are required; with both set, the
CLI and the listener silently re-login on session expiry, so `anacity login` is
never needed.

```bash
export ANACITY_USERNAME=<mobile number or email>
export ANACITY_PASSWORD=<password>
```

| Variable          | Meaning                                                 |
| ----------------- | ------------------------------------------------------- |
| `ANACITY_COMM_ID` | Community id, if your account spans multiple societies. |

### Defaults for writes

Each has a matching command flag (shown), which takes precedence.

| Variable               | Flag             | Used by                                                   |
| ---------------------- | ---------------- | --------------------------------------------------------- |
| `ANACITY_HOST_ID`      | `--host`         | Visitor approve/reject — overrides the looked-up host_id. |
| `ANACITY_RU_ID`        | `--unit`         | Delivery pre-auth, when the unit is omitted.              |
| `ANACITY_COUNTRY_CODE` | `--country-code` | Delivery pre-auth dialing code (default `+91`).           |
| `ANACITY_TO_MEET`      | —                | Delivery pre-auth `to_meet` field, when set.              |

### State files

All under `$HOME`, `chmod 600` where they hold secrets, path overridable via
the env var in the last column.

| File                             | Contents                                             | Override env var         |
| -------------------------------- | ---------------------------------------------------- | ------------------------ |
| `~/.anacity-session.json`        | Cached session cookie jar.                           | `ANACITY_SESSION_FILE`   |
| `~/.anacity-fcm.json`            | Minted FCM device credentials.                       | `ANACITY_FCM_CREDS_FILE` |
| `~/.anacity-listener-state.json` | Seen-push dedupe ids.                                | `ANACITY_STATE_FILE`     |
| `~/.anacity-events.jsonl`        | Listener event/trace log (one JSON object per line). | `ANACITY_LOG_FILE`       |

The REST host, app-client identity, and Firebase project are fixed constants in
`src/config.ts` — the host is `https://www.apnacomplex.com` (ANACITY is the
ApnaComplex rebrand). `NO_COLOR=1` disables ANSI colour.

## CLI mode

```bash
# Authentication
anacity login                       # prompts, or reads ANACITY_USERNAME/ANACITY_PASSWORD
anacity whoami                      # show the cached session and profile
anacity logout

# Brands (known visitor/delivery organizations)
anacity brands                      # grouped by type
anacity brands --type delivery
anacity brands -s amazon            # case-insensitive name search
anacity brands --json

# Visitors and passes
anacity visitors list               # visitors currently at the gate
anacity visitors passes --type inside     # history | inside | upcoming | packages
anacity visitors packages           # parcels left at the gate
anacity visitors approve <gate_pass_id>
anacity visitors reject  <gate_pass_id>
anacity visitors accept  <gate_pass_id>   # accept a leave-at-gate package
anacity visitors approve <gate_pass_id> --host <host_id>   # override host lookup

# Deliveries (multi-day pre-authorization)
anacity deliveries add --brand "Amazon" --start 2026-01-10 --end 2026-01-15
anacity deliveries add --brand "Amazon" --start 2026-01-10 --dry-run   # print, don't send
anacity deliveries list
anacity deliveries cancel <guid>
```

Human-readable output goes to **stderr**; machine-readable JSON (`--json`,
`--dry-run`) goes to **stdout**, so it pipes cleanly.

## Server mode

```bash
anacity serve                       # observe & log only (default)
anacity serve --action approve      # auto-approve each visitor-approval push
anacity serve --action reject
anacity serve --action approve --brands "Amazon,Swiggy"   # only act on matching orgs
anacity serve --stop                # detach our token from the account (backout)
```

Long-lived background run:

```bash
nohup node bin/anacity.ts serve --action approve > ~/anacity-serve.log 2>&1 &
```

### How the listener works

1. **Mints a device token** on first run — the same Firebase Installations →
   GCM check-in → c2dm register handshake the Android app performs — and caches
   it in `~/.anacity-fcm.json`.
2. **Attaches the token to the account** (`m_add_gcm_user`), so the backend
   fans out pushes to it alongside your phones, not instead of them.
3. **Keeps the FCM socket alive.** The underlying library does not heartbeat,
   so an idle socket dies silently and misses every push. The listener sends
   its own MCS HeartbeatPings, acks the server's, and force-reconnects a
   silent socket.
4. **Acts only on an actual approval request** (`notify_choice=12`).
   Post-decision pushes (check-in, "guest approved") are logged, never acted
   on. When acting, it resolves the visit's `host_id` — from the push, or from
   the pass lists — and records the decision.
5. **Survives session expiry.** Sessions are a sliding ~2h cookie with no
   refresh token; like the app, the listener re-logins from
   `ANACITY_USERNAME`/`ANACITY_PASSWORD` and retries.

Every push — acted on or not — is appended to `~/.anacity-events.jsonl` with
the full raw payload, extracted ids, and the decision taken, so one line
explains the whole chain.

## Architecture

Two front-ends over one shared core: CLI mode is imperative (a command runs
and exits), server mode is reactive (a push arrives, it reacts). Both share
config, session, and the API client.

```
src/
  config.ts        env-driven settings + fixed platform/Firebase constants
  http.ts          transport + envelope: apiPost, unwrap, guardSession, APIError, Unwrapped
  session.ts       Session/CookieJar + on-disk persistence
  logger.ts        timestamped console lines + append-only JSONL event feed
  api/             the typed ANACITY endpoint client, one folder per resource
    constants.ts     MAX_RELOGIN_RETRIES
    auth/            login, logout, silent re-login (+ request/response types)
    device/          attach/detach our FCM token on the account
    visitors/        gate activity, pass lists, brands, decisions, resolveHostID
                     (+ entities: VisitorOrg, VisitorPass, Visitor; decoders in utils.ts)
    deliveries/      pre-authorize + cancel intimated passes
  fcm/             the FCM transport
    fcm.ts           mint device token + MCS socket + heartbeat keepalive
    utils.ts         stored-credential reader, push payload → flat map
    types.ts         PushData, ConnectHandlers, StoredFCMCredentials
    constants.ts     MCS tags, keepalive cadence
  cli/             the CLI framework (imperative front-end)
    cli.ts           help rendering + dispatch (self-heals on session expiry)
    utils.ts         argument parser, option readers, requireSession, row renderers
    types.ts         CommandSpec, OptionSpec, ArgSpec, ParsedArgs
  commands/        one file per CLI verb
    auth.ts brands.ts visitors.ts deliveries.ts serve.ts
  server/          the always-on listener (reactive front-end)
    server.ts        lifecycle + the approval reaction, stage by stage
    utils.ts         push classification + persisted push-id dedupe
    types.ts         ServerAction, ServerOptions, ApprovalRecord, TraceRecord
    constants.ts     push key aliases, dedupe cap
  utils/           domain-free leaf helpers
    guards.ts        JSON narrowing: isRecord, asString, readStrings, …
    terminal.ts      color, out, emit, fail, ask, CliError
    errors.ts        errorMessage, errorDetail
    fs.ts            chmod-600 reads/writes for secret state files
  types/
    push-receiver.d.ts   ambient types for the untyped FCM dependency
bin/
  anacity.ts       entry point
```

### Dependency direction

Internal imports use the `#src/…` alias (package.json subpath imports — Node
resolves them natively). They flow one way; `utils/` is the leaf:

```
commands/ ─→ cli/ ──┐
                    ├─→ api/ ─→ { http, session, config } ─→ utils/
server/ ──→ fcm/ ───┘
```

The only cross-front-end edge is `commands/serve.ts → server/server.ts`: the
`serve` command launches the listener.

### Conventions

- **Flat, concern-named files first.** A concern is a single file
  (`logger.ts`, `session.ts`) until it outgrows a few screens; only then does
  it become a folder holding `<name>.ts` plus `types.ts` / `utils.ts` /
  `constants.ts` — each created only where there is real content for it.
- **Types live with their concern.** There is no central types file: a type
  used by one file stays in that file; a type shared across files lives in its
  owning concern's `types.ts` (API request/response shapes are named
  `$NameRequest` / `$NameResponse`).
- **No `any`, no `as`.** Foreign JSON (the API envelope, FCM pushes) is typed
  `unknown` and narrowed through the guards in `utils/guards.ts`.

### TypeScript

Type-checking is a separate, non-blocking step:

```bash
npx tsc --noEmit
```

`tsconfig.json` enables `strict`, `noUncheckedIndexedAccess`,
`verbatimModuleSyntax`, and `erasableSyntaxOnly`, which keeps the source
runnable by Node's stripper (no enums, namespaces, or parameter properties).
