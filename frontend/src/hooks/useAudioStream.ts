import { useCallback, useEffect, useRef, useState } from "react";

export type AudioStreamMode = "public" | "private";

interface AudioStreamMessage {
	type?: string;
	payload?: unknown;
	[key: string]: unknown;
}

interface ActiveAudioMeta {
	mode: AudioStreamMode;
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
	startAudioStream: (mode: AudioStreamMode) => Promise<void>;
	stopAudioStream: (keepAudioResources?: boolean) => Promise<void>;
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

	const waitForAudioStopAck = useCallback((socket: WebSocket): Promise<void> => {
		if (socket.readyState === WebSocket.CLOSED) {
			return Promise.resolve();
		}

		return new Promise(resolve => {
			let done = false;
			const timeout = window.setTimeout(() => finish(), 5000);

			const finish = () => {
				if (done) {
					return;
				}
				done = true;
				window.clearTimeout(timeout);
				socket.removeEventListener("message", handleMessage);
				socket.removeEventListener("close", finish);
				socket.removeEventListener("error", finish);
				resolve();
			};

			const handleMessage = (event: MessageEvent) => {
				if (typeof event.data !== "string") {
					return;
				}
				try {
					const message = JSON.parse(event.data) as AudioStreamMessage;
					if (message.type === "idea_blocks_update" || (message.type === "transcript_update" && message.is_final === true)) {
						finish();
					}
				} catch {
					// Ignore non-JSON messages here; the regular onmessage handler still records them.
				}
			};

			socket.addEventListener("message", handleMessage);
			socket.addEventListener("close", finish);
			socket.addEventListener("error", finish);
		});
	}, []);

	const stopAudioStream = useCallback(
		async (keepAudioResources = false) => {
			stoppingRef.current = true;

			const socket = socketRef.current;
			const meta = activeMetaRef.current;

			socketRef.current = null;
			activeMetaRef.current = null;

			try {
				if (socket && socket.readyState === WebSocket.OPEN) {
					const pending = pendingSamplesRef.current;
					if (pending.length > 0) {
						let offset = 0;
						while (offset < pending.length) {
							const chunk = pending.slice(offset, offset + OUTPUT_CHUNK_SIZE);
							offset += OUTPUT_CHUNK_SIZE;
							socket.send(chunk.buffer);
						}
					}

					if (meta) {
						const stopMessage = {
							type: "stop",
							source: sourceForMode(meta.mode),
							scope: meta.mode,
							agentType: agentTypeForMode(meta.mode),
							roomName: meta.sessionId,
							sessionName: meta.sessionId,
							participantId: meta.participantId,
							userId: meta.participantId,
							displayName: meta.displayName,
							clientId: meta.clientId
						};
						console.info("[audio-ws] send stop", stopMessage);
						socket.send(JSON.stringify(stopMessage));
					}
				}
			} catch (error) {
				console.warn("[audio-ws] failed to send final audio or stop message", error);
			}

			pendingSamplesRef.current = new Float32Array(0);

			if (!keepAudioResources) {
				cleanupAudioResources();
			}

			setIsAudioConnected(false);
			setIsAudioStreaming(false);

			if (socket) {
				await waitForAudioStopAck(socket);

				if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
					try {
						socket.close(1000, "client_stop");
					} catch (error) {
						console.warn("[audio-ws] failed to close socket", error);
					}
				}
			}
		},
		[cleanupAudioResources, waitForAudioStopAck]
	);

	const sendAudioSamples = useCallback((samples: Float32Array) => {
		const pending = pendingSamplesRef.current;
		const merged = new Float32Array(pending.length + samples.length);

		merged.set(pending, 0);
		merged.set(samples, pending.length);

		const MAX_SAMPLES = TARGET_SAMPLE_RATE * 5;
		if (merged.length > MAX_SAMPLES) {
			pendingSamplesRef.current = merged.slice(merged.length - MAX_SAMPLES);
		} else {
			pendingSamplesRef.current = merged;
		}

		const socket = socketRef.current;

		if (!socket || socket.readyState !== WebSocket.OPEN) {
			return;
		}

		let offset = 0;
		const currentPending = pendingSamplesRef.current;

		while (offset + OUTPUT_CHUNK_SIZE <= currentPending.length) {
			const chunk = currentPending.slice(offset, offset + OUTPUT_CHUNK_SIZE);
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

		pendingSamplesRef.current = currentPending.slice(offset);
	}, []);

	const startAudioStream = useCallback(
		async (mode: AudioStreamMode) => {
			if (!sessionId) {
				setAudioError("Cannot start audio stream: sessionId is empty.");
				return;
			}

			if (!participantId) {
				setAudioError("Cannot start audio stream: participantId is empty.");
				return;
			}

			const hasExistingAudio = !!mediaStreamRef.current;
			void stopAudioStream(true);

			stoppingRef.current = false;
			setAudioError(null);

			const resolvedDisplayName = displayName || participantId;
			const clientId = makeClientId();

			activeMetaRef.current = {
				mode,
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
				wsUrl
			});

			try {
				let audioContext = audioContextRef.current;
				let processorNode = processorNodeRef.current;

				if (!hasExistingAudio || !audioContext || !processorNode) {
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

					audioContext = new AudioContextConstructor();
					audioContextRef.current = audioContext;

					if (audioContext.state === "suspended") {
						await audioContext.resume();
					}

					const sourceNode = audioContext.createMediaStreamSource(mediaStream);
					processorNode = audioContext.createScriptProcessor(4096, 1, 1);
					const silentGain = audioContext.createGain();

					silentGain.gain.value = 0;

					processorNode.onaudioprocess = event => {
						if (!audioContextRef.current) return;
						const output = event.outputBuffer.getChannelData(0);
						output.fill(0);

						const input = event.inputBuffer.getChannelData(0);
						const inputCopy = new Float32Array(input);

						const downsampled = downsampleTo16k(inputCopy, audioContextRef.current.sampleRate);

						sendAudioSamples(downsampled);
					};

					sourceNode.connect(processorNode);
					processorNode.connect(silentGain);
					silentGain.connect(audioContext.destination);

					sourceNodeRef.current = sourceNode;
					processorNodeRef.current = processorNode;
					silentGainRef.current = silentGain;
				}

				const socket = new WebSocket(wsUrl);
				socket.binaryType = "arraybuffer";
				socketRef.current = socket;

				socket.onopen = () => {
					if (socketRef.current !== socket) {
						return;
					}

					const meta = activeMetaRef.current;

					if (!meta) {
						return;
					}

					const startMessage = {
						type: "start",
						source: sourceForMode(meta.mode),
						scope: meta.mode,
						agentType: agentTypeForMode(meta.mode),
						roomName: meta.sessionId,
						sessionName: meta.sessionId,
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

				const currentMode = mode;

				socket.onmessage = event => {
					if (typeof event.data !== "string") {
						console.info("[audio-ws] receive binary", event.data);
						return;
					}

					try {
						const parsedMessage = JSON.parse(event.data) as AudioStreamMessage;
						parsedMessage.local_mic_mode = currentMode;
						console.info("[audio-ws] receive", parsedMessage);
						setLastAudioMessage(parsedMessage);
					} catch {
						console.info("[audio-ws] receive raw", event.data);
						setLastAudioMessage({
							type: "raw_message",
							payload: event.data,
							local_mic_mode: currentMode
						});
					}
				};

				socket.onerror = event => {
					console.error("[audio-ws] error", event);
					if (socketRef.current === socket) {
						setAudioError("Audio WebSocket error. Check backend or nginx proxy.");
					}
				};

				socket.onclose = event => {
					console.warn("[audio-ws] close", {
						code: event.code,
						reason: event.reason,
						wasClean: event.wasClean
					});

					if (socketRef.current === socket) {
						setIsAudioConnected(false);
						setIsAudioStreaming(false);

						if (!stoppingRef.current) {
							cleanupAudioResources();
						}
					}
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
			void stopAudioStream();
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
