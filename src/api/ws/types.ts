import type { AuthContext } from "../http";

export type WsConnectionData = {
  auth: AuthContext;
  /** Headers captured at upgrade (Cookie / Authorization) for synthesized RPC requests. */
  headers: Headers;
  origin: string;
};
