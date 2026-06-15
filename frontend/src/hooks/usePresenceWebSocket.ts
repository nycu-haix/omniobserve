import { useEffect, useRef, useState } from "react";
import { normalizePresenceParticipantsPayload, type ParticipantPresence } from "../lib/presenceParticipants";

function getWsBaseUrl() {
	const protocol = window.location.protocol === "https:" ? "wss" : "ws";
	return (import.meta.env.VITE_WS_BASE_URL as string | undefined) || `${protocol}://${window.location.host}`;
}

export function usePresenceWebSocket(sessionId: string, participantId?: string, displayName?: string) {
	const [isConnected, setIsConnected] = useState(false);
	const [participants, setParticipants] = useState<ParticipantPresence[]>([]);
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
						participant_id: participantId,
						displayName
					})
				);
			};

			socket.onclose = () => {
				setIsConnected(false);
				setParticipants([]);
				if (!disposed && retryCountRef.current < 5) {
					retryCountRef.current += 1;
					retryTimerRef.current = window.setTimeout(connect, 3000);
				}
			};

			socket.onerror = () => {
				socket.close();
			};

			socket.onmessage = event => {
				if (typeof event.data !== "string") {
					return;
				}
				try {
					const message = JSON.parse(event.data) as { type?: unknown; participants?: unknown; participant_ids?: unknown };
					if (message.type === "presence_state") {
						setParticipants(normalizePresenceParticipantsPayload(message));
					}
				} catch {
					// Ignore malformed presence payloads; the socket retry path handles disconnects.
				}
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
			setParticipants([]);
		};
	}, [displayName, participantId, sessionId]);

	return { isConnected, participants };
}
