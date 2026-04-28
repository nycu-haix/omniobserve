import { useEffect, useMemo, useRef, useState } from "react";
import { JitsiMeeting } from "@jitsi/react-sdk";
import type IJitsiMeetExternalApi from "@jitsi/react-sdk/lib/types/IJitsiMeetExternalApi";
import { Loader2 } from "lucide-react";
import type { MicMode } from "../types";

interface JitsiRoomProps {
  meetingUrl?: string;
  displayName?: string;
  micMode: MicMode;
  onApiReady?: (api: IJitsiMeetExternalApi) => void;
}

interface ParsedJitsiUrl {
  domain: string;
  roomName: string;
}

function parseJitsiUrl(meetingUrl?: string): ParsedJitsiUrl | null {
  if (!meetingUrl) {
    return null;
  }

  try {
    const url = new URL(meetingUrl);
    const roomName = url.pathname.replace(/^\/+/, "");

    if (!url.hostname || !roomName) {
      return null;
    }

    return {
      domain: url.hostname,
      roomName,
    };
  } catch {
    return null;
  }
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

export function JitsiRoom({
  meetingUrl,
  displayName = "OmniObserve User",
  micMode,
  onApiReady,
}: JitsiRoomProps) {
  const apiRef = useRef<IJitsiMeetExternalApi | null>(null);
  const [isReady, setIsReady] = useState(false);
  const meeting = useMemo(() => parseJitsiUrl(meetingUrl), [meetingUrl]);

  useEffect(() => {
    void setJitsiAudioMuted(apiRef.current, micMode !== "public");
  }, [micMode]);

  if (!meeting) {
    return (
      <div className="grid h-full min-h-[320px] place-items-center text-muted-foreground">
        <div className="text-center">
          <div className="text-lg font-semibold text-foreground">Public Meeting</div>
          <div className="text-sm">Set room_name or VITE_DEFAULT_ROOM_NAME to show Jitsi</div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative h-full min-h-[320px]">
      {!isReady && (
        <div className="absolute inset-0 z-10 grid place-items-center bg-muted text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      )}
      <JitsiMeeting
        domain={meeting.domain}
        roomName={meeting.roomName}
        userInfo={{
          displayName,
          email: "",
        }}
        configOverwrite={{
          prejoinPageEnabled: false,
          prejoinConfig: {
            enabled: false,
          },
          startWithAudioMuted: true,
          startWithVideoMuted: true,
          toolbarButtons: [],
          disableDeepLinking: true,
          disableInviteFunctions: true,
          notifications: [],
        }}
        interfaceConfigOverwrite={{
          TOOLBAR_BUTTONS: [],
          SHOW_JITSI_WATERMARK: false,
          SHOW_WATERMARK_FOR_GUESTS: false,
          SHOW_BRAND_WATERMARK: false,
          SHOW_POWERED_BY: false,
          SHOW_CHROME_EXTENSION_BANNER: false,
          DISABLE_JOIN_LEAVE_NOTIFICATIONS: true,
        }}
        onApiReady={(api) => {
          apiRef.current = api;
          setIsReady(true);
          void setJitsiAudioMuted(api, micMode !== "public");
          onApiReady?.(api);
        }}
        getIFrameRef={(parentNode) => {
          parentNode.style.height = "100%";
          parentNode.style.width = "100%";
        }}
      />
    </div>
  );
}
