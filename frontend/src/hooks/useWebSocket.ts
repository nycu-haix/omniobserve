import { useCallback, useEffect, useRef, useState } from "react";

interface WebSocketMessage {
  type?: string;
  payload?: unknown;
  [key: string]: unknown;
}

export function useWebSocket(
  sessionId: string,
  participantId?: string,
): {
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
      if (!sessionId || !participantId || disposed) {
        return;
      }

      const protocol = window.location.protocol === "https:" ? "wss" : "ws";
      const baseUrl = import.meta.env.VITE_WS_BASE_URL as string | undefined;
      const wsBaseUrl = baseUrl || `${protocol}://${window.location.host}`;
      const wsUrl = `${wsBaseUrl}/ws/sessions/${encodeURIComponent(
        sessionId,
      )}/board?participant_id=${encodeURIComponent(participantId)}`;
      console.info("[board-ws] connecting", { sessionId, participantId, wsUrl });
      const socket = new WebSocket(wsUrl);
      socketRef.current = socket;

      socket.onopen = () => {
        retryCountRef.current = 0;
        setIsConnected(true);
        const joinMessage = {
          type: "join",
          participant_id: participantId,
        };
        console.info("[board-ws] open", { sessionId, participantId });
        console.info("[board-ws] send", joinMessage);
        socket.send(JSON.stringify(joinMessage));
      };

      socket.onmessage = (event) => {
        try {
          const parsedMessage = JSON.parse(event.data) as WebSocketMessage;
          console.info("[board-ws] receive", parsedMessage);
          setLastMessage(parsedMessage);
        } catch {
          console.info("[board-ws] receive raw", event.data);
          setLastMessage({ type: "raw_message", payload: event.data });
        }
      };

      socket.onclose = (event) => {
        console.warn("[board-ws] close", {
          code: event.code,
          reason: event.reason,
          wasClean: event.wasClean,
        });
        setIsConnected(false);
        if (!disposed && retryCountRef.current < 5) {
          retryCountRef.current += 1;
          console.info("[board-ws] reconnect scheduled", { retry: retryCountRef.current });
          retryTimerRef.current = window.setTimeout(connect, 3000);
        }
      };

      socket.onerror = (event) => {
        console.error("[board-ws] error", event);
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
  }, [participantId, sessionId]);

  const sendMessage = useCallback((msg: object) => {
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      console.info("[board-ws] send", msg);
      socketRef.current.send(JSON.stringify(msg));
      return;
    }
    console.warn("[board-ws] send skipped because socket is not open", {
      readyState: socketRef.current?.readyState,
      msg,
    });
  }, []);

  return { sendMessage, lastMessage, isConnected };
}
