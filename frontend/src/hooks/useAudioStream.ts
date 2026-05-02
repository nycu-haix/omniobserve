import { useCallback, useEffect, useRef, useState } from "react";

export type AudioStreamMode = "public" | "private";

interface AudioStreamMessage {
	type?: string;
	payload?: unknown;
	[key: string]: unknown;
}

interface ActiveAudioMeta {
	mode: AudioStreamMode;
	roomName: string;
	sessionId: string;
	participantId: string;
	displayName: string;
	clientId: string;
}

const TARGET_SAMPLE_RATE = 16000;
const OUTPUT_CHUNK_SIZE = 512;

function makeClientId(): string {
	if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
		return crypto.randomUUID();
	}

	return `client_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function getAudioWsBaseUrl(): string {
	const protocol = window.location.protocol === "https:" ? "wss" : "ws";

	const audioBaseUrl = import.meta.env.VITE_AUDIO_WS_BASE_URL as string | undefined;
	const generalWsBaseUrl = import.meta.env.VITE_WS_BASE_URL as string | undefined;

	const baseUrl = audioBaseUrl || generalWsBaseUrl || `${protocol}://${window.location.host}`;

	return baseUrl.replace(/\/+$/, "");
}

function sourceForMode(mode: AudioStreamMode): string {
	return mode === "public" ? "browser_public" : "browser_private";
}

function agentTypeForMode(mode: AudioStreamMode): string {
	return mode === "public" ? "public_browser" : "private_browser";
}

function downsampleTo16k(input: Float32Array, inputSampleRate: number): Float32Array {
	if (input.length === 0) {
		return new Float32Array(0);
	}

	if (inputSampleRate === TARGET_SAMPLE_RATE) {
		return new Float32Array(input);
	}

	const ratio = inputSampleRate / TARGET_SAMPLE_RATE;
	const outputLength = Math.floor(input.length / ratio);

	if (outputLength <= 0) {
		return new Float32Array(0);
	}

	const output = new Float32Array(outputLength);

	for (let i = 0; i < outputLength; i += 1) {
		const start = Math.floor(i * ratio);
		const end = Math.min(Math.floor((i + 1) * ratio), input.length);

		let sum = 0;
		let count = 0;

		for (let j = start; j < end; j += 1) {
			sum += input[j];
			count += 1;
		}

		output[i] = count > 0 ? sum / count : input[Math.min(start, input.length - 1)];
	}

	return output;
}

function calculateRms(audio: Float32Array): number {
	if (audio.length === 0) {
		return 0;
	}

	let sum = 0;

	for (let i = 0; i < audio.length; i += 1) {
		sum += audio[i] * audio[i];
	}

	return Math.sqrt(sum / audio.length);
}

export function useAudioStream(
	sessionId: string,
	participantId?: string,
	displayName?: string
): {
	startAudioStream: (mode: AudioStreamMode, roomNameOverride?: string) => Promise<void>;
	stopAudioStream: () => void;
	isAudioStreaming: boolean;
	isAudioConnected: boolean;
	lastAudioMessage: AudioStreamMessage | null;
	audioError: string | null;
} {
	const [isAudioStreaming, setIsAudioStreaming] = useState(false);
	const [isAudioConnected, setIsAudioConnected] = useState(false);
	const [lastAudioMessage, setLastAudioMessage] = useState<AudioStreamMessage | null>(null);
	const [audioError, setAudioError] = useState<string | null>(null);

	const socketRef = useRef<WebSocket | null>(null);
	const mediaStreamRef = useRef<MediaStream | null>(null);
	const audioContextRef = useRef<AudioContext | null>(null);
	const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
	const processorNodeRef = useRef<ScriptProcessorNode | null>(null);
	const silentGainRef = useRef<GainNode | null>(null);

	const pendingSamplesRef = useRef<Float32Array>(new Float32Array(0));
	const sentChunksRef = useRef(0);
	const stoppingRef = useRef(false);
	const activeMetaRef = useRef<ActiveAudioMeta | null>(null);

	const cleanupAudioResources = useCallback(() => {
		processorNodeRef.current?.disconnect();
		sourceNodeRef.current?.disconnect();
		silentGainRef.current?.disconnect();

		if (processorNodeRef.current) {
			processorNodeRef.current.onaudioprocess = null;
		}

		processorNodeRef.current = null;
		sourceNodeRef.current = null;
		silentGainRef.current = null;

		mediaStreamRef.current?.getTracks().forEach(track => {
			track.stop();
		});
		mediaStreamRef.current = null;

		if (audioContextRef.current && audioContextRef.current.state !== "closed") {
			void audioContextRef.current.close().catch(error => {
				console.warn("[audio-ws] failed to close AudioContext", error);
			});
		}

		audioContextRef.current = null;
		pendingSamplesRef.current = new Float32Array(0);
		sentChunksRef.current = 0;
	}, []);

	const sendStopMessage = useCallback(() => {
		const socket = socketRef.current;
		const meta = activeMetaRef.current;

		if (!socket || socket.readyState !== WebSocket.OPEN || !meta) {
			return;
		}

		const stopMessage = {
			type: "stop",
			source: sourceForMode(meta.mode),
			scope: meta.mode,
			agentType: agentTypeForMode(meta.mode),
			roomName: meta.roomName,
			participantId: meta.participantId,
			userId: meta.participantId,
			displayName: meta.displayName,
			clientId: meta.clientId
		};

		console.info("[audio-ws] send stop", stopMessage);
		socket.send(JSON.stringify(stopMessage));
	}, []);

	const stopAudioStream = useCallback(() => {
		stoppingRef.current = true;

		try {
			sendStopMessage();
		} catch (error) {
			console.warn("[audio-ws] failed to send stop message", error);
		}

		if (socketRef.current) {
			try {
				socketRef.current.close(1000, "client_stop");
			} catch (error) {
				console.warn("[audio-ws] failed to close socket", error);
			}
		}

		socketRef.current = null;

		cleanupAudioResources();

		setIsAudioConnected(false);
		setIsAudioStreaming(false);

		activeMetaRef.current = null;
	}, [cleanupAudioResources, sendStopMessage]);

	const sendAudioSamples = useCallback((samples: Float32Array) => {
		const socket = socketRef.current;

		if (!socket || socket.readyState !== WebSocket.OPEN) {
			return;
		}

		const pending = pendingSamplesRef.current;
		const merged = new Float32Array(pending.length + samples.length);

		merged.set(pending, 0);
		merged.set(samples, pending.length);

		let offset = 0;

		while (offset + OUTPUT_CHUNK_SIZE <= merged.length) {
			const chunk = merged.slice(offset, offset + OUTPUT_CHUNK_SIZE);
			offset += OUTPUT_CHUNK_SIZE;

			socket.send(chunk.buffer);

			sentChunksRef.current += 1;

			if (sentChunksRef.current % 100 === 0) {
				console.info("[audio-ws] sent PCM chunks", {
					chunks: sentChunksRef.current,
					rms: calculateRms(chunk),
					samplesPerChunk: OUTPUT_CHUNK_SIZE,
					sampleRate: TARGET_SAMPLE_RATE
				});
			}
		}

		pendingSamplesRef.current = merged.slice(offset);
	}, []);

	const startAudioStream = useCallback(
		async (mode: AudioStreamMode, roomNameOverride?: string) => {
			if (!sessionId) {
				setAudioError("Cannot start audio stream: sessionId is empty.");
				return;
			}

			if (!participantId) {
				setAudioError("Cannot start audio stream: participantId is empty.");
				return;
			}

			stopAudioStream();

			stoppingRef.current = false;
			setAudioError(null);
			setLastAudioMessage(null);

			const roomName = roomNameOverride || sessionId;
			const resolvedDisplayName = displayName || participantId;
			const clientId = makeClientId();

			activeMetaRef.current = {
				mode,
				roomName,
				sessionId,
				participantId,
				displayName: resolvedDisplayName,
				clientId
			};

			const wsBaseUrl = getAudioWsBaseUrl();
			const wsUrl = `${wsBaseUrl}/sessions/${encodeURIComponent(sessionId)}` + `/audio-stream?participant_id=${encodeURIComponent(participantId)}`;

			console.info("[audio-ws] connecting", {
				mode,
				sessionId,
				participantId,
				roomName,
				wsUrl
			});

			try {
				const mediaStream = await navigator.mediaDevices.getUserMedia({
					video: false,
					audio: {
						echoCancellation: true,
						noiseSuppression: true,
						autoGainControl: true
					}
				});

				mediaStreamRef.current = mediaStream;

				const AudioContextConstructor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

				if (!AudioContextConstructor) {
					throw new Error("AudioContext is not supported in this browser.");
				}

				const audioContext = new AudioContextConstructor();
				audioContextRef.current = audioContext;

				if (audioContext.state === "suspended") {
					await audioContext.resume();
				}

				const sourceNode = audioContext.createMediaStreamSource(mediaStream);
				const processorNode = audioContext.createScriptProcessor(4096, 1, 1);
				const silentGain = audioContext.createGain();

				silentGain.gain.value = 0;

				sourceNode.connect(processorNode);
				processorNode.connect(silentGain);
				silentGain.connect(audioContext.destination);

				sourceNodeRef.current = sourceNode;
				processorNodeRef.current = processorNode;
				silentGainRef.current = silentGain;

				const socket = new WebSocket(wsUrl);
				socket.binaryType = "arraybuffer";
				socketRef.current = socket;

				socket.onopen = () => {
					const meta = activeMetaRef.current;

					if (!meta) {
						return;
					}

					const startMessage = {
						type: "start",
						source: sourceForMode(meta.mode),
						scope: meta.mode,
						agentType: agentTypeForMode(meta.mode),
						roomName: meta.roomName,
						participantId: meta.participantId,
						userId: meta.participantId,
						displayName: meta.displayName,
						clientId: meta.clientId,
						sampleRate: TARGET_SAMPLE_RATE,
						channels: 1,
						encoding: "float32",
						format: "float32"
					};

					console.info("[audio-ws] open", {
						sessionId: meta.sessionId,
						participantId: meta.participantId,
						mode: meta.mode
					});

					console.info("[audio-ws] send start", startMessage);
					socket.send(JSON.stringify(startMessage));

					setIsAudioConnected(true);
					setIsAudioStreaming(true);
				};

				socket.onmessage = event => {
					if (typeof event.data !== "string") {
						console.info("[audio-ws] receive binary", event.data);
						return;
					}

					try {
						const parsedMessage = JSON.parse(event.data) as AudioStreamMessage;
						console.info("[audio-ws] receive", parsedMessage);
						setLastAudioMessage(parsedMessage);
					} catch {
						console.info("[audio-ws] receive raw", event.data);
						setLastAudioMessage({
							type: "raw_message",
							payload: event.data
						});
					}
				};

				socket.onerror = event => {
					console.error("[audio-ws] error", event);
					setAudioError("Audio WebSocket error. Check backend or nginx proxy.");
				};

				socket.onclose = event => {
					console.warn("[audio-ws] close", {
						code: event.code,
						reason: event.reason,
						wasClean: event.wasClean
					});

					setIsAudioConnected(false);
					setIsAudioStreaming(false);

					if (!stoppingRef.current) {
						cleanupAudioResources();
					}
				};

				processorNode.onaudioprocess = event => {
					const output = event.outputBuffer.getChannelData(0);
					output.fill(0);

					const input = event.inputBuffer.getChannelData(0);
					const inputCopy = new Float32Array(input);

					const downsampled = downsampleTo16k(inputCopy, audioContext.sampleRate);

					sendAudioSamples(downsampled);
				};
			} catch (error) {
				cleanupAudioResources();

				const message = error instanceof Error ? error.message : String(error);
				console.error("[audio-ws] failed to start", error);
				setAudioError(message);
				setIsAudioConnected(false);
				setIsAudioStreaming(false);
			}
		},
		[cleanupAudioResources, displayName, participantId, sendAudioSamples, sessionId, stopAudioStream]
	);

	useEffect(() => {
		return () => {
			stopAudioStream();
		};
	}, [stopAudioStream]);

	return {
		startAudioStream,
		stopAudioStream,
		isAudioStreaming,
		isAudioConnected,
		lastAudioMessage,
		audioError
	};
}
