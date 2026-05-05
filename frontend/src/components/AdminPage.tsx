import { Activity, ClipboardList, FileText, Lightbulb, Radio, RefreshCw, Search, Users } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getDefaultRoomName } from "../lib/defaultRoomName";
import { cn } from "../lib/utils";
import { apiUrl } from "../services/api";
import { fetchSessionParticipants } from "../services/presence";
import { Badge } from "./ui/Badge";
import { Button } from "./ui/Button";
import { ScrollArea } from "./ui/ScrollArea";

interface RealtimeMessage {
	type?: string;
	[key: string]: unknown;
}

interface EventRecord {
	id: string;
	source: "board";
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

const MAX_EVENTS = 80;
const API_REFRESH_INTERVAL_MS = 5000;
const ADMIN_PARTICIPANT_ID = "admin";
const RANKING_LABELS: Record<string, string> = {
	mosquito_net: "蚊帳",
	petrol: "一罐汽油",
	water_container: "裝水容器",
	shaving_mirror: "刮鬍鏡／小鏡子",
	sextant: "六分儀",
	emergency_rations: "緊急糧食",
	sea_chart: "海圖",
	floating_cushion: "可漂浮的坐墊",
	rope: "繩子",
	chocolate_bars: "巧克力棒",
	waterproof_sheet: "防水塑膠布",
	fishing_rod: "釣魚竿",
	shark_repellent: "驅鯊劑",
	rum: "一瓶蘭姆酒",
	vhf_radio: "VHF 無線電"
};
const DEFAULT_RANKING_ITEM_IDS = Object.keys(RANKING_LABELS);

function normalizeRankingItemIds(itemIds: string[]) {
	const validIds = new Set(DEFAULT_RANKING_ITEM_IDS);
	const rankedValidIds = itemIds.filter((id, index) => validIds.has(id) && itemIds.indexOf(id) === index);
	const missingIds = DEFAULT_RANKING_ITEM_IDS.filter(id => !rankedValidIds.includes(id));

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

function useAdminRealtimeSocket(sessionId: string, onEvent: (source: "board", message: RealtimeMessage) => void) {
	const [isConnected, setIsConnected] = useState(false);
	const [lastMessage, setLastMessage] = useState<RealtimeMessage | null>(null);
	const retryCountRef = useRef(0);
	const retryTimerRef = useRef<number | null>(null);
	const onEventRef = useRef(onEvent);

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

			const wsUrl = `${getWsBaseUrl()}/ws/sessions/${encodeURIComponent(sessionId)}/board?participant_id=${encodeURIComponent(ADMIN_PARTICIPANT_ID)}`;
			socket = new WebSocket(wsUrl);

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
				onEventRef.current("board", parsedMessage);
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
	}, [sessionId]);

	return { isConnected, lastMessage };
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

export function AdminPage() {
	const roomName = useMemo(() => getRoomName(), []);
	const [events, setEvents] = useState<EventRecord[]>([]);
	const [boardState, setBoardState] = useState<BoardStateMessage | null>(null);
	const [participants, setParticipants] = useState<string[]>([]);
	const [transcripts, setTranscripts] = useState<TranscriptRecord[]>([]);
	const [ideaBlocks, setIdeaBlocks] = useState<IdeaBlockRecord[]>([]);
	const [isApiLoading, setIsApiLoading] = useState(false);
	const [apiError, setApiError] = useState<string | null>(null);
	const [lastApiLoadedAt, setLastApiLoadedAt] = useState<string | null>(null);
	const [query, setQuery] = useState("");
	const [selectedUserId, setSelectedUserId] = useState<number | "all">("all");

	const loadAdminApiData = useCallback(async () => {
		setIsApiLoading(true);
		setApiError(null);

		try {
			const [transcriptsResponse, ideaBlocksResponse, nextParticipants] = await Promise.all([
				fetch(buildSessionApiUrl(roomName, "/transcripts")),
				fetch(buildSessionApiUrl(roomName, "/idea-blocks")),
				fetchSessionParticipants(roomName)
			]);

			if (!transcriptsResponse.ok) {
				throw new Error(`Failed to load transcripts (${transcriptsResponse.status})`);
			}
			if (!ideaBlocksResponse.ok) {
				throw new Error(`Failed to load idea blocks (${ideaBlocksResponse.status})`);
			}

			const [nextTranscripts, nextIdeaBlocks] = (await Promise.all([transcriptsResponse.json(), ideaBlocksResponse.json()])) as [
				TranscriptRecord[],
				IdeaBlockRecord[]
			];
			setTranscripts(nextTranscripts);
			setIdeaBlocks(nextIdeaBlocks);
			setParticipants(nextParticipants.filter(participantId => participantId !== ADMIN_PARTICIPANT_ID));
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

	const recordEvent = (source: "board", message: RealtimeMessage) => {
		const receivedAt = new Intl.DateTimeFormat("zh-TW", {
			hour: "2-digit",
			minute: "2-digit",
			second: "2-digit",
			hour12: false
		}).format(new Date());

		setEvents(current => [{ id: `${source}-${Date.now()}-${Math.random()}`, source, receivedAt, message }, ...current].slice(0, MAX_EVENTS));

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

	const boardSocket = useAdminRealtimeSocket(roomName, recordEvent);
	const rankingItems = normalizeRankingItemIds(boardState?.ranking?.items || []);
	const normalizedQuery = query.trim().toLowerCase();
	const participantFilterOptions = useMemo(() => {
		const ids = new Set<number>();
		participants.forEach(participantId => {
			const userId = Number(participantId);
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
							<ConnectionBadge connected={boardSocket.isConnected} />
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
						<Users className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
						<h2 className="text-sm font-semibold">Presence</h2>
					</header>
					{participants.length > 0 ? (
						<div className="grid gap-2">
							{participants.map(participantId => (
								<div key={participantId} className="flex items-center justify-between gap-3 rounded-lg border bg-background px-3 py-2 text-sm">
									<span className="min-w-0 truncate font-medium">{participantId}</span>
									<span className="h-2 w-2 rounded-full bg-emerald-500" />
								</div>
							))}
						</div>
					) : (
						<EmptyState title="尚未取得 presence" detail="這裡讀取 REST presence API，會列出目前連到同一個 room 的 participant id。" />
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
									<span className="min-w-0 flex-1 truncate">{RANKING_LABELS[item] || item}</span>
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
							<EmptyState title="尚未收到 WS event" detail="這裡只做 board WebSocket 診斷；presence、transcript 與 idea block 顯示不使用此資料。" />
						)}
					</ScrollArea>
				</section>

				<section className="rounded-lg border bg-card p-4 text-card-foreground">
					<header className="mb-3 flex items-center gap-2">
						<Radio className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
						<h2 className="text-sm font-semibold">Last messages</h2>
					</header>
					<div className="grid gap-3">
						<JsonPreview value={{ board: boardSocket.lastMessage ?? null }} />
					</div>
				</section>
			</aside>
		</main>
	);
}
