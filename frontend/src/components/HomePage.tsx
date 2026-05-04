import { Check, Copy, ExternalLink } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { getDefaultRoomName } from "../lib/defaultRoomName";
import { getDefaultParticipantName, getNextAvailableParticipantId, isValidParticipantId, normalizeParticipantId } from "../lib/participantDefaults";
import { apiUrl } from "../services/api";
import { Button } from "./ui/Button";

const defaultSessionName = getDefaultRoomName();

function buildMeetingUrl(sessionName: string, participantId: string, displayName: string) {
	const params = new URLSearchParams();
	params.set("room_name", sessionName.trim() || defaultSessionName);
	params.set("id", normalizeParticipantId(participantId));
	params.set("name", displayName.trim() || "User");

	return `${window.location.origin}${window.location.pathname}?${params.toString()}`;
}

export function HomePage() {
	const [sessionName, setSessionName] = useState(defaultSessionName);
	const [participantId, setParticipantId] = useState("1");
	const [displayName, setDisplayName] = useState(getDefaultParticipantName("1"));
	const [copied, setCopied] = useState(false);
	const participantIdEditedRef = useRef(false);
	const displayNameEditedRef = useRef(false);
	const isParticipantIdValid = isValidParticipantId(participantId);
	const meetingUrl = useMemo(() => buildMeetingUrl(sessionName, participantId, displayName), [displayName, participantId, sessionName]);

	useEffect(() => {
		let disposed = false;
		let pollTimer: number | null = null;
		let abortController: AbortController | null = null;

		const syncAvailableParticipant = async () => {
			const normalizedSessionName = sessionName.trim() || defaultSessionName;
			abortController?.abort();
			abortController = new AbortController();

			try {
				const response = await fetch(apiUrl(`/api/sessions/${encodeURIComponent(normalizedSessionName)}/presence`), {
					signal: abortController.signal
				});
				if (!response.ok) {
					return;
				}

				const payload = (await response.json()) as { participants?: unknown };
				if (disposed || !Array.isArray(payload.participants)) {
					return;
				}

				const participants = payload.participants.filter((item): item is string => typeof item === "string");
				const nextParticipantId = getNextAvailableParticipantId(participants);

				if (!participantIdEditedRef.current) {
					setParticipantId(nextParticipantId);
					if (!displayNameEditedRef.current) {
						setDisplayName(getDefaultParticipantName(nextParticipantId));
					}
				}
			} catch (error) {
				if (error instanceof DOMException && error.name === "AbortError") {
					return;
				}
			}
		};

		void syncAvailableParticipant();
		pollTimer = window.setInterval(() => void syncAvailableParticipant(), 3000);

		return () => {
			disposed = true;
			abortController?.abort();
			if (pollTimer !== null) {
				window.clearInterval(pollTimer);
			}
		};
	}, [sessionName]);

	const copyUrl = async () => {
		if (!isParticipantIdValid) {
			return;
		}
		await navigator.clipboard.writeText(meetingUrl);
		setCopied(true);
		window.setTimeout(() => setCopied(false), 1600);
	};

	const enterMeeting = () => {
		if (!isParticipantIdValid) {
			return;
		}
		window.location.assign(meetingUrl);
	};

	return (
		<main className="min-h-screen bg-background text-foreground">
			<div className="mx-auto grid min-h-screen w-full max-w-5xl content-center gap-8 px-5 py-10">
				<header className="space-y-3">
					<p className="text-sm font-medium text-muted-foreground">OmniObserve</p>
					<h1 className="text-3xl font-semibold tracking-normal sm:text-4xl">建立會議連結</h1>
					<p className="max-w-2xl text-base leading-7 text-muted-foreground">填入本次活動需要的 session 與使用者資訊，下方會即時產生可分享的會議網址。</p>
				</header>

				<section className="grid gap-6 rounded-lg border bg-card p-5 text-card-foreground shadow-sm md:grid-cols-[minmax(0,1fr)_minmax(320px,420px)] md:p-6">
					<div className="grid gap-4">
						<label className="grid gap-2 text-sm font-medium">
							Session name
							<input
								className="h-11 rounded-md border bg-background px-3 text-base outline-none transition focus-visible:ring-1 focus-visible:ring-ring"
								value={sessionName}
								onChange={event => {
									participantIdEditedRef.current = false;
									displayNameEditedRef.current = false;
									setSessionName(event.target.value);
								}}
								placeholder={defaultSessionName}
							/>
						</label>

						<label className="grid gap-2 text-sm font-medium">
							Participant ID
							<input
								className="h-11 rounded-md border bg-background px-3 text-base outline-none transition focus-visible:ring-1 focus-visible:ring-ring"
								value={participantId}
								inputMode="numeric"
								pattern="[0-9]*"
								onChange={event => {
									const nextParticipantId = event.target.value.replace(/\D/g, "");
									participantIdEditedRef.current = true;
									setParticipantId(nextParticipantId);
									if (!displayNameEditedRef.current) {
										setDisplayName(getDefaultParticipantName(nextParticipantId.trim() || "1"));
									}
								}}
								placeholder="1"
								aria-invalid={!isParticipantIdValid}
							/>
							{!isParticipantIdValid && <span className="text-xs font-normal text-destructive">Participant ID 只能是整數。</span>}
						</label>

						<label className="grid gap-2 text-sm font-medium">
							Name
							<input
								className="h-11 rounded-md border bg-background px-3 text-base outline-none transition focus-visible:ring-1 focus-visible:ring-ring"
								value={displayName}
								onChange={event => {
									displayNameEditedRef.current = true;
									setDisplayName(event.target.value);
								}}
								placeholder="使用者顯示名稱"
							/>
						</label>
					</div>

					<div className="grid content-between gap-4 rounded-lg border bg-muted/40 p-4">
						<div className="grid gap-2">
							<div className="text-sm font-medium">產生的 URL</div>
							<div className="break-all rounded-md border bg-background p-3 font-mono text-sm leading-6 text-muted-foreground">{meetingUrl}</div>
						</div>

						<div className="flex flex-col gap-2 sm:flex-row md:flex-col">
							<Button type="button" onClick={copyUrl} className="gap-2" disabled={!isParticipantIdValid}>
								{copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
								{copied ? "已複製" : "複製 URL"}
							</Button>
							<Button type="button" variant="outline" className="gap-2" onClick={enterMeeting} disabled={!isParticipantIdValid}>
								<ExternalLink className="h-4 w-4" />
								進入會議
							</Button>
						</div>
					</div>
				</section>
			</div>
		</main>
	);
}
