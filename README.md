# anacity-autopilot

Approves visitors and deliveries at the gate of an ANACITY (ApnaComplex) housing society without anyone opening the app.

Visitors wait at the gate until someone in the flat responds to the ANACITY notification. The `anacity serve` listener responds as soon as the notification arrives. The `anacity` CLI also covers the manual actions: approving or rejecting visitors, accepting parcels, and pre-approving deliveries.

## How it works

The listener registers as one more Android device on the ANACITY account, so it receives the same notifications as the phones. When a visitor arrives at the gate, it approves or rejects them through the same API the app uses. [ARCHITECTURE.md](ARCHITECTURE.md) covers the details.

## Before turning on auto-approve

- `--action approve` without `--brands` approves everyone the guard logs against the flat, including unexpected visitors.
- The listener reads the account password from `ANACITY_PASSWORD` to sign in again when the session expires.
- The machine must stay awake and online. A sleeping laptop misses notifications.

## Install

Requires Bun 1.4 or newer and an ANACITY account that signs in with a password.

```bash
git clone git@github.com:parichay28/anacity-autopilot.git
cd anacity-autopilot
bun install
bun link    # optional: puts `anacity` on PATH, otherwise use `bun bin/anacity.ts`
```

## Sign in

```bash
anacity login    # prompts for username and password, saves the session

# for the listener, set these instead so it can sign in again on its own
export ANACITY_USERNAME=<mobile number or email>
export ANACITY_PASSWORD=<password>
```

## Run the listener

```bash
anacity serve                                            # log every notification, act on none
anacity serve --action approve --brands "Amazon,Swiggy"  # approve matching brands (case-insensitive, partial match)
anacity serve --action approve                           # approve everyone
anacity serve --action reject                            # reject everyone
anacity serve --stop                                     # unregister the device (Ctrl-C leaves it registered)
```

To keep it running in the background:

```bash
nohup anacity serve --action approve >> ~/.anacity-autopilot/serve.log 2>&1 &
caffeinate -dimsu &                          # macOS: keep the machine awake
tail -F ~/.anacity-autopilot/events.jsonl    # follow the event log
```

## Other commands

```bash
anacity visitors list                      # visitors waiting at the gate now
anacity visitors approve <gate_pass_id>
anacity visitors reject <gate_pass_id>
anacity visitors packages                  # parcels left at the gate
anacity visitors accept <gate_pass_id>     # accept one of those parcels
anacity visitors passes --type upcoming    # history, inside, upcoming or packages

anacity brands -s amazon                   # brand names known to the gate
anacity deliveries add --brand Amazon --start 2026-10-12 --end 2026-10-18   # --window to change hours, --dry-run to preview
anacity deliveries list
anacity deliveries cancel <guid>

anacity whoami
anacity logout
anacity <command> --help                   # all options; list commands also take --json
```

## Reference

### Environment variables

| Variable                  | Purpose                                            | Default                   |
| ------------------------- | -------------------------------------------------- | ------------------------- |
| `ANACITY_USERNAME`        | Mobile number or email. Required by the listener   | None                      |
| `ANACITY_PASSWORD`        | Password. Required by the listener                 | None                      |
| `ANACITY_COMM_ID`         | Society, when the account belongs to more than one | None                      |
| `ANACITY_RU_ID`           | Flat for `deliveries add`                          | Flat on the profile       |
| `ANACITY_HOST_ID`         | Host ID used to approve or reject visitors         | Looked up from the passes |
| `ANACITY_COUNTRY_CODE`    | Dialing code for `deliveries add`                  | `+91`                     |
| `ANACITY_TO_MEET`         | Name on pre-approved deliveries                    | Name on the profile       |
| `ANACITY_DATA_DIR`        | Folder for the files below                         | `~/.anacity-autopilot`    |
| `ANACITY_SESSION_FILE`    | Path of `session.json`                             | Inside `ANACITY_DATA_DIR` |
| `ANACITY_FCM_CREDS_FILE`  | Path of `fcm.json`                                 | Inside `ANACITY_DATA_DIR` |
| `ANACITY_STATE_FILE`      | Path of `listener-state.json`                      | Inside `ANACITY_DATA_DIR` |
| `ANACITY_LOG_FILE`        | Path of `events.jsonl`                             | Inside `ANACITY_DATA_DIR` |
| `ANACITY_LOG_EVENT_LIMIT` | Number of newest events kept in `events.jsonl`     | `10000`                   |

### Files

All files are written to `ANACITY_DATA_DIR`.

| File                  | Contents                                                                  | Permissions        |
| --------------------- | ------------------------------------------------------------------------- | ------------------ |
| `session.json`        | Session cookie, username, sign-in time, account profile                   | Owner only (`600`) |
| `fcm.json`            | The listener's Android device ID, security token and push token           | Owner only (`600`) |
| `listener-state.json` | IDs of the most recent notifications already handled                      | System default     |
| `events.jsonl`        | Every notification in full, including visitor names, and the action taken | System default     |

`events.jsonl` also records connection drops and re-logins. It keeps the newest `ANACITY_LOG_EVENT_LIMIT` lines and drops older ones as new events arrive, including lines left by an earlier run.

`anacity logout` deletes `session.json`. The other files stay until removed manually.

## Development

```bash
bun run typecheck
bun run lint
bun run format
```

The code layout and internal timings are in [ARCHITECTURE.md](ARCHITECTURE.md).

## License

MIT
