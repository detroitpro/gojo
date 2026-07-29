import type { PlatformChangeEvent, PlatformEventTopic } from "../types";
import { gojoSocket, type GojoSocket, type SocketConnectionStatus } from "./ws-client";

export type PlatformEventConnectionStatus = SocketConnectionStatus;

export class PlatformEventHub {
  private readonly subscriptions = new Map<
    number,
    { unsubscribe: () => void }
  >();
  private nextSubscriptionId = 1;

  constructor(private readonly socket: GojoSocket = gojoSocket) {}

  get status(): PlatformEventConnectionStatus {
    return this.socket.status;
  }

  subscribe(
    topics: readonly PlatformEventTopic[],
    listener: (event: PlatformChangeEvent) => void,
    projectId?: string,
  ): () => void {
    const id = this.nextSubscriptionId++;
    const unsubscribe = this.socket.subscribePlatform(topics, listener, projectId);
    this.subscriptions.set(id, { unsubscribe });
    this.socket.connect();
    return () => {
      unsubscribe();
      this.subscriptions.delete(id);
      if (this.subscriptions.size === 0) {
        // Status becomes idle only when the socket itself disconnects; keep
        // the shared connection for other consumers (RPC / run streams).
      }
    };
  }

  subscribeStatus(listener: (status: PlatformEventConnectionStatus) => void): () => void {
    return this.socket.subscribeStatus(listener);
  }

  reconnect(): void {
    this.socket.reconnect();
  }
}

export const platformEventHub = new PlatformEventHub();
