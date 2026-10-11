# Architecture

anacity-autopilot runs in two modes that share one ANACITY API client:

- The CLI (`anacity visitors approve`, `anacity deliveries add`, and so on) sends one request and exits.
- The listener (`anacity serve`) runs until stopped and reacts to ANACITY notifications as they arrive.

## Code map

| Path             | Contents                                                               |
| ---------------- | ---------------------------------------------------------------------- |
| `bin/anacity.ts` | Entry point. Passes the arguments to `src/cli/` and prints errors      |
| `src/cli/`       | Argument parsing, help output, and dispatch to a command               |
| `src/commands/`  | CLI commands                                                           |
| `src/server/`    | The listener: sorts notifications, approves or rejects, writes the log |
| `src/fcm/`       | Push token creation and the connection to Google's push servers        |
| `src/api/`       | ANACITY API client: `auth`, `device`, `visitors` and `deliveries`      |
| `src/http.ts`    | Sends API requests and unwraps ANACITY's response format               |
| `src/session.ts` | Saves and loads the session cookie                                     |
| `src/config.ts`  | Environment variables and fixed platform values                        |
| `src/logger.ts`  | Console output and the `events.jsonl` log                              |
| `src/utils/`     | Small shared helpers                                                   |

Imports use the `#src/` alias defined in `package.json`.

| Folder          | Imports from                                                 |
| --------------- | ------------------------------------------------------------ |
| `src/commands/` | `cli`, `server`, `api`, `http`, `session`, `config`, `utils` |
| `src/cli/`      | `commands`, `api`, `http`, `session`, `config`, `utils`      |
| `src/server/`   | `fcm`, `api`, `http`, `session`, `logger`, `config`, `utils` |
| `src/fcm/`      | `config`, `utils`                                            |
| `src/api/`      | `http`, `session`, `config`, `utils`                         |
| `src/utils/`    | Nothing                                                      |

`cli` and `commands` import each other. `cli` holds the list of commands, and the commands use its argument helpers.

## The listener

### Registering as a device

On its first run, `serve` creates an Android push token the same way the ANACITY app does (Firebase installation, GCM check-in, registration) and saves it to `fcm.json`. It then registers the token with ANACITY. From then on, ANACITY sends the account's notifications to the listener as well as the phones. `anacity serve --stop` removes the registration.

The Firebase values used for this belong to the ANACITY app and are in the `firebase` block of `src/config.ts`.

### Staying connected

The listener keeps a connection open to Google's push servers through `@liamcottle/push-receiver`. That library has no heartbeat, so the listener sends its own pings and reconnects when nothing arrives for a while. The timings are under [Built-in values](#built-in-values).

### Which notifications it acts on

ANACITY sends several notifications per visit, all for the same gate pass:

| Sent when                                                | `notify_choice` | What the listener does                          |
| -------------------------------------------------------- | --------------- | ----------------------------------------------- |
| The visitor arrives and waits to be approved or rejected | 12              | Approves or rejects, unless someone already has |
| Someone has approved or rejected the visitor             | 1003            | Logs it                                         |
| The visitor checks in at the gate                        | 63              | Logs it                                         |

With `--brands` set, the listener also skips arrivals whose brand name doesn't match.

### Finding the host ID

To approve or reject, ANACITY needs two IDs: `gate_pass_id` for the visit and `host_id` for the resident the visitor came to see. The arrival notification carries the gate pass ID but usually not the host ID. The listener finds it like this:

1. Fetch the flat's `inside` and `upcoming` visitor passes, the same lists `anacity visitors passes` shows.
2. Find the pass with the same gate pass ID.
3. Read the host ID from that pass.

`anacity visitors approve` and `reject` use the same lookup, in `resolveHostID` in `src/api/visitors/visitors.ts`.

### Repeated notifications

Google can deliver a notification again after a reconnect. The listener saves the IDs of the notifications it has handled in `listener-state.json` and skips any ID it has already seen. A later visit by the same person is a new notification with a new ID, so it is handled normally.

### Sessions

An ANACITY session is a cookie that expires after about two hours, and there is no refresh token. The listener signs in again on a timer with `ANACITY_USERNAME` and `ANACITY_PASSWORD`, so a fresh session is ready when a visitor arrives.

When a request fails because the session expired, the listener signs in again and retries. The CLI does the same when `ANACITY_USERNAME` and `ANACITY_PASSWORD` are set. Retrying is safe because an expired-session error means ANACITY did not carry out the request.

### Event log

`events.jsonl` keeps the newest `ANACITY_LOG_EVENT_LIMIT` lines. On its first write after starting, the logger counts the lines already in the file. When the count goes over the limit, it writes the newest lines to a temp file and renames it over the log, so a crash during the rewrite cannot leave the log cut short.

## Built-in values

These are constants in the source. Changing one means editing the file listed.

| Behaviour                                             | Value                                 | Defined in                   |
| ----------------------------------------------------- | ------------------------------------- | ---------------------------- |
| Listener signs in again                               | Every 60 minutes                      | `src/server/constants.ts`    |
| Notification IDs remembered for duplicate checks      | 2,000                                 | `src/server/constants.ts`    |
| Retries after an expired-session error                | 2                                     | `src/api/constants.ts`       |
| API request timeout                                   | 30 seconds                            | `src/http.ts`                |
| Heartbeat ping to Google's push servers               | Every 60 seconds                      | `src/fcm/constants.ts`       |
| Reconnect when Google's push servers send nothing for | 3 minutes, checked every 30 seconds   | `src/fcm/constants.ts`       |
| Connection status line on the console                 | Every 10 minutes                      | `src/fcm/constants.ts`       |
| Default `events.jsonl` line limit                     | 10,000                                | `src/config.ts`              |
| Daily entry window for `deliveries add`               | 09:00 to 21:00 (`--window` overrides) | `src/commands/deliveries.ts` |
| API host                                              | `https://www.apnacomplex.com`         | `src/config.ts`              |
