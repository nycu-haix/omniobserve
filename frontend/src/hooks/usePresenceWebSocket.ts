import { useEffect, useRef, useState } from "react";

function getWsBaseUrl() {
	const protocol = window.location.protocol === "https:" ? "wss" : "ws";
	return (import.meta.env.VITE_WS_BASE_URL as string | undefined) || `${protocol}://${window.location.host}`;
}

export function usePresenceWebSocket(sessionId: string, participantId?: string) {
	const [isConnected, setIsConnected] = useState(false);
	const retryCountRef = useRef(0);
	const retryTimerRef = useRef<number | null>(null);
	const socketRef = useRef<WebSocket | null>(null);

	useEffect(() => {
		let disposed = false;

		const connect = () => {
			if (!sessionId || !participantId || disposed) {
				return;
			}

			const wsUrl = `${getWsBaseUrl()}/ws/sessions/${encodeURIComponent(sessionId)}/presence?participant_id=${encodeURIComponent(participantId)}`;
			const socket = new WebSocket(wsUrl);
			socketRef.current = socket;

			socket.onopen = () => {
				retryCountRef.current = 0;
				setIsConnected(true);
				socket.send(
					JSON.stringify({
						type: "join",
						participant_id: participantId
					})
				);
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
	}, [participantId, sessionId]);

	return { isConnected };
}
