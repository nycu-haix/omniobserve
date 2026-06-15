import type IJitsiMeetExternalApi from "@jitsi/react-sdk/lib/types/IJitsiMeetExternalApi";
import { Loader2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getJitsiNoiseSuppressionCommandConfig } from "../lib/jitsiAudio";
import type { MicMode } from "../types";

interface JitsiRoomProps {
	meetingDomain?: string;
	roomName?: string;
	displayName?: string;
	micMode: MicMode;
	allowInteraction?: boolean;
	onApiReady?: (api: IJitsiMeetExternalApi) => void;
	onStatusChange?: (status: JitsiConnectionStatus) => void;
	onAudioParticipantsChange?: (snapshot: JitsiAudioSnapshot) => void;
}

export type JitsiConnectionStatus = "loading" | "connected" | "closed" | "unavailable";

export interface JitsiAudioParticipant {
	id: string;
	displayName: string;
	isMuted: boolean;
	isLocal: boolean;
	isDominant: boolean;
}

export interface JitsiAudioSnapshot {
	participants: JitsiAudioParticipant[];
	dominantSpeakerId: string | null;
	connected: boolean;
}

const JITSI_AUDIO_SYNC_RECHECK_DELAY_MS = 250;
const JITSI_AUDIO_JOIN_RECHECK_DELAY_MS = 1000;

type JitsiEventListener = (...args: unknown[]) => void;
type JitsiMeetExternalApiConstructor = new (
	domain: string,
	options: {
		roomName: string;
		parentNode: HTMLElement;
		width?: string | number;
		height?: string | number;
		noSSL?: boolean;
		userInfo?: {
			displayName?: string;
			email?: string;
		};
		configOverwrite?: Record<string, unknown>;
		interfaceConfigOverwrite?: Record<string, unknown>;
	}
) => IJitsiMeetExternalApi;

declare global {
	interface Window {
		JitsiMeetExternalAPI?: JitsiMeetExternalApiConstructor;
	}
}

const externalApiScriptPromises = new Map<string, Promise<JitsiMeetExternalApiConstructor>>();

interface JitsiAudioMuteStatusEvent {
	muted?: boolean;
	isMuted?: boolean;
}

interface JitsiParticipantAudioState {
	id: string;
	displayName: string;
	isMuted?: boolean;
	isLocal: boolean;
}

interface JitsiVideoConferenceJoinedEvent {
	id?: string;
	displayName?: string;
}

interface JitsiParticipantJoinedEvent {
	id?: string;
	displayName?: string;
}

interface JitsiParticipantLeftEvent {
	id?: string;
}

interface JitsiDisplayNameChangeEvent {
	id?: string;
	displayName?: string;
	displayname?: string;
}

interface JitsiParticipantMutedEvent {
	participantId?: string;
	id?: string;
	isMuted?: boolean;
	muted?: boolean;
	mediaType?: string;
}

interface JitsiDominantSpeakerChangedEvent {
	id?: string;
	participantId?: string;
}

interface JitsiRoomInfoParticipant {
	id?: string;
	displayName?: string;
}

interface JitsiRoomsInfoResponse {
	rooms?: {
		isMainRoom?: boolean;
		participants?: JitsiRoomInfoParticipant[];
	}[];
}

type JitsiExternalApiWithRoomsInfo = IJitsiMeetExternalApi & {
	getRoomsInfo?: () => Promise<JitsiRoomsInfoResponse>;
};

interface JitsiEndpoint {
	baseUrl: string;
	host: string;
	noSSL: boolean;
}

function parseJitsiEndpoint(meetingDomain?: string): JitsiEndpoint | null {
	if (!meetingDomain) {
		return null;
	}

	try {
		const normalizedDomain = meetingDomain.includes("://") ? meetingDomain : `https://${meetingDomain}`;
		const url = new URL(normalizedDomain);

		if (!url.host) {
			return null;
		}

		return {
			baseUrl: url.origin,
			host: url.host,
			noSSL: url.protocol === "http:"
		};
	} catch {
		return null;
	}
}

function loadJitsiExternalApi(endpoint: JitsiEndpoint): Promise<JitsiMeetExternalApiConstructor> {
	const scriptKey = `${endpoint.baseUrl}|${endpoint.noSSL ? "http" : "https"}`;
	const existingPromise = externalApiScriptPromises.get(scriptKey);
	if (existingPromise) {
		return existingPromise;
	}

	const promise = new Promise<JitsiMeetExternalApiConstructor>((resolve, reject) => {
		if (window.JitsiMeetExternalAPI && !endpoint.noSSL) {
			resolve(window.JitsiMeetExternalAPI);
			return;
		}

		const script = document.createElement("script");
		script.async = true;
		const fail = (error: Error) => {
			script.remove();
			reject(error);
		};

		if (endpoint.noSSL) {
			script.src = "/__jitsi_external_api.js";
			script.onload = () => {
				if (window.JitsiMeetExternalAPI) {
					resolve(window.JitsiMeetExternalAPI);
				} else {
					fail(new Error("Patched Jitsi external API script loaded without JitsiMeetExternalAPI"));
				}
			};
			script.onerror = () => fail(new Error(`Failed to load patched Jitsi external API from ${script.src}`));
			document.head.appendChild(script);
			return;
		}

		script.src = `${endpoint.baseUrl}/external_api.js`;
		script.onload = () => {
			if (window.JitsiMeetExternalAPI) {
				resolve(window.JitsiMeetExternalAPI);
			} else {
				fail(new Error("Jitsi external API script loaded without JitsiMeetExternalAPI"));
			}
		};
		script.onerror = () => fail(new Error(`Failed to load Jitsi external API from ${script.src}`));
		document.head.appendChild(script);
	});

	const retryablePromise = promise.catch(error => {
		externalApiScriptPromises.delete(scriptKey);
		throw error;
	});

	externalApiScriptPromises.set(scriptKey, retryablePromise);
	return retryablePromise;
}

function renderJitsiError(title: string, message: string) {
	return (
		<div className="grid h-full min-h-24 place-items-center text-muted-foreground">
			<div className="text-center">
				<div className="text-lg font-semibold text-foreground">{title}</div>
				<div className="text-sm">{message}</div>
			</div>
		</div>
	);
}

function wait(milliseconds: number): Promise<void> {
	return new Promise(resolve => window.setTimeout(resolve, milliseconds));
}

function getFallbackParticipantName(id: string) {
	return id ? `Participant ${id}` : "Participant";
}

function getParticipantMergeKey(participant: JitsiAudioParticipant) {
	const displayName = participant.displayName.trim();
	return displayName && !displayName.startsWith("Participant ") ? `name:${displayName.toLocaleLowerCase()}` : `id:${participant.id}`;
}

export function JitsiRoom({ meetingDomain, roomName, displayName = "OmniObserve User", micMode, allowInteraction = false, onApiReady, onStatusChange, onAudioParticipantsChange }: JitsiRoomProps) {
	const apiRef = useRef<IJitsiMeetExternalApi | null>(null);
	const containerRef = useRef<HTMLDivElement | null>(null);
	const desiredAudioMutedRef = useRef(micMode !== "public");
	const audioSyncQueueRef = useRef<Promise<void>>(Promise.resolve());
	const jitsiListenersRef = useRef<{ api: IJitsiMeetExternalApi; listeners: [string, JitsiEventListener][] } | null>(null);
	const audioParticipantsRef = useRef<Map<string, JitsiParticipantAudioState>>(new Map());
	const dominantSpeakerIdRef = useRef<string | null>(null);
	const localParticipantIdRef = useRef<string | null>(null);
	const audioConnectedRef = useRef(false);
	const onAudioParticipantsChangeRef = useRef(onAudioParticipantsChange);
	const [readyMeetingKey, setReadyMeetingKey] = useState<string | null>(null);
	const [initError, setInitError] = useState<string | null>(null);
	const endpoint = useMemo(() => parseJitsiEndpoint(meetingDomain), [meetingDomain]);
	const normalizedRoomName = roomName?.trim();
	const meetingKey = endpoint && normalizedRoomName ? `${endpoint.baseUrl}/${normalizedRoomName}` : null;
	const isReady = readyMeetingKey === meetingKey;

	const emitAudioSnapshot = useCallback(() => {
		const dominantSpeakerId = dominantSpeakerIdRef.current;
		const participantsByDisplayName = new Map<string, JitsiAudioParticipant>();

		Array.from(audioParticipantsRef.current.values()).forEach(participant => {
			const candidate = {
				id: participant.id,
				displayName: participant.displayName || getFallbackParticipantName(participant.id),
				isMuted: participant.isMuted ?? true,
				isLocal: participant.isLocal,
				isDominant: participant.id === dominantSpeakerId
			};
			const mergeKey = getParticipantMergeKey(candidate);
			const existing = participantsByDisplayName.get(mergeKey);

			participantsByDisplayName.set(
				mergeKey,
				existing
					? {
							id: candidate.isDominant ? candidate.id : existing.id,
							displayName: existing.displayName,
							isMuted: existing.isMuted && candidate.isMuted,
							isLocal: existing.isLocal || candidate.isLocal,
							isDominant: existing.isDominant || candidate.isDominant
						}
					: candidate
			);
		});

		const participants = Array.from(participantsByDisplayName.values()).sort((first, second) => {
			if (first.isDominant !== second.isDominant) return first.isDominant ? -1 : 1;
			if (first.isMuted !== second.isMuted) return first.isMuted ? 1 : -1;
			if (first.isLocal !== second.isLocal) return first.isLocal ? -1 : 1;
			return first.displayName.localeCompare(second.displayName);
		});

		onAudioParticipantsChangeRef.current?.({
			participants,
			dominantSpeakerId,
			connected: audioConnectedRef.current
		});
	}, []);

	const resetAudioSnapshot = useCallback(() => {
		audioParticipantsRef.current.clear();
		dominantSpeakerIdRef.current = null;
		localParticipantIdRef.current = null;
		audioConnectedRef.current = false;
		emitAudioSnapshot();
	}, [emitAudioSnapshot]);

	const resolveAudioParticipantId = useCallback((id: string | undefined) => {
		const participantId = id?.trim();
		if (!participantId) {
			return undefined;
		}

		return participantId === "local" ? (localParticipantIdRef.current ?? participantId) : participantId;
	}, []);

	const upsertAudioParticipant = useCallback(
		(id: string | undefined, patch: Partial<Omit<JitsiParticipantAudioState, "id">>, shouldEmit = true) => {
			const participantId = id?.trim();
			if (!participantId) {
				return;
			}

			const existing = audioParticipantsRef.current.get(participantId);
			audioParticipantsRef.current.set(participantId, {
				id: participantId,
				displayName: patch.displayName ?? existing?.displayName ?? getFallbackParticipantName(participantId),
				isMuted: patch.isMuted ?? existing?.isMuted,
				isLocal: patch.isLocal ?? existing?.isLocal ?? false
			});

			if (shouldEmit) {
				emitAudioSnapshot();
			}
		},
		[emitAudioSnapshot]
	);

	const refreshAudioParticipantsFromRooms = useCallback(
		async (api: IJitsiMeetExternalApi) => {
			try {
				const roomsApi = api as JitsiExternalApiWithRoomsInfo;
				if (typeof roomsApi.getRoomsInfo === "function") {
					const roomsInfo = await roomsApi.getRoomsInfo();
					if (apiRef.current !== api) {
						return;
					}

					const room = roomsInfo.rooms?.find(candidate => candidate.isMainRoom) ?? roomsInfo.rooms?.[0];
					room?.participants?.forEach(participant => {
						const participantId = resolveAudioParticipantId(participant.id);
						upsertAudioParticipant(
							participantId,
							{
								displayName: participant.displayName,
								isLocal: participant.id === "local" || participantId === localParticipantIdRef.current
							},
							false
						);
					});
					emitAudioSnapshot();
					return;
				}

				api.getParticipantsInfo().forEach(participantInfo => {
					const participant = participantInfo as JitsiRoomInfoParticipant;
					const participantId = resolveAudioParticipantId(participant.id);
					upsertAudioParticipant(
						participantId,
						{
							displayName: participant.displayName,
							isLocal: participant.id === "local" || participantId === localParticipantIdRef.current
						},
						false
					);
				});
				emitAudioSnapshot();
			} catch (error) {
				console.warn("[jitsi] failed to refresh participant audio state", error);
			}
		},
		[emitAudioSnapshot, resolveAudioParticipantId, upsertAudioParticipant]
	);

	useEffect(() => {
		onAudioParticipantsChangeRef.current = onAudioParticipantsChange;
		emitAudioSnapshot();
	}, [emitAudioSnapshot, onAudioParticipantsChange]);

	const syncJitsiNoiseSuppression = useCallback((reason: string) => {
		const api = apiRef.current;
		if (!api) {
			return;
		}

		try {
			api.executeCommand("setNoiseSuppressionEnabled", getJitsiNoiseSuppressionCommandConfig());
		} catch (error) {
			console.warn("[jitsi] failed to sync noise suppression", { reason, error });
		}
	}, []);

	const syncJitsiAudioMuted = useCallback(
		(reason: string) => {
			audioSyncQueueRef.current = audioSyncQueueRef.current
				.catch(() => undefined)
				.then(async () => {
					const api = apiRef.current;
					if (!api) {
						return;
					}

					try {
						const targetMuted = desiredAudioMutedRef.current;
						const currentlyMuted = await api.isAudioMuted();

						if (apiRef.current !== api) {
							return;
						}

						if (currentlyMuted !== targetMuted) {
							console.info("[jitsi] correcting audio mute state", { reason, targetMuted, currentlyMuted });
							api.executeCommand("toggleAudio");
							await wait(JITSI_AUDIO_SYNC_RECHECK_DELAY_MS);
						}

						const verifiedMuted = await api.isAudioMuted();
						const latestTargetMuted = desiredAudioMutedRef.current;

						if (apiRef.current === api && verifiedMuted !== latestTargetMuted) {
							console.info("[jitsi] retrying audio mute correction", { reason, latestTargetMuted, verifiedMuted });
							api.executeCommand("toggleAudio");
						}

						syncJitsiNoiseSuppression(reason);
					} catch (error) {
						console.warn("[jitsi] failed to sync audio mute state", { reason, error });
					}
				});
		},
		[syncJitsiNoiseSuppression]
	);

	const detachJitsiListeners = useCallback(() => {
		const listenerRegistration = jitsiListenersRef.current;
		if (!listenerRegistration) {
			return;
		}

		listenerRegistration.listeners.forEach(([eventName, listener]) => {
			listenerRegistration.api.off(eventName, listener);
		});
		jitsiListenersRef.current = null;
	}, []);

	useEffect(() => {
		onStatusChange?.(endpoint && normalizedRoomName ? "loading" : "unavailable");

		return () => {
			onStatusChange?.("closed");
		};
	}, [endpoint, normalizedRoomName, onStatusChange]);

	useEffect(() => {
		desiredAudioMutedRef.current = micMode !== "public";
		syncJitsiAudioMuted("micMode");
	}, [micMode, syncJitsiAudioMuted]);

	useEffect(() => detachJitsiListeners, [detachJitsiListeners]);

	useEffect(() => resetAudioSnapshot, [resetAudioSnapshot]);

	useEffect(() => {
		const parentNode = containerRef.current;
		if (!endpoint || !normalizedRoomName || !parentNode) {
			return;
		}

		let disposed = false;
		let api: IJitsiMeetExternalApi | null = null;

		parentNode.replaceChildren();
		setReadyMeetingKey(null);
		setInitError(null);
		onStatusChange?.("loading");

		void loadJitsiExternalApi(endpoint)
			.then(JitsiMeetExternalAPI => {
				if (disposed) {
					return;
				}

				api = new JitsiMeetExternalAPI(endpoint.host, {
					roomName: normalizedRoomName,
					parentNode,
					width: "100%",
					height: "100%",
					noSSL: endpoint.noSSL,
					userInfo: {
						displayName,
						email: ""
					},
					configOverwrite: {
						prejoinPageEnabled: false,
						prejoinConfig: {
							enabled: false
						},
						startWithAudioMuted: true,
						startWithVideoMuted: true,
						toolbarButtons: [],
						disableDeepLinking: true,
						disableInviteFunctions: true,
						notifications: []
					},
					interfaceConfigOverwrite: {
						TOOLBAR_BUTTONS: [],
						VIDEO_LAYOUT_FIT: "nocrop",
						SHOW_JITSI_WATERMARK: false,
						SHOW_WATERMARK_FOR_GUESTS: false,
						SHOW_BRAND_WATERMARK: false,
						SHOW_POWERED_BY: false,
						SHOW_CHROME_EXTENSION_BANNER: false,
						DISABLE_JOIN_LEAVE_NOTIFICATIONS: true
					}
				});

				detachJitsiListeners();
				apiRef.current = api;

				const handleVideoConferenceJoined = (event: JitsiVideoConferenceJoinedEvent) => {
					audioConnectedRef.current = true;
					localParticipantIdRef.current = event.id ?? localParticipantIdRef.current;
					upsertAudioParticipant(event.id, {
						displayName: event.displayName || displayName,
						isLocal: true
					});
					void api?.isAudioMuted().then(muted => {
						if (apiRef.current === api) {
							upsertAudioParticipant(event.id, { isMuted: muted });
						}
					});
					void refreshAudioParticipantsFromRooms(api as IJitsiMeetExternalApi);
					syncJitsiNoiseSuppression("videoConferenceJoined");
					syncJitsiAudioMuted("videoConferenceJoined");
					window.setTimeout(() => syncJitsiAudioMuted("videoConferenceJoined-recheck"), JITSI_AUDIO_JOIN_RECHECK_DELAY_MS);
				};
				const handleAudioMuteStatusChanged = (event: JitsiAudioMuteStatusEvent) => {
					const reportedMuted = typeof event.muted === "boolean" ? event.muted : event.isMuted;
					if (typeof reportedMuted === "boolean") {
						const participantId = resolveAudioParticipantId(localParticipantIdRef.current ?? "local");
						if (reportedMuted && participantId && dominantSpeakerIdRef.current === participantId) {
							dominantSpeakerIdRef.current = null;
						}
						upsertAudioParticipant(participantId, {
							displayName,
							isLocal: true,
							isMuted: reportedMuted
						});
					}
					if (reportedMuted === false && desiredAudioMutedRef.current) {
						syncJitsiAudioMuted("audioMuteStatusChanged");
					}
				};
				const handleParticipantJoined = (event: JitsiParticipantJoinedEvent) => {
					upsertAudioParticipant(event.id, {
						displayName: event.displayName,
						isMuted: true,
						isLocal: false
					});
				};
				const handleParticipantLeft = (event: JitsiParticipantLeftEvent) => {
					const participantId = event.id?.trim();
					if (!participantId) {
						return;
					}
					audioParticipantsRef.current.delete(participantId);
					if (dominantSpeakerIdRef.current === participantId) {
						dominantSpeakerIdRef.current = null;
					}
					emitAudioSnapshot();
				};
				const handleDisplayNameChange = (event: JitsiDisplayNameChangeEvent) => {
					const participantId = resolveAudioParticipantId(event.id);
					const isLocalParticipant = event.id === "local" || participantId === localParticipantIdRef.current;
					upsertAudioParticipant(participantId, {
						displayName: isLocalParticipant ? displayName : (event.displayName ?? event.displayname),
						isLocal: isLocalParticipant
					});
				};
				const handleParticipantMuted = (event: JitsiParticipantMutedEvent) => {
					if (event.mediaType && event.mediaType !== "audio") {
						return;
					}

					const reportedMuted = typeof event.isMuted === "boolean" ? event.isMuted : event.muted;
					if (typeof reportedMuted !== "boolean") {
						return;
					}

					const eventParticipantId = event.participantId ?? event.id;
					const participantId = resolveAudioParticipantId(eventParticipantId);
					const isLocalParticipant = eventParticipantId === "local" || participantId === localParticipantIdRef.current;
					if (reportedMuted && participantId && dominantSpeakerIdRef.current === participantId) {
						dominantSpeakerIdRef.current = null;
					}
					upsertAudioParticipant(participantId, {
						displayName: isLocalParticipant ? displayName : undefined,
						isLocal: isLocalParticipant || undefined,
						isMuted: reportedMuted
					});
				};
				const handleDominantSpeakerChanged = (event: JitsiDominantSpeakerChangedEvent) => {
					const eventParticipantId = event.id ?? event.participantId;
					const participantId = resolveAudioParticipantId(eventParticipantId);
					const isLocalParticipant = eventParticipantId === "local" || participantId === localParticipantIdRef.current;
					dominantSpeakerIdRef.current = participantId ?? null;

					if (participantId) {
						upsertAudioParticipant(
							participantId,
							{
								displayName: isLocalParticipant ? displayName : api?.getDisplayName(participantId),
								isLocal: isLocalParticipant || undefined
							},
							false
						);
					}

					emitAudioSnapshot();
				};
				const handleReadyToClose = () => {
					detachJitsiListeners();
					apiRef.current = null;
					resetAudioSnapshot();
					setReadyMeetingKey(null);
					onStatusChange?.("closed");
				};
				const listeners: [string, JitsiEventListener][] = [
					["videoConferenceJoined", handleVideoConferenceJoined as JitsiEventListener],
					["audioMuteStatusChanged", handleAudioMuteStatusChanged as JitsiEventListener],
					["participantJoined", handleParticipantJoined as JitsiEventListener],
					["participantLeft", handleParticipantLeft as JitsiEventListener],
					["displayNameChange", handleDisplayNameChange as JitsiEventListener],
					["participantMuted", handleParticipantMuted as JitsiEventListener],
					["dominantSpeakerChanged", handleDominantSpeakerChanged as JitsiEventListener],
					["readyToClose", handleReadyToClose]
				];

				listeners.forEach(([eventName, listener]) => api?.on(eventName, listener));
				jitsiListenersRef.current = { api, listeners };

				setReadyMeetingKey(meetingKey);
				onStatusChange?.("connected");
				syncJitsiNoiseSuppression("apiReady");
				syncJitsiAudioMuted("apiReady");
				onApiReady?.(api);
			})
			.catch(error => {
				console.warn("[jitsi] failed to initialize external API", error);
				if (!disposed) {
					setInitError(error instanceof Error ? error.message : String(error));
					onStatusChange?.("unavailable");
				}
			});

		return () => {
			disposed = true;
			detachJitsiListeners();
			apiRef.current = null;
			resetAudioSnapshot();
			if (api) {
				(api as { dispose?: () => void }).dispose?.();
			}
			parentNode.replaceChildren();
			setReadyMeetingKey(null);
		};
	}, [
		detachJitsiListeners,
		displayName,
		emitAudioSnapshot,
		endpoint,
		meetingKey,
		normalizedRoomName,
		onApiReady,
		onStatusChange,
		refreshAudioParticipantsFromRooms,
		resetAudioSnapshot,
		resolveAudioParticipantId,
		syncJitsiAudioMuted,
		syncJitsiNoiseSuppression,
		upsertAudioParticipant
	]);

	if (!endpoint) {
		return renderJitsiError("Jitsi Unavailable", "Set VITE_JITSI_BASE_URL to show Jitsi");
	}

	if (!normalizedRoomName) {
		return renderJitsiError("Public Meeting", "Set room_name or VITE_DEFAULT_ROOM_NAME to show Jitsi");
	}

	return (
		<div className="relative h-full min-h-24">
			{initError && <div className="absolute inset-0 z-30 bg-background">{renderJitsiError("Jitsi Unavailable", initError)}</div>}
			{!isReady && !initError && (
				<div className="absolute inset-0 z-10 grid place-items-center bg-muted text-muted-foreground">
					<Loader2 className="h-6 w-6 animate-spin" />
				</div>
			)}
			{!allowInteraction && <div className="absolute inset-0 z-20" aria-hidden="true" />}
			<div ref={containerRef} className="h-full w-full" />
		</div>
	);
}
