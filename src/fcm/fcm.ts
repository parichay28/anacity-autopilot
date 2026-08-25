/* Mints our own FCM device credentials and holds the MCS push socket open,
 * adding the heartbeat/reconnect keepalive push-receiver doesn't do itself. */

import { createRequire } from "node:module";

import pushReceiver from "@liamcottle/push-receiver";
import protobuf from "protobufjs";

import { config, firebase } from "#src/config.ts";
import { writeSecretJSON } from "#src/utils/fs.ts";
import { isRecord, asString, asNumber } from "#src/utils/guards.ts";
import {
  HEARTBEAT_PING_TAG,
  HEARTBEAT_ACK_TAG,
  PING_INTERVAL_MS,
  WATCHDOG_INTERVAL_MS,
  SILENCE_LIMIT_MS,
  KEEPALIVE_REPORT_MS,
} from "./constants.ts";
import { loadCreds, toDataMap } from "./utils.ts";
import type { ConnectHandlers, StoredFCMCredentials } from "./types.ts";

const { Client, AndroidFCM } = pushReceiver;

/* ---- device credentials -------------------------------------------------- */

/* Returns cached FCM credentials, registering fresh ones on first use. */
export async function ensureFCMCredentials(): Promise<StoredFCMCredentials> {
  const existing = loadCreds();
  if (existing) return existing;

  const registered = await AndroidFCM.register(
    firebase.apiKey,
    firebase.projectID,
    firebase.senderID,
    firebase.appID,
    firebase.packageName,
    firebase.packageCert,
  );

  const creds: StoredFCMCredentials = {
    ...registered,
    registeredAt: new Date().toISOString(),
  };

  /* The device token authenticates this client to FCM — owner-only. */
  writeSecretJSON(config.fcmCredsFile, creds);
  return creds;
}

/* ---- the socket ---------------------------------------------------------- */

/* Opens the socket and streams pushes to callbacks, kept alive by heartbeats +
 * reconnect. persistentIds seeds the dedupe set; onPersistentId reports new ids. */
export function connect(
  credentials: StoredFCMCredentials,
  handlers: ConnectHandlers = {},
): void {
  const requireModule = createRequire(import.meta.url);
  const MCS_PROTO_PATH = requireModule.resolve(
    "@liamcottle/push-receiver/src/mcs.proto",
  );

  const client = new Client(
    credentials.gcm.androidId,
    credentials.gcm.securityToken,
    handlers.persistentIds ?? [],
  );

  let heartbeatPing: protobuf.Type | undefined;
  let heartbeatAck: protobuf.Type | undefined;
  let pingsSent = 0;
  let lastInbound = Date.now();
  let reconnecting = false;

  /* MCS post-login frame: [tag byte][length-delimited payload]. */
  function frame(tag: number, type: protobuf.Type): Buffer {
    const body = type.encodeDelimited({}).finish();
    return Buffer.concat([Buffer.from([tag]), body]);
  }

  function write(buffer: Buffer): void {
    try {
      client._socket?.write(buffer);
    } catch {
      /* A failed write means the socket is gone; the watchdog will reconnect. */
    }
  }

  const handle = (envelope: unknown): void => {
    lastInbound = Date.now();

    const outer: Record<string, unknown> = isRecord(envelope) ? envelope : {};
    const inner: Record<string, unknown> = isRecord(outer.object)
      ? outer.object
      : outer;

    const persistentId =
      asString(outer.persistentId) ?? asString(inner.persistentId);
    const data = toDataMap(inner.appData);

    if (persistentId) handlers.onPersistentId?.(persistentId);
    handlers.onPayload?.({ data, persistentId });
  };

  /* Re-tap the parser on every (re)connect — it's recreated each time — to bump
   * the inbound clock and ack the server's heartbeat pings. */
  function attachParserTap(): void {
    const parser = client._parser;
    if (!parser || parser.__anacityTapped) return;
    parser.__anacityTapped = true;

    parser.on("message", (message: unknown) => {
      lastInbound = Date.now();
      const tag = isRecord(message) ? asNumber(message.tag) : undefined;
      if (tag === HEARTBEAT_PING_TAG && heartbeatAck)
        write(frame(HEARTBEAT_ACK_TAG, heartbeatAck));
    });
  }

  function startTimers(): void {
    setInterval(() => {
      if (heartbeatPing) {
        write(frame(HEARTBEAT_PING_TAG, heartbeatPing));
        pingsSent += 1;
      }
    }, PING_INTERVAL_MS).unref?.();

    setInterval(() => {
      handlers.onInfo?.(
        `keepalive ok — ${pingsSent} pings sent, last inbound ${Math.round((Date.now() - lastInbound) / 1000)}s ago`,
      );
    }, KEEPALIVE_REPORT_MS).unref?.();

    setInterval(() => {
      if (reconnecting) return;
      if (Date.now() - lastInbound > SILENCE_LIMIT_MS) {
        handlers.onInfo?.(
          `no inbound for ${Math.round((Date.now() - lastInbound) / 1000)}s — reconnecting`,
        );
        forceReconnect();
      }
    }, WATCHDOG_INTERVAL_MS).unref?.();
  }

  /* Make the library notice a silently-dead socket: destroy fires its 'close'
   * handler, triggering its reconnect + fresh login (which drains queued pushes). */
  function forceReconnect(): void {
    reconnecting = true;
    lastInbound = Date.now();
    try {
      client._socket?.destroy();
    } catch {
      /* Already gone; the library's retry will bring it back. */
    }
    setTimeout(() => {
      reconnecting = false;
    }, WATCHDOG_INTERVAL_MS);
  }

  client.on("connect", () => {
    lastInbound = Date.now();
    /* Library attaches the parser just after 'connect', so tap on the next tick. */
    setTimeout(attachParserTap, 50);
    handlers.onConnect?.();
  });
  client.on("disconnect", () => handlers.onDisconnect?.());
  client.on("ON_DATA_RECEIVED", handle);
  client.on("ON_NOTIFICATION_RECEIVED", handle);

  /* connect() is sync but startup isn't — catch here so a proto/socket failure
   * reports instead of crashing the process as an unhandled rejection. */
  void (async () => {
    const root = await protobuf.load(MCS_PROTO_PATH);
    heartbeatPing = root.lookupType("mcs_proto.HeartbeatPing");
    heartbeatAck = root.lookupType("mcs_proto.HeartbeatAck");
    await client.connect();
    attachParserTap();
    startTimers();
  })().catch((error: unknown) => {
    handlers.onError?.(error);
  });
}
