"use client";

import { SERVER_CONNECTING_LABEL, SERVER_WAKING_HINT } from "@malalabar/ui";

interface ConnectionStatusProps {
  connected: boolean;
  reconnecting?: boolean;
  /** Not connected yet since the page opened — the API may be waking up. */
  connecting?: boolean;
}

export function ConnectionStatus({ connected, reconnecting, connecting }: ConnectionStatusProps) {
  if (connected) {
    return (
      <div className="flex items-center gap-2 text-emerald-400 text-sm">
        <div className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse" />
        Connected
      </div>
    );
  }

  if (connecting) {
    return (
      <div className="flex items-center gap-2 text-yellow-400 text-sm" title={SERVER_WAKING_HINT}>
        <div className="w-2 h-2 bg-yellow-400 rounded-full animate-pulse" />
        {SERVER_CONNECTING_LABEL}
      </div>
    );
  }

  if (reconnecting) {
    return (
      <div className="flex items-center gap-2 text-yellow-400 text-sm">
        <div className="w-2 h-2 bg-yellow-400 rounded-full animate-pulse" />
        Reconnecting...
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 text-red-400 text-sm">
      <div className="w-2 h-2 bg-red-400 rounded-full" />
      Disconnected
    </div>
  );
}
