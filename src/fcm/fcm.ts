/*
 * The FCM transport: minting our own device credentials and holding the MCS
 * push socket open.
 *
 * Registration: push-receiver's AndroidFCM.register performs the standard
 * Android FCM handshake (Firebase Installations v2 -> GCM check-in ->
 * c2dm/register3) to mint a token, which we hand to the backend so it delivers
 * this account's pushes to us.
 *
 * Socket: push-receiver does not send heartbeats or ack the server's, so an
 * idle connection is silently dropped by NAT/the server and the library keeps
 * a dead "connected" socket forever (missing every push). connect() adds the
 * keepalive a real FCM client needs:
 *   - sends a HeartbeatPing on a fixed cadence,
 *   - acks the server's HeartbeatPing,
 *   - tracks inbound traffic and force-reconnects if the socket goes silent.
 * None of this is polling the ANACITY API — it is keepalive on the one push
 * socket, exactly what the phone's FCM client does.
 *
 * ANACITY sends data messages (no web-push crypto-key), so pushes arrive on the
 * ON_DATA_RECEIVED event. The raw app_data is a list of { key, value } pairs —
 * we normalise it to a flat object.
 */

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

/*
 * Opens the FCM socket and streams pushes to callbacks, keeping the connection
 * alive with heartbeats and reconnecting a silent socket. persistentIds seeds
 * the dedupe set;
 * onPersistentId reports each newly seen id so the caller can persist it.
 */
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

  /* Re-tap the parser after every (re)connect: update the inbound clock on any
   * MCS message and ack the server's heartbeat pings. The parser instance is
   * recreated on each reconnect, so this runs on every 'connect'. */
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

  /* Force the library to notice a silently-dead socket: destroying the socket
   * fires its 'close' handler, which triggers its own reconnect + fresh login
   * (which drains any queued pushes). */
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
    /* The parser is attached just after 'connect' inside the library, so tap on
     * the next tick. */
    setTimeout(attachParserTap, 50);
    handlers.onConnect?.();
  });
  client.on("disconnect", () => handlers.onDisconnect?.());
  client.on("ON_DATA_RECEIVED", handle);
  client.on("ON_NOTIFICATION_RECEIVED", handle);

  /* Startup is async but connect() is not: without the catch, a failure to load
   * the proto or open the socket surfaces as an unhandled rejection that kills
   * the process with no diagnostic. */
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
