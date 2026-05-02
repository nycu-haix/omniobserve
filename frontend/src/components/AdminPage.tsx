import { Activity, AlertCircle, ClipboardList, Globe2, Lock, Radio, Users } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { getDefaultRoomName } from "../lib/defaultRoomName";
import { cn } from "../lib/utils";
import { Badge } from "./ui/Badge";
import { ScrollArea } from "./ui/ScrollArea";

interface RealtimeMessage {
	type?: string;
	[key: string]: unknown;
}

interface EventRecord {
	id: string;
	source: "board" | "presence";
	receivedAt: string;
	message: RealtimeMessage;
}

interface BoardStateMessage extends RealtimeMessage {
	type: "board_state";
	revision: number;
	ranking?: { items?: string[] };
	public_blocks?: BoardBlock[];
	private_blocks?: BoardBlock[];
}

interface PresenceStateMessage extends RealtimeMessage {
	type: "presence_state";
	participants?: string[];
}

interface BoardBlock {
	block_id?: string;
	id?: string;
	content?: string;
	summary?: string;
	scope?: string;
	participant_id?: string;
	timestamp_ms?: number;
}

const MAX_EVENTS = 80;
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

function isBoardStateMessage(message: RealtimeMessage | null): message is BoardStateMessage {
	return message?.type === "board_state";
}

function isPresenceStateMessage(message: RealtimeMessage | null): message is PresenceStateMessage {
	return message?.type === "presence_state";
}

function useAdminRealtimeSocket(source: "board" | "presence", sessionId: string, onEvent: (source: "board" | "presence", message: RealtimeMessage) => void) {
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

			const wsUrl = `${getWsBaseUrl()}/ws/sessions/${encodeURIComponent(sessionId)}/${source}?participant_id=${encodeURIComponent(ADMIN_PARTICIPANT_ID)}`;
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

	const recordEvent = (source: "board" | "presence", message: RealtimeMessage) => {
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
				public_blocks: current?.public_blocks || [],
				private_blocks: current?.private_blocks || []
			}));
		}

		if (isPresenceStateMessage(message) && Array.isArray(message.participants)) {
			setParticipants(message.participants);
		}

		if ((message.type === "participant_joined" || message.type === "participant_left") && typeof message.participant_id === "string") {
			setParticipants(current => {
				if (message.type === "participant_joined") {
					return current.includes(message.participant_id as string) ? current : [...current, message.participant_id as string].sort();
				}
				return current.filter(participantId => participantId !== message.participant_id);
			});
		}
	};

	const boardSocket = useAdminRealtimeSocket("board", roomName, recordEvent);
	const presenceSocket = useAdminRealtimeSocket("presence", roomName, recordEvent);
	const rankingItems = normalizeRankingItemIds(boardState?.ranking?.items || []);
	const publicBlocks = boardState?.public_blocks || [];
	const privateBlocks = boardState?.private_blocks || [];

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
							<span className="text-muted-foreground">Presence WS</span>
							<ConnectionBadge connected={presenceSocket.isConnected} />
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
									<span className="truncate">{participantId}</span>
									<span className="h-2 w-2 rounded-full bg-emerald-500" />
								</div>
							))}
						</div>
					) : (
						<EmptyState title="尚未收到 presence state" detail="這裡只顯示 backend presence WebSocket 回傳的 participant id。" />
					)}
				</section>

				<section className="rounded-lg border bg-card p-4 text-card-foreground">
					<header className="mb-3 flex items-center gap-2">
						<AlertCircle className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
						<h2 className="text-sm font-semibold">目前限制</h2>
					</header>
					<p className="text-sm leading-6 text-muted-foreground">backend 尚未提供 admin aggregate stream，所以此頁不顯示假造的 private channels、transcript search、AI 狀態、latency 或會議控制。</p>
				</section>
			</aside>

			<section className="flex min-h-[calc(100vh-2rem)] min-w-0 flex-col overflow-hidden rounded-lg border bg-card text-card-foreground">
				<header className="flex flex-wrap items-center justify-between gap-3 border-b p-4">
					<div>
						<div className="flex items-center gap-2 text-sm text-muted-foreground">
							<Activity className="h-4 w-4" aria-hidden="true" />
							<span>Realtime events</span>
						</div>
						<h2 className="mt-1 text-lg font-semibold">Board / Presence stream</h2>
					</div>
					<Badge variant="secondary">{events.length} events</Badge>
				</header>
				<ScrollArea className="min-h-0 flex-1 p-4">
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
						<EmptyState title="尚未收到 realtime event" detail="開啟 backend 並讓參與者進入同一個 room 後，board 與 presence 訊息會出現在這裡。" />
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
							<Globe2 className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
							<h2 className="text-sm font-semibold">Public blocks</h2>
						</div>
						<Badge variant="outline">{publicBlocks.length}</Badge>
					</header>
					<ScrollArea className="h-[260px] p-4">
						{publicBlocks.length > 0 ? (
							<div className="grid gap-3">
								{publicBlocks.map((block, index) => (
									<article key={block.block_id || block.id || index} className="rounded-lg border bg-background p-3 text-sm">
										<p className="leading-6">{block.content || block.summary || "-"}</p>
										<p className="mt-2 text-xs text-muted-foreground">{block.participant_id || "unknown participant"}</p>
									</article>
								))}
							</div>
						) : (
							<EmptyState title="尚無 public blocks" detail="只會顯示 board WS 實際回傳的 public_blocks 或 public block updates。" />
						)}
					</ScrollArea>
				</section>

				<section className="rounded-lg border bg-card p-4 text-card-foreground">
					<header className="mb-3 flex items-center gap-2">
						<Lock className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
						<h2 className="text-sm font-semibold">Private channels</h2>
					</header>
					{privateBlocks.length > 0 ? (
						<div className="grid gap-2">
							{privateBlocks.map((block, index) => (
								<div key={block.block_id || block.id || index} className="rounded-lg border bg-background p-3 text-sm leading-6">
									{block.content || block.summary || "-"}
								</div>
							))}
						</div>
					) : (
						<EmptyState title="未顯示其他人的 private channel" detail="現有 board WS 只會回傳目前 participant 的 private blocks；admin aggregate API 尚未提供。" />
					)}
				</section>

				<section className="rounded-lg border bg-card p-4 text-card-foreground">
					<header className="mb-3 flex items-center gap-2">
						<Radio className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
						<h2 className="text-sm font-semibold">Last messages</h2>
					</header>
					<div className="grid gap-3">
						<JsonPreview value={{ board: boardSocket.lastMessage ?? null, presence: presenceSocket.lastMessage ?? null }} />
					</div>
				</section>
			</aside>
		</main>
	);
}
