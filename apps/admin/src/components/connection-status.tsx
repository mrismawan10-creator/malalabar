"use client";

interface ConnectionStatusProps {
  connected: boolean;
  reconnecting?: boolean;
}

export function ConnectionStatus({ connected, reconnecting }: ConnectionStatusProps) {
  if (connected) {
    return (
      <div className="flex items-center gap-2 text-success-ink text-sm font-medium">
        <div className="w-2 h-2 bg-success rounded-full animate-pulse" />
        Connected
      </div>
    );
  }

  if (reconnecting) {
    return (
      <div className="flex items-center gap-2 text-warning-ink text-sm font-medium">
        <div className="w-2 h-2 bg-warning rounded-full animate-pulse" />
        Reconnecting...
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 text-danger-ink text-sm font-medium">
      <div className="w-2 h-2 bg-danger rounded-full" />
      Disconnected
    </div>
  );
}
