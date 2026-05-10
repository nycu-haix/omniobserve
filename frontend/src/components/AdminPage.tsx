import { Activity, Check, ClipboardList, FileText, Lightbulb, Link2, Radio, RefreshCw, Search, Undo2, Users, X } from "lucide-react";
import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from "react";
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
	public_ranking?: RankingSnapshot;
	private_ranking?: RankingSnapshot;
	private_rankings?: Record<string, RankingSnapshot>;
}

interface RankingSnapshot {
	revision: number;
	items: string[];
}

interface AdminRankingStateMessage extends RealtimeMessage {
	type: "admin_ranking_state";
	revision: number;
	public_ranking: RankingSnapshot;
	private_rankings: Record<string, RankingSnapshot>;
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
	similarity_id?: number | null;
	content?: string;
}

interface SimilarityIdeaSummary {
	id: number;
	summary: string;
}

interface SimilarityRecord {
	id: number;
	idea_block_id_1: number;
	idea_block_id_2: number;
	reason: string;
	idea_block_1: SimilarityIdeaSummary;
	idea_block_2: SimilarityIdeaSummary;
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
type CueCondition = "experimental" | "control";

const MAX_EVENTS = 80;
const API_REFRESH_INTERVAL_MS = 5000;
const ADMIN_PARTICIPANT_ID = "admin";
const DEFAULT_ADMIN_LEFT_SIDEBAR_WIDTH = 320;
const DEFAULT_ADMIN_RIGHT_SIDEBAR_WIDTH = 360;
const MIN_ADMIN_LEFT_SIDEBAR_WIDTH = 280;
const MIN_ADMIN_RIGHT_SIDEBAR_WIDTH = 320;
const MIN_ADMIN_CENTER_COLUMN_WIDTH = 520;
const ADMIN_LEFT_SIDEBAR_WIDTH_STORAGE_KEY = "omni.admin.leftSidebarWidth";
const ADMIN_RIGHT_SIDEBAR_WIDTH_STORAGE_KEY = "omni.admin.rightSidebarWidth";
const PRIVATE_PUBLIC_RANK_CONFLICT_THRESHOLD = 3;
const MANUAL_CUE_REASON_PREFIX = "Manual cue from admin:";

function getAdminAvailableLayoutWidth() {
	return window.innerWidth - 32 - 32;
}

function clampAdminLeftSidebarWidth(width: number, rightSidebarWidth: number) {
	const maxWidth = Math.max(MIN_ADMIN_LEFT_SIDEBAR_WIDTH, getAdminAvailableLayoutWidth() - rightSidebarWidth - MIN_ADMIN_CENTER_COLUMN_WIDTH);
	return Math.min(Math.max(width, MIN_ADMIN_LEFT_SIDEBAR_WIDTH), maxWidth);
}

function clampAdminRightSidebarWidth(width: number, leftSidebarWidth: number) {
	const maxWidth = Math.max(MIN_ADMIN_RIGHT_SIDEBAR_WIDTH, getAdminAvailableLayoutWidth() - leftSidebarWidth - MIN_ADMIN_CENTER_COLUMN_WIDTH);
	return Math.min(Math.max(width, MIN_ADMIN_RIGHT_SIDEBAR_WIDTH), maxWidth);
}

function normalizeSessionPhase(value: unknown): SessionPhase | null {
	return value === "private" || value === "group" ? value : null;
}

function normalizeCueCondition(value: unknown): CueCondition | null {
	return value === "experimental" || value === "control" ? value : null;
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

function isRankingSnapshot(value: unknown): value is RankingSnapshot {
	return (
		typeof value === "object" &&
		value !== null &&
		"revision" in value &&
		typeof value.revision === "number" &&
		"items" in value &&
		Array.isArray(value.items) &&
		value.items.every(item => typeof item === "string")
	);
}

function isAdminRankingStateMessage(message: RealtimeMessage | null): message is AdminRankingStateMessage {
	if (message?.type !== "admin_ranking_state" || !isRankingSnapshot(message.public_ranking)) {
		return false;
	}
	const privateRankings = message.private_rankings;
	return typeof privateRankings === "object" && privateRankings !== null && Object.values(privateRankings).every(isRankingSnapshot);
}

function readNestedAdminRankingState(message: RealtimeMessage): AdminRankingStateMessage | null {
	const rankingState = message.ranking_state;
	return isAdminRankingStateMessage(rankingState as RealtimeMessage | null) ? (rankingState as AdminRankingStateMessage) : null;
}

function isParticipantTranscriptMessage(message: RealtimeMessage | null): message is ParticipantTranscriptMessage {
	return message?.type === "participant_transcript" && typeof message.participant_id === "string" && typeof message.text === "string";
}

function isAdminParticipantId(participantId: string | number | null | undefined) {
	return String(participantId ?? "").toLowerCase() === ADMIN_PARTICIPANT_ID;
}

function getRankConflict(itemId: string | undefined, publicRank: number, privateRankIndexById: Map<string, number>) {
	if (!itemId) {
		return null;
	}
	const privateRank = privateRankIndexById.get(itemId);
	if (privateRank == null) {
		return null;
	}
	const delta = privateRank - publicRank;
	return {
		amount: Math.abs(delta),
		direction: delta < 0 ? "up" : "down",
		isConflict: Math.abs(delta) > PRIVATE_PUBLIC_RANK_CONFLICT_THRESHOLD
	} as const;
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
	return (
		<span className="font-mono text-sm font-semibold">
			{minutes}:{seconds.toString().padStart(2, "0")}
		</span>
	);
}

export function AdminPage() {
	const roomName = useMemo(() => getRoomName(), []);
	const [events, setEvents] = useState<EventRecord[]>([]);
	const [boardState, setBoardState] = useState<BoardStateMessage | null>(null);
	const [adminRankingState, setAdminRankingState] = useState<AdminRankingStateMessage | null>(null);
	const [participants, setParticipants] = useState<ParticipantPresence[]>([]);
	const [transcripts, setTranscripts] = useState<TranscriptRecord[]>([]);
	const [ideaBlocks, setIdeaBlocks] = useState<IdeaBlockRecord[]>([]);
	const [similarities, setSimilarities] = useState<SimilarityRecord[]>([]);
	const [isApiLoading, setIsApiLoading] = useState(false);
	const [apiError, setApiError] = useState<string | null>(null);
	const [lastApiLoadedAt, setLastApiLoadedAt] = useState<string | null>(null);
	const [latestTranscripts, setLatestTranscripts] = useState<Record<string, LatestParticipantTranscript>>({});
	const [taskItems, setTaskItems] = useState<TaskConfigItem[]>([]);
	const [query, setQuery] = useState("");
	const [selectedUserId, setSelectedUserId] = useState<number | "all">("all");
	const [selectedCueBlockIds, setSelectedCueBlockIds] = useState<number[]>([]);
	const [isCreatingManualCue, setIsCreatingManualCue] = useState(false);
	const [undoingManualCueId, setUndoingManualCueId] = useState<number | null>(null);
	const [manualCueError, setManualCueError] = useState<string | null>(null);
	const [currentPhase, setCurrentPhase] = useState<SessionPhase>("private");
	const [cueCondition, setCueCondition] = useState<CueCondition>("experimental");
	const [timerEndTime, setTimerEndTime] = useState(0);
	const [privateDurationMinutes, setPrivateDurationMinutes] = useState("5");
	const [groupDurationMinutes, setGroupDurationMinutes] = useState("15");
	const [leftSidebarWidth, setLeftSidebarWidth] = useState(() => {
		const storedWidth = Number(window.localStorage.getItem(ADMIN_LEFT_SIDEBAR_WIDTH_STORAGE_KEY));
		return clampAdminLeftSidebarWidth(Number.isFinite(storedWidth) ? storedWidth : DEFAULT_ADMIN_LEFT_SIDEBAR_WIDTH, DEFAULT_ADMIN_RIGHT_SIDEBAR_WIDTH);
	});
	const [rightSidebarWidth, setRightSidebarWidth] = useState(() => {
		const storedWidth = Number(window.localStorage.getItem(ADMIN_RIGHT_SIDEBAR_WIDTH_STORAGE_KEY));
		return clampAdminRightSidebarWidth(Number.isFinite(storedWidth) ? storedWidth : DEFAULT_ADMIN_RIGHT_SIDEBAR_WIDTH, DEFAULT_ADMIN_LEFT_SIDEBAR_WIDTH);
	});
	const [resizeCursor, setResizeCursor] = useState<"col-resize" | null>(null);
	const rankingLabels = useMemo(() => Object.fromEntries(taskItems.map(item => [item.id, item.label])), [taskItems]);
	const defaultRankingItemIds = useMemo(() => taskItems.map(item => item.id), [taskItems]);
	const adminLayoutStyle = {
		"--admin-left-sidebar-width": `${leftSidebarWidth}px`,
		"--admin-right-sidebar-width": `${rightSidebarWidth}px`
	} as CSSProperties;

	const loadAdminApiData = useCallback(async () => {
		setIsApiLoading(true);
		setApiError(null);

		try {
			const [transcriptsResponse, ideaBlocksResponse, similaritiesResponse, nextParticipants] = await Promise.all([
				fetch(buildSessionApiUrl(roomName, "/transcripts")),
				fetch(buildSessionApiUrl(roomName, "/idea-blocks")),
				fetch(buildSessionApiUrl(roomName, "/similarities")),
				fetchSessionPresence(roomName)
			]);

			if (!transcriptsResponse.ok) {
				throw new Error(`Failed to load transcripts (${transcriptsResponse.status})`);
			}
			if (!ideaBlocksResponse.ok) {
				throw new Error(`Failed to load idea blocks (${ideaBlocksResponse.status})`);
			}
			if (!similaritiesResponse.ok) {
				throw new Error(`Failed to load similarities (${similaritiesResponse.status})`);
			}

			const [nextTranscripts, nextIdeaBlocks, nextSimilarities] = (await Promise.all([transcriptsResponse.json(), ideaBlocksResponse.json(), similaritiesResponse.json()])) as [
				TranscriptRecord[],
				IdeaBlockRecord[],
				SimilarityRecord[]
			];
			setTranscripts(nextTranscripts);
			setIdeaBlocks(nextIdeaBlocks);
			setSimilarities(nextSimilarities);
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
		const nextCueCondition = normalizeCueCondition(message.cue_condition) ?? normalizeCueCondition(message.condition);
		if (nextCueCondition) {
			setCueCondition(nextCueCondition);
		}

		if (isBoardStateMessage(message)) {
			setBoardState(message);
		}

		const nestedAdminRankingState = readNestedAdminRankingState(message);
		if (nestedAdminRankingState) {
			setAdminRankingState(nestedAdminRankingState);
		}

		if (isAdminRankingStateMessage(message)) {
			setAdminRankingState(message);
		}

		if (message.type === "ranking_state") {
			const scope = message.scope === "private" ? "private" : "public";
			const updatedBy = typeof message.updatedBy === "string" && !isAdminParticipantId(message.updatedBy) ? message.updatedBy : null;
			const nextSnapshot = {
				revision: typeof message.revision === "number" ? message.revision : 0,
				items: Array.isArray(message.items) ? (message.items as string[]) : []
			};

			setBoardState(current => ({
				type: "board_state",
				revision: typeof message.revision === "number" ? message.revision : current?.revision || 0,
				ranking: { items: scope === "public" ? nextSnapshot.items : current?.ranking?.items || [] },
				public_ranking: scope === "public" ? nextSnapshot : current?.public_ranking,
				private_rankings:
					scope === "private" && updatedBy
						? {
								...(current?.private_rankings ?? {}),
								[updatedBy]: nextSnapshot
							}
						: current?.private_rankings,
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

	useEffect(() => {
		const handleResize = () => {
			setLeftSidebarWidth(currentLeft => {
				const nextLeft = clampAdminLeftSidebarWidth(currentLeft, rightSidebarWidth);
				setRightSidebarWidth(currentRight => clampAdminRightSidebarWidth(currentRight, nextLeft));
				return nextLeft;
			});
		};

		handleResize();
		window.addEventListener("resize", handleResize);
		return () => window.removeEventListener("resize", handleResize);
	}, [rightSidebarWidth]);

	useEffect(() => {
		window.localStorage.setItem(ADMIN_LEFT_SIDEBAR_WIDTH_STORAGE_KEY, String(leftSidebarWidth));
	}, [leftSidebarWidth]);

	useEffect(() => {
		window.localStorage.setItem(ADMIN_RIGHT_SIDEBAR_WIDTH_STORAGE_KEY, String(rightSidebarWidth));
	}, [rightSidebarWidth]);

	const { isConnected: adminConnected, lastMessage: adminLastMessage, sendMessage: sendAdminMessage } = useAdminRealtimeSocket("admin", roomName, recordEvent);
	const { isConnected: boardConnected, lastMessage: boardLastMessage } = useAdminRealtimeSocket("board", roomName, recordEvent);
	const handleLeftSidebarResizeStart = (event: React.PointerEvent<HTMLButtonElement>) => {
		event.preventDefault();
		const resizeHandle = event.currentTarget;
		resizeHandle.setPointerCapture(event.pointerId);
		const startX = event.clientX;
		const startWidth = leftSidebarWidth;

		const handlePointerMove = (moveEvent: PointerEvent) => {
			setLeftSidebarWidth(clampAdminLeftSidebarWidth(startWidth + (moveEvent.clientX - startX), rightSidebarWidth));
		};

		const handlePointerUp = () => {
			if (resizeHandle.hasPointerCapture(event.pointerId)) {
				resizeHandle.releasePointerCapture(event.pointerId);
			}
			setResizeCursor(null);
			document.body.style.cursor = "";
			document.body.style.userSelect = "";
			window.removeEventListener("pointermove", handlePointerMove);
			window.removeEventListener("pointerup", handlePointerUp);
			window.removeEventListener("pointercancel", handlePointerUp);
		};

		setResizeCursor("col-resize");
		document.body.style.cursor = "col-resize";
		document.body.style.userSelect = "none";
		window.addEventListener("pointermove", handlePointerMove);
		window.addEventListener("pointerup", handlePointerUp);
		window.addEventListener("pointercancel", handlePointerUp);
	};
	const handleRightSidebarResizeStart = (event: React.PointerEvent<HTMLButtonElement>) => {
		event.preventDefault();
		const resizeHandle = event.currentTarget;
		resizeHandle.setPointerCapture(event.pointerId);
		const startX = event.clientX;
		const startWidth = rightSidebarWidth;

		const handlePointerMove = (moveEvent: PointerEvent) => {
			setRightSidebarWidth(clampAdminRightSidebarWidth(startWidth - (moveEvent.clientX - startX), leftSidebarWidth));
		};

		const handlePointerUp = () => {
			if (resizeHandle.hasPointerCapture(event.pointerId)) {
				resizeHandle.releasePointerCapture(event.pointerId);
			}
			setResizeCursor(null);
			document.body.style.cursor = "";
			document.body.style.userSelect = "";
			window.removeEventListener("pointermove", handlePointerMove);
			window.removeEventListener("pointerup", handlePointerUp);
			window.removeEventListener("pointercancel", handlePointerUp);
		};

		setResizeCursor("col-resize");
		document.body.style.cursor = "col-resize";
		document.body.style.userSelect = "none";
		window.addEventListener("pointermove", handlePointerMove);
		window.addEventListener("pointerup", handlePointerUp);
		window.addEventListener("pointercancel", handlePointerUp);
	};
	const handleLeftSidebarResizeKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
		if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
			return;
		}

		event.preventDefault();
		const direction = event.key === "ArrowRight" ? 1 : -1;
		setLeftSidebarWidth(current => clampAdminLeftSidebarWidth(current + direction * 24, rightSidebarWidth));
	};
	const handleRightSidebarResizeKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
		if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
			return;
		}

		event.preventDefault();
		const direction = event.key === "ArrowLeft" ? 1 : -1;
		setRightSidebarWidth(current => clampAdminRightSidebarWidth(current + direction * 24, leftSidebarWidth));
	};
	const startPhase = (phase: SessionPhase, minutesValue: string) => {
		sendAdminMessage({ type: "switch_phase", phase, duration_s: durationSecondsFromMinutes(minutesValue) });
	};
	const clearPhaseTimer = () => {
		sendAdminMessage({ type: "switch_phase", phase: currentPhase, duration_s: 0 });
	};
	const setSessionCueCondition = (condition: CueCondition) => {
		sendAdminMessage({ type: "set_cue_condition", condition });
		setCueCondition(condition);
	};
	const toggleCueBlockSelection = (blockId: number) => {
		setManualCueError(null);
		setSelectedCueBlockIds(current => {
			if (current.includes(blockId)) {
				return current.filter(id => id !== blockId);
			}
			return [...current, blockId].slice(-2);
		});
	};
	const publicRankingSnapshot =
		adminRankingState?.public_ranking ?? boardState?.public_ranking ?? (boardState?.ranking?.items ? { revision: boardState.revision, items: boardState.ranking.items } : null);
	const publicRankingItems = publicRankingSnapshot ? normalizeRankingItemIds(publicRankingSnapshot.items, defaultRankingItemIds) : [];
	const privateRankingMap = adminRankingState?.private_rankings ?? boardState?.private_rankings ?? {};
	const privateRankingEntries = Object.entries(privateRankingMap)
		.filter(([participantId]) => !isAdminParticipantId(participantId))
		.sort(([a], [b]) => Number(a) - Number(b));
	const privateRankingColumns = privateRankingEntries.map(([participantId, ranking]) => {
		const items = normalizeRankingItemIds(ranking.items, defaultRankingItemIds);
		return {
			key: `private-${participantId}`,
			label: `User ${participantId}`,
			revision: ranking.revision,
			rankIndexById: new Map(items.map((item, index) => [item, index + 1]))
		};
	});
	const isExperimentalCondition = cueCondition === "experimental";
	const isSimilarityCueActive = isExperimentalCondition && currentPhase === "group";
	const rankingRowIndexes = Array.from({ length: publicRankingItems.length }, (_, index) => index);
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
	const selectedCueBlocks = selectedCueBlockIds.map(blockId => ideaBlocks.find(block => block.id === blockId)).filter((block): block is IdeaBlockRecord => !!block);
	const manualCueHistory = similarities
		.filter(similarity => similarity.reason.includes(MANUAL_CUE_REASON_PREFIX))
		.sort((a, b) => b.id - a.id)
		.slice(0, 6);
	const createManualCue = async () => {
		if (selectedCueBlocks.length !== 2 || isCreatingManualCue || !isExperimentalCondition) {
			return;
		}

		setIsCreatingManualCue(true);
		setManualCueError(null);
		try {
			const [firstBlock, secondBlock] = selectedCueBlocks;
			const response = await fetch(buildSessionApiUrl(roomName, "/similarities"), {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					idea_block_id_1: firstBlock.id,
					idea_block_id_2: secondBlock.id,
					reason: `${MANUAL_CUE_REASON_PREFIX} idea block #${firstBlock.id} and #${secondBlock.id}`
				})
			});

			if (!response.ok) {
				throw new Error(`Failed to create manual cue (${response.status})`);
			}

			const createdSimilarity = (await response.json()) as { id: number };
			setIdeaBlocks(current =>
				current.map(block => (block.id === firstBlock.id ? { ...block, similarity_id: secondBlock.id } : block.id === secondBlock.id ? { ...block, similarity_id: firstBlock.id } : block))
			);
			recordEvent("admin", {
				type: "manual_similarity_cue",
				similarity_id: createdSimilarity.id,
				idea_block_id_1: firstBlock.id,
				idea_block_id_2: secondBlock.id
			});
			setSelectedCueBlockIds([]);
			void loadAdminApiData();
		} catch (error) {
			setManualCueError(error instanceof Error ? error.message : String(error));
		} finally {
			setIsCreatingManualCue(false);
		}
	};
	const undoManualCue = async (similarity: SimilarityRecord) => {
		if (undoingManualCueId !== null) {
			return;
		}

		setUndoingManualCueId(similarity.id);
		setManualCueError(null);
		try {
			const response = await fetch(buildSessionApiUrl(roomName, `/similarities/${encodeURIComponent(String(similarity.id))}`), {
				method: "DELETE"
			});
			if (!response.ok) {
				throw new Error(`Failed to undo manual cue (${response.status})`);
			}

			setSimilarities(current => current.filter(item => item.id !== similarity.id));
			setIdeaBlocks(current =>
				current.map(block =>
					block.id === similarity.idea_block_id_1 || block.id === similarity.idea_block_id_2
						? {
								...block,
								similarity_id: null
							}
						: block
				)
			);
			recordEvent("admin", {
				type: "manual_similarity_cue_undone",
				similarity_id: similarity.id,
				idea_block_id_1: similarity.idea_block_id_1,
				idea_block_id_2: similarity.idea_block_id_2
			});
			void loadAdminApiData();
		} catch (error) {
			setManualCueError(error instanceof Error ? error.message : String(error));
		} finally {
			setUndoingManualCueId(null);
		}
	};

	return (
		<main
			className="grid min-h-screen grid-cols-1 gap-4 bg-muted/40 p-4 text-foreground xl:grid-cols-[var(--admin-left-sidebar-width)_minmax(0,1fr)_var(--admin-right-sidebar-width)]"
			style={adminLayoutStyle}
		>
			{resizeCursor && <div className="fixed inset-0 z-50 touch-none select-none" style={{ cursor: resizeCursor }} />}
			<aside className="relative flex min-h-0 min-w-[var(--admin-left-sidebar-width)] flex-col gap-4">
				<button
					type="button"
					className="absolute -right-3 top-1/2 hidden h-24 w-2 -translate-y-1/2 cursor-col-resize rounded-full bg-border transition-colors hover:bg-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring xl:block"
					aria-label="調整左側 Admin 欄寬"
					aria-orientation="vertical"
					aria-valuemin={MIN_ADMIN_LEFT_SIDEBAR_WIDTH}
					aria-valuenow={leftSidebarWidth}
					role="separator"
					onPointerDown={handleLeftSidebarResizeStart}
					onKeyDown={handleLeftSidebarResizeKeyDown}
				/>
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
						<Lightbulb className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
						<h2 className="text-sm font-semibold">Cue Condition</h2>
					</header>
					<div className="grid gap-3">
						<div className="flex items-center justify-between gap-3 rounded-md border bg-background px-3 py-2 text-sm">
							<div className="min-w-0">
								<div className="font-medium">{isExperimentalCondition ? "實驗組" : "對照組"}</div>
								<div className="text-xs text-muted-foreground">{isSimilarityCueActive ? "Similarity cue on" : "Similarity cue off"}</div>
							</div>
							<Badge variant={isExperimentalCondition ? "secondary" : "outline"}>{isExperimentalCondition ? "cue on" : "cue off"}</Badge>
						</div>
						<div className="grid grid-cols-2 gap-2">
							<Button type="button" variant={isExperimentalCondition ? "default" : "outline"} onClick={() => setSessionCueCondition("experimental")}>
								實驗組
							</Button>
							<Button type="button" variant={!isExperimentalCondition ? "default" : "outline"} onClick={() => setSessionCueCondition("control")}>
								對照組
							</Button>
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
							<Lightbulb className="h-4 w-4" aria-hidden="true" />
							<span>REST API</span>
						</div>
						<h2 className="mt-1 text-lg font-semibold">Idea blocks</h2>
					</div>
					<Badge variant="secondary">{filteredIdeaBlocks.length} blocks</Badge>
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
					<div className="flex flex-wrap items-center justify-between gap-3 rounded-md border bg-background px-3 py-2">
						<div className="min-w-0 text-sm">
							<div className="flex items-center gap-2 font-medium">
								<Link2 className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
								<span>Manual cue</span>
							</div>
							<p className="mt-1 truncate text-xs text-muted-foreground">
								{!isExperimentalCondition
									? "Control condition: similarity cues are disabled"
									: selectedCueBlocks.length > 0
										? selectedCueBlocks.map(block => `#${block.id} user ${block.user_id}`).join(" + ")
										: "Select 2 idea blocks to cue together"}
							</p>
						</div>
						<div className="flex shrink-0 items-center gap-2">
							{selectedCueBlocks.length > 0 && (
								<Button type="button" size="sm" variant="ghost" className="gap-1" onClick={() => setSelectedCueBlockIds([])} disabled={isCreatingManualCue}>
									<X className="h-3.5 w-3.5" aria-hidden="true" />
									Clear
								</Button>
							)}
							<Button type="button" size="sm" className="gap-2" onClick={() => void createManualCue()} disabled={selectedCueBlocks.length !== 2 || isCreatingManualCue || !isExperimentalCondition}>
								<Link2 className="h-3.5 w-3.5" aria-hidden="true" />
								{isCreatingManualCue ? "Sending" : "Send cue"}
							</Button>
						</div>
						{manualCueError && <p className="basis-full text-xs text-destructive">{manualCueError}</p>}
					</div>
					{manualCueHistory.length > 0 && (
						<div className="grid gap-2 rounded-md border bg-background px-3 py-2">
							<div className="flex items-center justify-between gap-2">
								<div className="flex items-center gap-2 text-sm font-medium">
									<Undo2 className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
									<span>Manual cue history</span>
								</div>
								<Badge variant="outline">{manualCueHistory.length}</Badge>
							</div>
							<div className="grid gap-1.5">
								{manualCueHistory.map(similarity => (
									<div key={similarity.id} className="flex items-center justify-between gap-2 rounded-md bg-muted/70 px-2 py-1.5 text-xs">
										<div className="min-w-0">
											<div className="truncate font-medium">
												#{similarity.idea_block_id_1} ↔ #{similarity.idea_block_id_2}
											</div>
											<div className="truncate text-muted-foreground">
												{similarity.idea_block_1.summary || "Idea block"} / {similarity.idea_block_2.summary || "Idea block"}
											</div>
										</div>
										<Button type="button" size="sm" variant="ghost" className="h-7 shrink-0 gap-1 px-2 text-xs" onClick={() => void undoManualCue(similarity)} disabled={undoingManualCueId !== null}>
											<Undo2 className="h-3.5 w-3.5" aria-hidden="true" />
											{undoingManualCueId === similarity.id ? "Undoing" : "Undo"}
										</Button>
									</div>
								))}
							</div>
						</div>
					)}
				</div>
				<ScrollArea className="min-h-0 flex-1 p-4">
					{filteredIdeaBlocks.length > 0 ? (
						<div className="grid gap-3">
							{filteredIdeaBlocks.map(block => {
								const isSelectedForCue = selectedCueBlockIds.includes(block.id);
								return (
									<article key={block.id} className={cn("rounded-lg border bg-background p-3 transition-colors", isSelectedForCue && "border-primary bg-primary/5")}>
										<div className="mb-3 flex flex-wrap items-center justify-between gap-2">
											<div className="flex min-w-0 items-center gap-2">
												<Badge variant="outline">user {block.user_id}</Badge>
												<span className="truncate text-sm font-medium">idea block #{block.id}</span>
											</div>
											<div className="flex items-center gap-2">
												{block.similarity_id && <Badge variant="secondary">similarity</Badge>}
												<Button
													type="button"
													size="sm"
													variant={isSelectedForCue ? "secondary" : "outline"}
													className="gap-1"
													onClick={() => toggleCueBlockSelection(block.id)}
													disabled={isCreatingManualCue || !isExperimentalCondition}
												>
													{isSelectedForCue && <Check className="h-3.5 w-3.5" aria-hidden="true" />}
													{isSelectedForCue ? "Selected" : "Select"}
												</Button>
											</div>
										</div>
										<p className="text-sm font-semibold leading-6">{block.title || block.summary || "-"}</p>
										{block.summary && block.summary !== block.title && <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-muted-foreground">{block.summary}</p>}
										{block.transcript && <p className="mt-3 whitespace-pre-wrap border-t pt-3 text-xs leading-5 text-muted-foreground">{block.transcript}</p>}
									</article>
								);
							})}
						</div>
					) : (
						<EmptyState title="尚無 idea blocks" detail="這裡只讀取 REST API 的 session idea blocks，不使用 board WebSocket block payload。" />
					)}
				</ScrollArea>
			</section>

			<aside className="relative flex min-h-0 min-w-[var(--admin-right-sidebar-width)] flex-col gap-4">
				<button
					type="button"
					className="absolute -left-3 top-1/2 hidden h-24 w-2 -translate-y-1/2 cursor-col-resize rounded-full bg-border transition-colors hover:bg-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring xl:block"
					aria-label="調整右側 Admin 欄寬"
					aria-orientation="vertical"
					aria-valuemin={MIN_ADMIN_RIGHT_SIDEBAR_WIDTH}
					aria-valuenow={rightSidebarWidth}
					role="separator"
					onPointerDown={handleRightSidebarResizeStart}
					onKeyDown={handleRightSidebarResizeKeyDown}
				/>
				<section className="rounded-lg border bg-card p-4 text-card-foreground">
					<header className="mb-3 flex items-center gap-2">
						<ClipboardList className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
						<h2 className="text-sm font-semibold">Ranking state</h2>
					</header>
					{publicRankingSnapshot ? (
						<div className="overflow-x-auto rounded-lg border bg-background">
							<table className="w-full min-w-[320px] border-collapse text-left text-xs">
								<thead>
									<tr className="border-b bg-muted/60">
										<th className="sticky left-0 z-10 w-10 bg-muted/95 px-2 py-2 font-semibold text-muted-foreground">#</th>
										<th className="min-w-40 px-2 py-2 font-semibold">
											<div className="flex min-w-0 items-center justify-between gap-2">
												<span className="truncate">Public</span>
												<span className="shrink-0 rounded border bg-background px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">r{publicRankingSnapshot.revision}</span>
											</div>
										</th>
										{privateRankingColumns.map(column => (
											<th key={column.key} className="w-16 px-2 py-2 text-center font-semibold">
												<div className="flex min-w-0 items-center justify-between gap-2">
													<span className="truncate">{column.label}</span>
													<span className="shrink-0 rounded border bg-background px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">r{column.revision}</span>
												</div>
											</th>
										))}
									</tr>
								</thead>
								<tbody>
									{rankingRowIndexes.map(rowIndex => (
										<tr key={rowIndex} className="border-b last:border-b-0">
											<td className="sticky left-0 z-10 bg-background px-2 py-2 font-semibold text-muted-foreground">{rowIndex + 1}</td>
											<td className="max-w-44 px-2 py-2 align-top">
												<span className="block truncate rounded-md bg-muted px-2 py-1 font-medium">{rankingLabels[publicRankingItems[rowIndex]] || publicRankingItems[rowIndex] || "-"}</span>
											</td>
											{privateRankingColumns.map(column => {
												const conflict = getRankConflict(publicRankingItems[rowIndex], rowIndex + 1, column.rankIndexById);
												return (
													<td key={column.key} className="px-2 py-2 text-center align-middle">
														<span
															className={cn(
																"inline-flex min-h-6 min-w-8 items-center justify-center rounded-md px-1.5 py-1 font-medium text-muted-foreground",
																!conflict?.isConflict && "bg-muted/60",
																conflict?.isConflict && "ring-1 ring-muted-foreground/30"
															)}
															title={conflict ? `與 Public 排序差 ${conflict.amount} 位` : undefined}
														>
															{conflict && conflict.amount > 0 ? (
																<span
																	className={cn(
																		"inline-flex shrink-0 items-center gap-0.5 text-[10px] font-semibold",
																		conflict.isConflict && conflict.direction === "up" && "text-emerald-700",
																		conflict.isConflict && conflict.direction === "down" && "text-rose-700",
																		!conflict.isConflict && "text-muted-foreground/60"
																	)}
																	aria-label={`與 Public 排序差 ${conflict.amount} 位，Private 排序${conflict.direction === "up" ? "較前" : "較後"}`}
																>
																	<span
																		className={cn(
																			"h-0 w-0 border-x-[4px] border-x-transparent",
																			conflict.direction === "up" && conflict.isConflict && "border-b-[7px] border-b-emerald-600",
																			conflict.direction === "down" && conflict.isConflict && "border-t-[7px] border-t-rose-600",
																			conflict.direction === "up" && !conflict.isConflict && "border-b-[7px] border-b-muted-foreground/40",
																			conflict.direction === "down" && !conflict.isConflict && "border-t-[7px] border-t-muted-foreground/40"
																		)}
																		aria-hidden="true"
																	/>
																	{conflict.amount}
																</span>
															) : (
																<span className="text-muted-foreground/60" aria-hidden="true">
																	-
																</span>
															)}
														</span>
													</td>
												);
											})}
										</tr>
									))}
								</tbody>
							</table>
						</div>
					) : (
						<EmptyState title="尚未收到 ranking state" detail="admin WebSocket join 後會回傳 public 與每位 participant 的 private ranking；有排序更新時會即時刷新。" />
					)}
				</section>

				<section className="min-h-0 flex-1 overflow-hidden rounded-lg border bg-card text-card-foreground">
					<header className="flex items-center justify-between gap-3 border-b p-4">
						<div className="flex items-center gap-2">
							<FileText className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
							<h2 className="text-sm font-semibold">Transcripts</h2>
						</div>
						<Badge variant="outline">{filteredTranscripts.length}</Badge>
					</header>
					<ScrollArea className="h-[360px] p-4">
						{filteredTranscripts.length > 0 ? (
							<div className="grid gap-3">
								{filteredTranscripts.map(item => (
									<article key={item.id} className="rounded-lg border bg-background p-3 text-sm">
										<div className="mb-2 flex flex-wrap items-center justify-between gap-2">
											<div className="flex items-center gap-2">
												<Badge variant="outline">user {item.user_id}</Badge>
												<span className="font-medium">#{item.id}</span>
											</div>
											<span className="text-xs text-muted-foreground">{formatApiTime(item.time_stamp)}</span>
										</div>
										<p className="line-clamp-5 whitespace-pre-wrap leading-5">{item.transcript}</p>
									</article>
								))}
							</div>
						) : (
							<EmptyState title="尚無 transcripts" detail="這裡只讀取 REST API，不使用 WebSocket 的 transcript 或 idea block 事件。" />
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
