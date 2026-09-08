import { useEffect, useState } from "react";
import { io } from "socket.io-client";
import { config } from "@/config";
import type { Socket } from "socket.io-client";

export function useSocket(sessionToken: string | null): Socket | null {
  const [socket, setSocket] = useState<Socket | null>(null);

  useEffect(() => {
    if (!sessionToken) {
      setSocket(null);
      return;
    }

    const newSocket = io(config.apiBaseUrl, {
      auth: { token: sessionToken },
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      reconnectionAttempts: 5,
    });

    newSocket.on("connect_error", (err) => {
      console.error("Socket connection error:", err);
    });

    setSocket(newSocket);

    return () => {
      newSocket.disconnect();
    };
  }, [sessionToken]);

  return socket;
}
