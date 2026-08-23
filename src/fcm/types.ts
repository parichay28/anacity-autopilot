/* One decoded push, flattened from push-receiver's key/value pairs to a map. */
export type PushData = Record<string, string>;

interface PushPayload {
  data: PushData;
  persistentId?: string;
}

export interface ConnectHandlers {
  persistentIds?: ReadonlyArray<string>;
  onPayload?(payload: PushPayload): void;
  onPersistentId?(id: string): void;
  onConnect?(): void;
  onDisconnect?(): void;
  onInfo?(message: string): void;
  /* Fatal: the socket could never be established, so no push will ever arrive.
   * Distinct from a drop, which the client recovers from on its own. */
  onError?(error: unknown): void;
}

export interface StoredFCMCredentials {
  gcm: { androidId: string; securityToken: string };
  fcm: { token: string };
  registeredAt: string;
}
