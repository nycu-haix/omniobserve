import { Check, Copy, ExternalLink } from "lucide-react";
import { useMemo, useState } from "react";
import { getDefaultRoomName } from "../lib/defaultRoomName";
import { Button } from "./ui/Button";

const defaultSessionName = getDefaultRoomName();

function buildMeetingUrl(sessionName: string, participantId: string, displayName: string) {
	const params = new URLSearchParams();
	params.set("room_name", sessionName.trim() || defaultSessionName);
	params.set("id", participantId.trim() || "1");
	params.set("name", displayName.trim() || "User");

	return `${window.location.origin}${window.location.pathname}?${params.toString()}`;
}

export function HomePage() {
	const [sessionName, setSessionName] = useState(defaultSessionName);
	const [participantId, setParticipantId] = useState("1");
	const [displayName, setDisplayName] = useState("");
	const [copied, setCopied] = useState(false);
	const meetingUrl = useMemo(() => buildMeetingUrl(sessionName, participantId, displayName), [displayName, participantId, sessionName]);

	const copyUrl = async () => {
		await navigator.clipboard.writeText(meetingUrl);
		setCopied(true);
		window.setTimeout(() => setCopied(false), 1600);
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
								onChange={event => setSessionName(event.target.value)}
								placeholder={defaultSessionName}
							/>
						</label>

						<label className="grid gap-2 text-sm font-medium">
							Participant ID
							<input
								className="h-11 rounded-md border bg-background px-3 text-base outline-none transition focus-visible:ring-1 focus-visible:ring-ring"
								value={participantId}
								onChange={event => setParticipantId(event.target.value)}
								placeholder="1"
							/>
						</label>

						<label className="grid gap-2 text-sm font-medium">
							Name
							<input
								className="h-11 rounded-md border bg-background px-3 text-base outline-none transition focus-visible:ring-1 focus-visible:ring-ring"
								value={displayName}
								onChange={event => setDisplayName(event.target.value)}
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
							<Button type="button" onClick={copyUrl} className="gap-2">
								{copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
								{copied ? "已複製" : "複製 URL"}
							</Button>
							<Button type="button" variant="outline" className="gap-2" onClick={() => window.location.assign(meetingUrl)}>
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
