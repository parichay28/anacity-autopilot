/* Ambient types for `@liamcottle/push-receiver` (0.0.4), which ships none. The
 * private `_socket`/`_parser` internals are tapped by the keepalive supervisor. */
declare module "@liamcottle/push-receiver" {
  import type { EventEmitter } from "node:events";

  interface GCMCredentials {
    androidId: string;
    securityToken: string;
  }

  interface FCMToken {
    token: string;
  }

  interface RegisteredCredentials {
    gcm: GCMCredentials;
    fcm: FCMToken;
  }

  /* The length-delimited MCS frame parser; emits `message` with a numeric tag. */
  interface MCSParser extends EventEmitter {
    __anacityTapped?: boolean;
  }

  interface MCSSocket {
    write(buffer: Buffer): void;
    destroy(): void;
  }

  export class Client extends EventEmitter {
    constructor(
      androidId: string,
      securityToken: string,
      persistentIds?: ReadonlyArray<string>,
    );
    _socket?: MCSSocket;
    _parser?: MCSParser;
    connect(): Promise<void>;
    destroy(): void;
  }

  export const AndroidFCM: {
    register(
      apiKey: string,
      projectID: string,
      senderID: string,
      appID: string,
      packageName: string,
      cert: string,
    ): Promise<RegisteredCredentials>;
  };

  const pushReceiver: { Client: typeof Client; AndroidFCM: typeof AndroidFCM };
  export default pushReceiver;
}
