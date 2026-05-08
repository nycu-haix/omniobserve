import { Activity, ClipboardList, FileText, Lightbulb, Radio, RefreshCw, Search, Users } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getDefaultRoomName } from "../lib/defaultRoomName";
import { cn } from "../lib/utils";
import { apiUrl, fetchTaskConfig, type TaskConfigItem } from "../services/api";
import { fetchSessionPresence, type ParticipantPresence } from "../services/presence";
import { Badge } from "./ui/Badge";
import { Button } from "./ui/Button";
import { ScrollArea } from "./ui/ScrollArea";

interface RealtimeMessage {
	type?: string;
	[key: string]: unknown;
}

interface EventRecord {
	id: string;
	source: "admin" | "board";
	receivedAt: string;
	message: RealtimeMessage;
}

interface BoardStateMessage extends RealtimeMessage {
	type: "board_state";
	revision: number;
	ranking?: { items?: string[] };
}

interface TranscriptRecord {
	id: number;
	user_id: number;
	session_name: string;
	time_stamp: string;
	transcript: string;
}

interface IdeaBlockRecord {
	id: number;
	user_id: number;
	session_name: string;
	title?: string;
	summary?: string;
	transcript?: string | null;
	similarity_id?: string | null;
	content?: string;
}

interface ParticipantTranscriptMessage extends RealtimeMessage {
	type: "participant_transcript";
	participant_id: string;
	scope?: string;
	text?: string;
	is_final?: boolean;
	persisted?: boolean;
	timestamp_ms?: number;
}

interface LatestParticipantTranscript {
	scope: string;
	text: string;
	isFinal: boolean;
	persisted: boolean;
	receivedAt: string;
}

type SessionPhase = "private" | "group";

const MAX_EVENTS = 80;
const API_REFRESH_INTERVAL_MS = 5000;
const ADMIN_PARTICIPANT_ID = "admin";

function normalizeSessionPhase(value: unknown): SessionPhase | null {
	return value === "private" || value === "group" ? value : null;
}

function durationSecondsFromMinutes(value: string) {
	const minutes = Number.parseFloat(value);
	if (!Number.isFinite(minutes) || minutes <= 0) {
		return 0;
	}
	return Math.round(minutes * 60);
}

function formatDurationLabel(value: string) {
	const seconds = durationSecondsFromMinutes(value);
	if (seconds <= 0) {
		return "No Timer";
	}
	const minutes = Math.floor(seconds / 60);
	const remainder = seconds % 60;
	return remainder === 0 ? `${minutes} Min` : `${minutes}:${remainder.toString().padStart(2, "0")}`;
}

function normalizeRankingItemIds(itemIds: string[], defaultItemIds: string[]) {
	const validIds = new Set(defaultItemIds);
	const rankedValidIds = itemIds.filter((id, index) => validIds.has(id) && itemIds.indexOf(id) === index);
	const missingIds = defaultItemIds.filter(id => !rankedValidIds.includes(id));

	return [...rankedValidIds, ...missingIds];
}

function getRoomName() {
	const params = new URLSearchParams(window.location.search);
	const fallbackRoomName = getDefaultRoomName();
	return (
		params
			.get("room_name")
			?.trim()
			.replace(/^["']|["']$/g, "") || fallbackRoomName
	);
}

function getWsBaseUrl() {
	const protocol = window.location.protocol === "https:" ? "wss" : "ws";
	return (import.meta.env.VITE_WS_BASE_URL as string | undefined) || `${protocol}://${window.location.host}`;
}

function formatMessageType(message: RealtimeMessage) {
	return message.type || "raw_message";
}

function buildSessionApiUrl(roomName: string, path: string) {
	return apiUrl(`/api/sessions/${encodeURIComponent(roomName)}${path}`);
}

function formatApiTime(value: string | null | undefined) {
	if (!value) {
		return "-";
	}

	const date = new Date(value);
	if (Number.isNaN(date.getTime())) {
		return value;
	}

	return new Intl.DateTimeFormat("zh-TW", {
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
		hour12: false
	}).format(date);
}

function matchesQuery(value: string | null | undefined, query: string) {
	return !query || (value || "").toLowerCase().includes(query);
}

function isBoardStateMessage(message: RealtimeMessage | null): message is BoardStateMessage {
	return message?.type === "board_state";
}

function isParticipantTranscriptMessage(message: RealtimeMessage | null): message is ParticipantTranscriptMessage {
	return message?.type === "participant_transcript" && typeof message.participant_id === "string" && typeof message.text === "string";
}

function useAdminRealtimeSocket(source: "admin" | "board", sessionId: string, onEvent: (source: "admin" | "board", message: RealtimeMessage) => void) {
	const [isConnected, setIsConnected] = useState(false);
	const [lastMessage, setLastMessage] = useState<RealtimeMessage | null>(null);
	const retryCountRef = useRef(0);
	const retryTimerRef = useRef<number | null>(null);
	const onEventRef = useRef(onEvent);
	const socketRef = useRef<WebSocket | null>(null);

	useEffect(() => {
		onEventRef.current = onEvent;
	}, [onEvent]);

	useEffect(() => {
		let disposed = false;
		let socket: WebSocket | null = null;

		const connect = () => {
			if (!sessionId || disposed) {
				return;
			}

			const queryParam = source === "admin" ? `admin_id=${encodeURIComponent(ADMIN_PARTICIPANT_ID)}` : `participant_id=${encodeURIComponent(ADMIN_PARTICIPANT_ID)}`;
			const wsUrl = `${getWsBaseUrl()}/ws/sessions/${encodeURIComponent(sessionId)}/${source}?${queryParam}`;
			socket = new WebSocket(wsUrl);
			socketRef.current = socket;

			socket.onopen = () => {
				retryCountRef.current = 0;
				setIsConnected(true);
				socket?.send(
					JSON.stringify({
						type: "join",
						participant_id: ADMIN_PARTICIPANT_ID
					})
				);
			};

			socket.onmessage = event => {
				let parsedMessage: RealtimeMessage;
				try {
					parsedMessage = JSON.parse(event.data) as RealtimeMessage;
				} catch {
					parsedMessage = { type: "raw_message", payload: event.data };
				}
				setLastMessage(parsedMessage);
				onEventRef.current(source, parsedMessage);
			};

			socket.onclose = () => {
				setIsConnected(false);
				if (!disposed && retryCountRef.current < 5) {
					retryCountRef.current += 1;
					retryTimerRef.current = window.setTimeout(connect, 3000);
				}
			};

			socket.onerror = () => {
				socket?.close();
			};
		};

		connect();

		return () => {
			disposed = true;
			if (retryTimerRef.current !== null) {
				window.clearTimeout(retryTimerRef.current);
			}
			socket?.close();
		};
	}, [sessionId, source]);

	const sendMessage = useCallback((msg: object) => {
		if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
			socketRef.current.send(JSON.stringify(msg));
		}
	}, []);

	return { isConnected, lastMessage, sendMessage };
}

function ConnectionBadge({ connected }: { connected: boolean }) {
	return (
		<Badge variant={connected ? "secondary" : "outline"} className={cn("gap-2", connected ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "text-muted-foreground")}>
			<span className={cn("h-2 w-2 rounded-full", connected ? "bg-emerald-500" : "bg-muted-foreground")} />
			{connected ? "connected" : "disconnected"}
		</Badge>
	);
}

function EmptyState({ title, detail }: { title: string; detail: string }) {
	return (
		<div className="grid min-h-32 place-items-center rounded-lg border border-dashed bg-background p-4 text-center">
			<div>
				<p className="text-sm font-medium">{title}</p>
				<p className="mt-1 max-w-md text-sm leading-6 text-muted-foreground">{detail}</p>
			</div>
		</div>
	);
}

function JsonPreview({ value }: { value: unknown }) {
	return <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs leading-5 text-muted-foreground">{JSON.stringify(value, null, 2)}</pre>;
}

function AdminPhaseTimer({ endTimeMs }: { endTimeMs: number }) {
	const [timeLeft, setTimeLeft] = useState(() => Math.max(0, Math.floor((endTimeMs - Date.now()) / 1000)));

	useEffect(() => {
		const updateTimer = () => {
			setTimeLeft(Math.max(0, Math.floor((endTimeMs - Date.now()) / 1000)));
		};
		updateTimer();
		const timer = window.setInterval(updateTimer, 1000);
		return () => window.clearInterval(timer);
	}, [endTimeMs]);

	const minutes = Math.floor(timeLeft / 60);
	const seconds = timeLeft % 60;
	return <span className="font-mono text-sm font-semibold">{minutes}:{seconds.toString().padStart(2, "0")}</span>;
}

export function AdminPage() {
	const roomName = useMemo(() => getRoomName(), []);
	const [events, setEvents] = useState<EventRecord[]>([]);
	const [boardState, setBoardState] = useState<BoardStateMessage | null>(null);
	const [participants, setParticipants] = useState<ParticipantPresence[]>([]);
	const [transcripts, setTranscripts] = useState<TranscriptRecord[]>([]);
	const [ideaBlocks, setIdeaBlocks] = useState<IdeaBlockRecord[]>([]);
	const [isApiLoading, setIsApiLoading] = useState(false);
	const [apiError, setApiError] = useState<string | null>(null);
	const [lastApiLoadedAt, setLastApiLoadedAt] = useState<string | null>(null);
	const [latestTranscripts, setLatestTranscripts] = useState<Record<string, LatestParticipantTranscript>>({});
	const [taskItems, setTaskItems] = useState<TaskConfigItem[]>([]);
	const [query, setQuery] = useState("");
	const [selectedUserId, setSelectedUserId] = useState<number | "all">("all");
	const [currentPhase, setCurrentPhase] = useState<SessionPhase>("private");
	const [timerEndTime, setTimerEndTime] = useState(0);
	const [privateDurationMinutes, setPrivateDurationMinutes] = useState("5");
	const [groupDurationMinutes, setGroupDurationMinutes] = useState("15");
	const rankingLabels = useMemo(() => Object.fromEntries(taskItems.map(item => [item.id, item.label])), [taskItems]);
	const defaultRankingItemIds = useMemo(() => taskItems.map(item => item.id), [taskItems]);

	const loadAdminApiData = useCallback(async () => {
		setIsApiLoading(true);
		setApiError(null);

		try {
			const [transcriptsResponse, ideaBlocksResponse, nextParticipants] = await Promise.all([
				fetch(buildSessionApiUrl(roomName, "/transcripts")),
				fetch(buildSessionApiUrl(roomName, "/idea-blocks")),
				fetchSessionPresence(roomName)
			]);

			if (!transcriptsResponse.ok) {
				throw new Error(`Failed to load transcripts (${transcriptsResponse.status})`);
			}
			if (!ideaBlocksResponse.ok) {
				throw new Error(`Failed to load idea blocks (${ideaBlocksResponse.status})`);
			}

			const [nextTranscripts, nextIdeaBlocks] = (await Promise.all([transcriptsResponse.json(), ideaBlocksResponse.json()])) as [TranscriptRecord[], IdeaBlockRecord[]];
			setTranscripts(nextTranscripts);
			setIdeaBlocks(nextIdeaBlocks);
			setParticipants(nextParticipants.filter(participant => participant.id !== ADMIN_PARTICIPANT_ID));
			setLastApiLoadedAt(
				new Intl.DateTimeFormat("zh-TW", {
					hour: "2-digit",
					minute: "2-digit",
					second: "2-digit",
					hour12: false
				}).format(new Date())
			);
		} catch (error) {
			setApiError(error instanceof Error ? error.message : String(error));
		} finally {
			setIsApiLoading(false);
		}
	}, [roomName]);

	const recordEvent = (source: "admin" | "board", message: RealtimeMessage) => {
		const receivedAt = new Intl.DateTimeFormat("zh-TW", {
			hour: "2-digit",
			minute: "2-digit",
			second: "2-digit",
			hour12: false
		}).format(new Date());

		setEvents(current => [{ id: `${source}-${Date.now()}-${Math.random()}`, source, receivedAt, message }, ...current].slice(0, MAX_EVENTS));

		const nextPhase = normalizeSessionPhase(message.phase) ?? normalizeSessionPhase(message.current_phase);
		if (nextPhase) {
			setCurrentPhase(nextPhase);
		}
		if (typeof message.end_time_ms === "number") {
			setTimerEndTime(message.end_time_ms);
		} else if (typeof message.timer_end_time_ms === "number") {
			setTimerEndTime(message.timer_end_time_ms);
		}

		if (isBoardStateMessage(message)) {
			setBoardState(message);
		}

		if (message.type === "ranking_state") {
			setBoardState(current => ({
				type: "board_state",
				revision: typeof message.revision === "number" ? message.revision : current?.revision || 0,
				ranking: { items: Array.isArray(message.items) ? (message.items as string[]) : current?.ranking?.items || [] },
				session_name: roomName
			}));
		}

		if (isParticipantTranscriptMessage(message)) {
			setLatestTranscripts(current => ({
				...current,
				[message.participant_id]: {
					scope: typeof message.scope === "string" ? message.scope : "unknown",
					text: message.text?.trim() || "",
					isFinal: message.is_final === true,
					persisted: message.persisted === true,
					receivedAt
				}
			}));
		}
	};

	useEffect(() => {
		const initialTimer = window.setTimeout(() => {
			void loadAdminApiData();
		}, 0);
		const timer = window.setInterval(() => {
			void loadAdminApiData();
		}, API_REFRESH_INTERVAL_MS);

		return () => {
			window.clearTimeout(initialTimer);
			window.clearInterval(timer);
		};
	}, [loadAdminApiData]);

	useEffect(() => {
		const abortController = new AbortController();

		const loadTaskConfig = async () => {
			try {
				const taskConfig = await fetchTaskConfig(abortController.signal);
				setTaskItems(taskConfig.items);
			} catch (error) {
				if (error instanceof DOMException && error.name === "AbortError") {
					return;
				}
				console.error("Failed to load task config", error);
			}
		};

		void loadTaskConfig();

		return () => abortController.abort();
	}, []);

	const { isConnected: adminConnected, lastMessage: adminLastMessage, sendMessage: sendAdminMessage } = useAdminRealtimeSocket("admin", roomName, recordEvent);
	const { isConnected: boardConnected, lastMessage: boardLastMessage } = useAdminRealtimeSocket("board", roomName, recordEvent);
	const startPhase = (phase: SessionPhase, minutesValue: string) => {
		sendAdminMessage({ type: "switch_phase", phase, duration_s: durationSecondsFromMinutes(minutesValue) });
	};
	const clearPhaseTimer = () => {
		sendAdminMessage({ type: "switch_phase", phase: currentPhase, duration_s: 0 });
	};
	const rankingItems = normalizeRankingItemIds(boardState?.ranking?.items || [], defaultRankingItemIds);
	const normalizedQuery = query.trim().toLowerCase();
	const participantFilterOptions = useMemo(() => {
		const ids = new Set<number>();
		participants.forEach(participant => {
			const userId = Number(participant.id);
			if (Number.isInteger(userId)) {
				ids.add(userId);
			}
		});
		transcripts.forEach(item => ids.add(item.user_id));
		ideaBlocks.forEach(item => ids.add(item.user_id));
		return [...ids].sort((a, b) => a - b);
	}, [ideaBlocks, participants, transcripts]);
	const filteredTranscripts = transcripts
		.filter(item => selectedUserId === "all" || item.user_id === selectedUserId)
		.filter(item => matchesQuery(item.transcript, normalizedQuery))
		.sort((a, b) => new Date(b.time_stamp).getTime() - new Date(a.time_stamp).getTime());
	const filteredIdeaBlocks = ideaBlocks
		.filter(item => selectedUserId === "all" || item.user_id === selectedUserId)
		.filter(item => matchesQuery(`${item.title || ""}\n${item.summary || ""}\n${item.transcript || ""}`, normalizedQuery))
		.sort((a, b) => b.id - a.id);

	return (
		<main className="grid min-h-screen grid-cols-1 gap-4 bg-muted/40 p-4 text-foreground xl:grid-cols-[320px_minmax(0,1fr)_360px]">
			<aside className="flex min-h-0 flex-col gap-4">
				<section className="rounded-lg border bg-card p-4 text-card-foreground">
					<div className="mb-4 flex items-start justify-between gap-3">
						<div className="min-w-0">
							<p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Admin monitor</p>
							<h1 className="truncate text-xl font-semibold">{roomName}</h1>
						</div>
						<Badge variant="outline">live</Badge>
					</div>
					<div className="grid gap-3 text-sm">
						<div className="flex items-center justify-between gap-3">
							<span className="text-muted-foreground">Board WS</span>
							<ConnectionBadge connected={boardConnected} />
						</div>
						<div className="flex items-center justify-between gap-3">
							<span className="text-muted-foreground">Admin WS</span>
							<ConnectionBadge connected={adminConnected} />
						</div>
						<div className="flex items-center justify-between gap-3">
							<span className="text-muted-foreground">Presence API</span>
							<span className="font-medium">{participants.length} participants</span>
						</div>
						<div className="flex items-center justify-between gap-3">
							<span className="text-muted-foreground">Admin participant</span>
							<span className="font-medium">{ADMIN_PARTICIPANT_ID}</span>
						</div>
					</div>
				</section>

				<section className="rounded-lg border bg-card p-4 text-card-foreground">
					<header className="mb-3 flex items-center gap-2">
						<Radio className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
						<h2 className="text-sm font-semibold">Phase Controls</h2>
					</header>
					<div className="grid gap-3">
						<div className="flex items-center justify-between gap-3 rounded-md border bg-background px-3 py-2 text-sm">
							<div className="min-w-0">
								<div className="font-medium">{currentPhase === "group" ? "Group Phase" : "Private Phase"}</div>
								<div className="text-xs text-muted-foreground">{timerEndTime > 0 ? "Countdown running" : "No countdown"}</div>
							</div>
							{timerEndTime > 0 ? <AdminPhaseTimer endTimeMs={timerEndTime} /> : <span className="text-sm text-muted-foreground">--:--</span>}
						</div>

						<div className="grid gap-2 rounded-md border bg-background p-3">
							<label className="grid gap-1 text-xs font-medium text-muted-foreground" htmlFor="private-phase-duration">
								Private duration (minutes)
								<input
									id="private-phase-duration"
									className="h-9 rounded-md border bg-card px-3 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
									inputMode="decimal"
									type="text"
									value={privateDurationMinutes}
									onChange={event => setPrivateDurationMinutes(event.target.value)}
								/>
							</label>
							<Button variant="outline" onClick={() => startPhase("private", privateDurationMinutes)}>
								Start {formatDurationLabel(privateDurationMinutes)} Private Phase
							</Button>
						</div>

						<div className="grid gap-2 rounded-md border bg-background p-3">
							<label className="grid gap-1 text-xs font-medium text-muted-foreground" htmlFor="group-phase-duration">
								Group duration (minutes)
								<input
									id="group-phase-duration"
									className="h-9 rounded-md border bg-card px-3 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
									inputMode="decimal"
									type="text"
									value={groupDurationMinutes}
									onChange={event => setGroupDurationMinutes(event.target.value)}
								/>
							</label>
							<Button onClick={() => startPhase("group", groupDurationMinutes)}>Start {formatDurationLabel(groupDurationMinutes)} Group Phase</Button>
						</div>

						<Button variant="secondary" onClick={clearPhaseTimer}>
							Clear Countdown
						</Button>
					</div>
				</section>

				<section className="rounded-lg border bg-card p-4 text-card-foreground">
					<header className="mb-3 flex items-center gap-2">
						<Users className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
						<h2 className="text-sm font-semibold">Presence</h2>
					</header>
					{participants.length > 0 ? (
						<div className="grid gap-2">
							{participants.map(participant => (
								<div key={participant.id} className="grid gap-1 rounded-lg border bg-background px-3 py-2 text-sm">
									{(() => {
										const latestTranscript = latestTranscripts[participant.id];
										return (
											<>
												<div className="flex items-center justify-between gap-3">
													<span className="min-w-0 truncate font-medium">{participant.display_name || participant.id}</span>
													<span className={cn("h-2 w-2 rounded-full", participant.audio_connected ? "bg-emerald-500" : "bg-muted-foreground")} />
												</div>
												<div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
													<span className="truncate">ID {participant.id}</span>
													<span className="font-medium">{participant.audio_connected ? participant.mic_mode : "off"}</span>
												</div>
												{latestTranscript && (
													<div className="mt-1 rounded-md bg-muted px-2 py-1.5 text-xs leading-5">
														<div className="mb-1 flex items-center justify-between gap-2 text-muted-foreground">
															<span>{latestTranscript.scope}</span>
															<span>{latestTranscript.receivedAt}</span>
														</div>
														<p className="line-clamp-3 whitespace-pre-wrap text-foreground">{latestTranscript.text}</p>
													</div>
												)}
											</>
										);
									})()}
								</div>
							))}
						</div>
					) : (
						<EmptyState title="尚未取得 presence" detail="這裡讀取 REST presence API，會列出目前連到同一個 room 的 participant id 與 mic 狀態。" />
					)}
				</section>

				<section className="rounded-lg border bg-card p-4 text-card-foreground">
					<header className="mb-3 flex items-center gap-2">
						<RefreshCw className={cn("h-4 w-4 text-muted-foreground", isApiLoading && "animate-spin")} aria-hidden="true" />
						<h2 className="text-sm font-semibold">API data</h2>
					</header>
					<div className="grid gap-3 text-sm">
						<div className="flex items-center justify-between gap-3">
							<span className="text-muted-foreground">Transcripts</span>
							<span className="font-medium">{transcripts.length}</span>
						</div>
						<div className="flex items-center justify-between gap-3">
							<span className="text-muted-foreground">Idea blocks</span>
							<span className="font-medium">{ideaBlocks.length}</span>
						</div>
						<div className="flex items-center justify-between gap-3">
							<span className="text-muted-foreground">Last refresh</span>
							<span className="font-medium">{lastApiLoadedAt || "-"}</span>
						</div>
						<Button type="button" variant="outline" size="sm" className="gap-2" onClick={() => void loadAdminApiData()} disabled={isApiLoading}>
							<RefreshCw className={cn("h-3.5 w-3.5", isApiLoading && "animate-spin")} aria-hidden="true" />
							Refresh API data
						</Button>
						{apiError && <p className="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs leading-5 text-destructive">{apiError}</p>}
					</div>
				</section>
			</aside>

			<section className="flex min-h-[calc(100vh-2rem)] min-w-0 flex-col overflow-hidden rounded-lg border bg-card text-card-foreground">
				<header className="flex flex-wrap items-center justify-between gap-3 border-b p-4">
					<div>
						<div className="flex items-center gap-2 text-sm text-muted-foreground">
							<FileText className="h-4 w-4" aria-hidden="true" />
							<span>REST API</span>
						</div>
						<h2 className="mt-1 text-lg font-semibold">Transcripts</h2>
					</div>
					<Badge variant="secondary">{filteredTranscripts.length} rows</Badge>
				</header>
				<div className="grid gap-3 border-b p-4">
					<div className="relative">
						<Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
						<input
							value={query}
							onChange={event => setQuery(event.target.value)}
							placeholder="Search transcripts and idea blocks"
							className="h-9 w-full rounded-md border bg-background pl-9 pr-3 text-sm outline-none transition-colors focus:border-ring"
						/>
					</div>
					<div className="flex flex-wrap gap-2">
						<Button type="button" size="sm" variant={selectedUserId === "all" ? "secondary" : "outline"} onClick={() => setSelectedUserId("all")}>
							All users
						</Button>
						{participantFilterOptions.map(userId => (
							<Button key={userId} type="button" size="sm" variant={selectedUserId === userId ? "secondary" : "outline"} onClick={() => setSelectedUserId(userId)}>
								User {userId}
							</Button>
						))}
					</div>
				</div>
				<ScrollArea className="min-h-0 flex-1 p-4">
					{filteredTranscripts.length > 0 ? (
						<div className="grid gap-3">
							{filteredTranscripts.map(item => (
								<article key={item.id} className="rounded-lg border bg-background p-3">
									<div className="mb-3 flex flex-wrap items-center justify-between gap-2">
										<div className="flex items-center gap-2">
											<Badge variant="outline">user {item.user_id}</Badge>
											<span className="text-sm font-medium">transcript #{item.id}</span>
										</div>
										<span className="text-xs text-muted-foreground">{formatApiTime(item.time_stamp)}</span>
									</div>
									<p className="whitespace-pre-wrap text-sm leading-6">{item.transcript}</p>
								</article>
							))}
						</div>
					) : (
						<EmptyState title="尚無 transcripts" detail="這裡只讀取 REST API，不使用 WebSocket 的 transcript 或 idea block 事件。" />
					)}
				</ScrollArea>
			</section>

			<aside className="flex min-h-0 flex-col gap-4">
				<section className="rounded-lg border bg-card p-4 text-card-foreground">
					<header className="mb-3 flex items-center gap-2">
						<ClipboardList className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
						<h2 className="text-sm font-semibold">Ranking state</h2>
					</header>
					{rankingItems.length > 0 ? (
						<div className="grid gap-2">
							{rankingItems.map((item, index) => (
								<div key={item} className="flex items-center gap-3 rounded-lg border bg-background px-3 py-2 text-sm">
									<span className="grid h-6 w-6 place-items-center rounded-full bg-muted text-xs font-semibold">{index + 1}</span>
									<span className="min-w-0 flex-1 truncate">{rankingLabels[item] || item}</span>
								</div>
							))}
							<p className="pt-1 text-xs text-muted-foreground">revision {boardState?.revision ?? 0}</p>
						</div>
					) : (
						<EmptyState title="尚未收到 ranking state" detail="board WebSocket join 後會回傳 board_state；有排序更新時會收到 ranking_state。" />
					)}
				</section>

				<section className="min-h-0 flex-1 overflow-hidden rounded-lg border bg-card text-card-foreground">
					<header className="flex items-center justify-between gap-3 border-b p-4">
						<div className="flex items-center gap-2">
							<Lightbulb className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
							<h2 className="text-sm font-semibold">Idea blocks</h2>
						</div>
						<Badge variant="outline">{filteredIdeaBlocks.length}</Badge>
					</header>
					<ScrollArea className="h-[360px] p-4">
						{filteredIdeaBlocks.length > 0 ? (
							<div className="grid gap-3">
								{filteredIdeaBlocks.map(block => (
									<article key={block.id} className="rounded-lg border bg-background p-3 text-sm">
										<div className="mb-2 flex flex-wrap items-center justify-between gap-2">
											<div className="flex min-w-0 items-center gap-2">
												<Badge variant="outline">user {block.user_id}</Badge>
												<span className="truncate font-medium">#{block.id}</span>
											</div>
											{block.similarity_id && <Badge variant="secondary">similarity</Badge>}
										</div>
										<p className="font-medium leading-6">{block.title || block.summary || "-"}</p>
										{block.summary && block.summary !== block.title && <p className="mt-1 whitespace-pre-wrap leading-6 text-muted-foreground">{block.summary}</p>}
										{block.transcript && <p className="mt-2 line-clamp-3 whitespace-pre-wrap border-t pt-2 text-xs leading-5 text-muted-foreground">{block.transcript}</p>}
									</article>
								))}
							</div>
						) : (
							<EmptyState title="尚無 idea blocks" detail="這裡只讀取 REST API 的 session idea blocks，不使用 board WebSocket block payload。" />
						)}
					</ScrollArea>
				</section>

				<section className="min-h-0 overflow-hidden rounded-lg border bg-card text-card-foreground">
					<header className="flex items-center justify-between gap-3 border-b p-4">
						<div className="flex items-center gap-2">
							<Activity className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
							<h2 className="text-sm font-semibold">WS diagnostics</h2>
						</div>
						<Badge variant="outline">{events.length}</Badge>
					</header>
					<ScrollArea className="h-[260px] p-4">
						{events.length > 0 ? (
							<div className="grid gap-3">
								{events.map(event => (
									<article key={event.id} className="rounded-lg border bg-background p-3">
										<div className="mb-3 flex flex-wrap items-center justify-between gap-2">
											<div className="flex items-center gap-2">
												<Badge variant={event.source === "board" ? "secondary" : "outline"}>{event.source}</Badge>
												<span className="text-sm font-medium">{formatMessageType(event.message)}</span>
											</div>
											<span className="text-xs text-muted-foreground">{event.receivedAt}</span>
										</div>
										<JsonPreview value={event.message} />
									</article>
								))}
							</div>
						) : (
							<EmptyState title="尚未收到 WS event" detail="這裡顯示 board/admin WebSocket 診斷；admin WS 會收到 participant transcript。" />
						)}
					</ScrollArea>
				</section>

				<section className="rounded-lg border bg-card p-4 text-card-foreground">
					<header className="mb-3 flex items-center gap-2">
						<Radio className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
						<h2 className="text-sm font-semibold">Last messages</h2>
					</header>
					<div className="grid gap-3">
						<JsonPreview value={{ admin: adminLastMessage ?? null, board: boardLastMessage ?? null }} />
					</div>
				</section>
			</aside>
		</main>
	);
}
