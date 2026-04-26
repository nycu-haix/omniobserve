import { useCallback, useEffect, useRef, useState } from "react";

interface WebSocketMessage {
  type?: string;
  payload?: unknown;
  [key: string]: unknown;
}

export function useWebSocket(roomId: string): {
  sendMessage: (msg: object) => void;
  lastMessage: object | null;
  isConnected: boolean;
} {
  const [lastMessage, setLastMessage] = useState<object | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const socketRef = useRef<WebSocket | null>(null);
  const retryCountRef = useRef(0);
  const retryTimerRef = useRef<number | null>(null);

  useEffect(() => {
    let disposed = false;

    const connect = () => {
      if (!roomId || disposed) {
        return;
      }

      const protocol = window.location.protocol === "https:" ? "wss" : "ws";
      const socket = new WebSocket(`${protocol}://${window.location.host}/ws/room/${roomId}`);
      socketRef.current = socket;

      socket.onopen = () => {
        retryCountRef.current = 0;
        setIsConnected(true);
      };

      socket.onmessage = (event) => {
        try {
          setLastMessage(JSON.parse(event.data) as WebSocketMessage);
        } catch {
          setLastMessage({ type: "raw_message", payload: event.data });
        }
      };

      socket.onclose = () => {
        setIsConnected(false);
        if (!disposed && retryCountRef.current < 5) {
          retryCountRef.current += 1;
          retryTimerRef.current = window.setTimeout(connect, 3000);
        }
      };

      socket.onerror = () => {
        socket.close();
      };
    };

    connect();

    return () => {
      disposed = true;
      if (retryTimerRef.current !== null) {
        window.clearTimeout(retryTimerRef.current);
      }
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, [roomId]);

  const sendMessage = useCallback((msg: object) => {
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify(msg));
    }
  }, []);

  return { sendMessage, lastMessage, isConnected };
}
