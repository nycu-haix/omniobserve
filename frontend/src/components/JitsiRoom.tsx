import { JitsiMeeting } from "@jitsi/react-sdk";
import type IJitsiMeetExternalApi from "@jitsi/react-sdk/lib/types/IJitsiMeetExternalApi";
import { Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
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

async function setJitsiAudioMuted(api: IJitsiMeetExternalApi | null, muted: boolean) {
	if (!api) {
		return;
	}

	const currentlyMuted = await api.isAudioMuted();
	if (currentlyMuted !== muted) {
		api.executeCommand("toggleAudio");
	}
}

export function JitsiRoom({ meetingDomain, roomName, displayName = "OmniObserve User", micMode, onApiReady, onStatusChange }: JitsiRoomProps) {
	const apiRef = useRef<IJitsiMeetExternalApi | null>(null);
	const [readyMeetingKey, setReadyMeetingKey] = useState<string | null>(null);
	const domain = parseJitsiDomain(meetingDomain);
	const normalizedRoomName = roomName?.trim();
	const meetingKey = domain && normalizedRoomName ? `${domain}/${normalizedRoomName}` : null;
	const isReady = readyMeetingKey === meetingKey;

	useEffect(() => {
		onStatusChange?.(domain && normalizedRoomName ? "loading" : "unavailable");

		return () => {
			onStatusChange?.("closed");
		};
	}, [domain, normalizedRoomName, onStatusChange]);

	useEffect(() => {
		void setJitsiAudioMuted(apiRef.current, micMode !== "public");
	}, [micMode]);

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
					apiRef.current = api;
					setReadyMeetingKey(meetingKey);
					onStatusChange?.("connected");
					void setJitsiAudioMuted(api, micMode !== "public");
					onApiReady?.(api);
				}}
				onReadyToClose={() => {
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
