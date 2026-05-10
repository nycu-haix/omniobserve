import { JitsiMeeting } from "@jitsi/react-sdk";
import type IJitsiMeetExternalApi from "@jitsi/react-sdk/lib/types/IJitsiMeetExternalApi";
import { Loader2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { MicMode } from "../types";

interface JitsiRoomProps {
	meetingDomain?: string;
	roomName?: string;
	displayName?: string;
	micMode: MicMode;
	onApiReady?: (api: IJitsiMeetExternalApi) => void;
	onStatusChange?: (status: JitsiConnectionStatus) => void;
}

export type JitsiConnectionStatus = "loading" | "connected" | "closed" | "unavailable";

const JITSI_AUDIO_SYNC_RECHECK_DELAY_MS = 250;
const JITSI_AUDIO_JOIN_RECHECK_DELAY_MS = 1000;

type JitsiEventListener = (...args: unknown[]) => void;

interface JitsiAudioMuteStatusEvent {
	muted?: boolean;
	isMuted?: boolean;
}

function parseJitsiDomain(meetingDomain?: string): string | null {
	if (!meetingDomain) {
		return null;
	}

	try {
		const normalizedDomain = meetingDomain.includes("://") ? meetingDomain : `https://${meetingDomain}`;
		const url = new URL(normalizedDomain);

		if (!url.hostname) {
			return null;
		}

		return url.hostname;
	} catch {
		return null;
	}
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

export function JitsiRoom({ meetingDomain, roomName, displayName = "OmniObserve User", micMode, onApiReady, onStatusChange }: JitsiRoomProps) {
	const apiRef = useRef<IJitsiMeetExternalApi | null>(null);
	const desiredAudioMutedRef = useRef(micMode !== "public");
	const audioSyncQueueRef = useRef<Promise<void>>(Promise.resolve());
	const jitsiListenersRef = useRef<{ api: IJitsiMeetExternalApi; listeners: [string, JitsiEventListener][] } | null>(null);
	const [readyMeetingKey, setReadyMeetingKey] = useState<string | null>(null);
	const domain = parseJitsiDomain(meetingDomain);
	const normalizedRoomName = roomName?.trim();
	const meetingKey = domain && normalizedRoomName ? `${domain}/${normalizedRoomName}` : null;
	const isReady = readyMeetingKey === meetingKey;

	const syncJitsiAudioMuted = useCallback((reason: string) => {
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
				} catch (error) {
					console.warn("[jitsi] failed to sync audio mute state", { reason, error });
				}
			});
	}, []);

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
		onStatusChange?.(domain && normalizedRoomName ? "loading" : "unavailable");

		return () => {
			onStatusChange?.("closed");
		};
	}, [domain, normalizedRoomName, onStatusChange]);

	useEffect(() => {
		desiredAudioMutedRef.current = micMode !== "public";
		syncJitsiAudioMuted("micMode");
	}, [micMode, syncJitsiAudioMuted]);

	useEffect(() => detachJitsiListeners, [detachJitsiListeners]);

	if (!domain) {
		return renderJitsiError("Jitsi Unavailable", "Set VITE_JITSI_BASE_URL to show Jitsi");
	}

	if (!normalizedRoomName) {
		return renderJitsiError("Public Meeting", "Set room_name or VITE_DEFAULT_ROOM_NAME to show Jitsi");
	}

	return (
		<div className="relative h-full min-h-24">
			{!isReady && (
				<div className="absolute inset-0 z-10 grid place-items-center bg-muted text-muted-foreground">
					<Loader2 className="h-6 w-6 animate-spin" />
				</div>
			)}
			{/* Transparent overlay to prevent iframe interaction */}
			<div className="absolute inset-0 z-20" />
			<JitsiMeeting
				domain={domain}
				roomName={normalizedRoomName}
				userInfo={{
					displayName,
					email: ""
				}}
				configOverwrite={{
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
				}}
				interfaceConfigOverwrite={{
					TOOLBAR_BUTTONS: [],
					VIDEO_LAYOUT_FIT: "nocrop",
					SHOW_JITSI_WATERMARK: false,
					SHOW_WATERMARK_FOR_GUESTS: false,
					SHOW_BRAND_WATERMARK: false,
					SHOW_POWERED_BY: false,
					SHOW_CHROME_EXTENSION_BANNER: false,
					DISABLE_JOIN_LEAVE_NOTIFICATIONS: true
				}}
				onApiReady={api => {
					detachJitsiListeners();
					apiRef.current = api;
					desiredAudioMutedRef.current = micMode !== "public";

					const handleVideoConferenceJoined = () => {
						syncJitsiAudioMuted("videoConferenceJoined");
						window.setTimeout(() => syncJitsiAudioMuted("videoConferenceJoined-recheck"), JITSI_AUDIO_JOIN_RECHECK_DELAY_MS);
					};
					const handleAudioMuteStatusChanged = (event: JitsiAudioMuteStatusEvent) => {
						const reportedMuted = typeof event.muted === "boolean" ? event.muted : event.isMuted;
						if (reportedMuted === false && desiredAudioMutedRef.current) {
							syncJitsiAudioMuted("audioMuteStatusChanged");
						}
					};
					const listeners: [string, JitsiEventListener][] = [
						["videoConferenceJoined", handleVideoConferenceJoined],
						["audioMuteStatusChanged", handleAudioMuteStatusChanged as JitsiEventListener]
					];

					listeners.forEach(([eventName, listener]) => api.on(eventName, listener));
					jitsiListenersRef.current = { api, listeners };

					setReadyMeetingKey(meetingKey);
					onStatusChange?.("connected");
					syncJitsiAudioMuted("apiReady");
					onApiReady?.(api);
				}}
				onReadyToClose={() => {
					detachJitsiListeners();
					apiRef.current = null;
					setReadyMeetingKey(null);
					onStatusChange?.("closed");
				}}
				getIFrameRef={parentNode => {
					parentNode.style.height = "100%";
					parentNode.style.width = "100%";
				}}
			/>
		</div>
	);
}
