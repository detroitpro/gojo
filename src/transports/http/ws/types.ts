import type { AuthContext } from "../http";

export type WsConnectionData = {
  auth: AuthContext;
  /** Headers captured at upgrade (Cookie / Authorization) for synthesized RPC requests. */
  headers: Headers;
  /** Internal base URL for synthesized RPC requests. */
  origin: string;
  /** Browser origin captured at upgrade for CSRF on RPC mutations. */
  browserOrigin: string;
};
