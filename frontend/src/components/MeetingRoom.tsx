import type { DragEndEvent } from "@dnd-kit/core";
import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { AlertCircle, GripVertical, Maximize, Mic, MicOff, Minimize, Radio } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useAudioStream } from "../hooks/useAudioStream";
import { useParticipantIdentity } from "../hooks/useParticipantIdentity";
import { useWebSocket } from "../hooks/useWebSocket";
import { isValidParticipantId } from "../lib/participantDefaults";
import { cn } from "../lib/utils";
import { fetchTaskConfig, type TaskConfigItem } from "../services/api";
import type { MicMode } from "../types";
import { JitsiRoom, type JitsiConnectionStatus } from "./JitsiRoom";
import { PrivateBoard } from "./private-board/PrivateBoard";
import { Button } from "./ui/Button";
import { ShortcutKey } from "./ui/ShortcutKey";

interface LostAtSeaItem {
	id: string;
	label: string;
	description: string;
	rank: number;
	imageTitle: string;
	imageBg: string;
	imageFg: string;
	imageMark: string;
}

type RankingScope = "public" | "private";
type SessionPhase = "private" | "group";
const jitsiStatusLabels: Record<JitsiConnectionStatus, string> = {
	loading: "連線中",
	connected: "已連線",
	closed: "已離線",
	unavailable: "未啟用"
};

interface RankingSnapshot {
	revision: number;
	items: string[];
}

const jitsiBaseUrl = import.meta.env.VITE_JITSI_BASE_URL || "https://meet.omni.elvismao.com";
const DEFAULT_PRIVATE_BOARD_WIDTH = 560;
const MIN_PRIVATE_BOARD_WIDTH = 520;
const MIN_MEETING_COLUMN_WIDTH = 520;
const PRIVATE_BOARD_WIDTH_STORAGE_KEY = "omni.meeting.privateBoardWidth";
const DEFAULT_JITSI_HEIGHT = 220;
const MIN_JITSI_HEIGHT = 220;
const MIN_RANKING_HEIGHT = 220;
const JITSI_HEIGHT_STORAGE_KEY = "omni.meeting.jitsiHeight";
const PRIVATE_PUBLIC_RANK_CONFLICT_THRESHOLD = 3;
const ITEM_DESCRIPTIONS: Record<string, string> = {
	sextant: "航海上用來測量天體或地平線角度的儀器。",
	shaving_mirror: "小型鏡子，通常用來刮鬍子或整理儀容。",
	water_container: "一桶可飲用的淡水，容量約 20L。",
	mosquito_net: "掛在睡覺區域外的細網布，通常用來防蚊蟲。",
	emergency_rations: "可長時間保存的軍用罐裝或包裝食品。",
	sea_chart: "紙本海圖，標示太平洋海域與島嶼位置。",
	floating_cushion: "可漂浮的方形坐墊，通常作為船上安全裝備。",
	petrol: "汽油與機油混合的燃料，通常供小型引擎使用。",
	receive_only_radio: "小型收音機，通常用來接收廣播。",
	shark_repellent: "標示為可驅避鯊魚的罐裝或包裝用品。",
	waterproof_sheet: "不透明、防水的塑膠布，面積約 2m²。",
	rum: "酒精濃度約 80% 的蘭姆酒，容量約 1L。",
	rope: "尼龍材質的繩子，長度約 5m。",
	chocolate_bars: "兩盒一般巧克力棒。",
	fishing_rod: "包含魚線、魚鉤等用品的釣魚工具組。"
};

function createInitialItems(items: TaskConfigItem[]): LostAtSeaItem[] {
	return items.map((item, index) => createLostAtSeaItem(item, index));
}

function createLostAtSeaItem(item: TaskConfigItem, index: number): LostAtSeaItem {
	return {
		id: item.id,
		label: item.label,
		description: item.description_zh || ITEM_DESCRIPTIONS[item.id] || "",
		rank: index + 1,
		imageTitle: item.image_title || item.label_en || item.label,
		imageBg: item.image_bg || "#f8fafc",
		imageFg: item.image_fg || "#334155",
		imageMark: item.image_mark || "ITEM"
	};
}

function taskItemImageSrc(itemId: string): string {
	return `/task-item-images/${itemId}.jpg`;
}

function taskItemFallbackImageSrc(item: LostAtSeaItem): string {
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 220"><rect width="320" height="220" rx="24" fill="${item.imageBg}"/><circle cx="72" cy="76" r="36" fill="#fff" opacity=".72"/><rect x="112" y="48" width="136" height="96" rx="18" fill="#fff" opacity=".72"/><path d="M68 156 C112 126 156 188 204 146 C226 126 250 128 276 150" fill="none" stroke="${item.imageFg}" stroke-width="10" stroke-linecap="round"/><text x="160" y="113" text-anchor="middle" font-family="Arial, sans-serif" font-size="34" font-weight="700" fill="${item.imageFg}">${item.imageMark}</text><text x="160" y="194" text-anchor="middle" font-family="Arial, sans-serif" font-size="18" font-weight="600" fill="${item.imageFg}">${item.imageTitle}</text></svg>`;
	return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function handleTaskItemImageError(event: React.SyntheticEvent<HTMLImageElement>, item: LostAtSeaItem) {
	event.currentTarget.src = taskItemFallbackImageSrc(item);
}

function clampPrivateBoardWidth(width: number) {
	const availableWidth = window.innerWidth - 32 - 16;
	const maxWidth = Math.max(MIN_PRIVATE_BOARD_WIDTH, availableWidth - MIN_MEETING_COLUMN_WIDTH);
	return Math.min(Math.max(width, MIN_PRIVATE_BOARD_WIDTH), maxWidth);
}

function clampJitsiHeight(height: number) {
	const availableHeight = window.innerHeight - 32 - 24 - 24 - 56;
	const maxHeight = Math.max(MIN_JITSI_HEIGHT, availableHeight - MIN_RANKING_HEIGHT);
	return Math.min(Math.max(height, MIN_JITSI_HEIGHT), maxHeight);
}

function isEditableShortcutTarget(target: EventTarget | null) {
	if (!(target instanceof HTMLElement)) {
		return false;
	}

	const editableElement = target.closest("input, textarea, select, [contenteditable=''], [contenteditable='true'], [role='textbox']");
	if (!editableElement) {
		return false;
	}

	if (editableElement instanceof HTMLInputElement) {
		return editableElement.type !== "button" && editableElement.type !== "checkbox" && editableElement.type !== "radio" && editableElement.type !== "submit";
	}

	return true;
}

function normalizeRankingItemIds(itemIds: string[], defaultItemIds: string[]): string[] {
	const validIds = new Set(defaultItemIds);
	const rankedValidIds = itemIds.filter((id, index) => validIds.has(id) && itemIds.indexOf(id) === index);
	const missingIds = defaultItemIds.filter(id => !rankedValidIds.includes(id));

	return [...rankedValidIds, ...missingIds];
}

function createRankedItems(itemIds: string[], taskItemsById: Record<string, TaskConfigItem>, defaultItemIds: string[]): LostAtSeaItem[] {
	return normalizeRankingItemIds(itemIds, defaultItemIds).map((id, index) =>
		createLostAtSeaItem(
			taskItemsById[id] ?? {
				id,
				label: id,
				label_zh: id,
				label_en: id,
				description_zh: "",
				aliases: [],
				image_title: id,
				image_bg: "#f8fafc",
				image_fg: "#334155",
				image_mark: "ITEM"
			},
			index
		)
	);
}

function createRankIndexById(items: LostAtSeaItem[]): Map<string, number> {
	return new Map(items.map((item, index) => [item.id, index + 1]));
}

function isRankingStateMessage(message: object | null): message is { type: "ranking_state"; scope?: RankingScope; revision: number; items: string[] } {
	return !!message && "type" in message && message.type === "ranking_state" && "items" in message && Array.isArray(message.items);
}

function isRankingSnapshot(value: unknown): value is RankingSnapshot {
	return typeof value === "object" && value !== null && "revision" in value && typeof value.revision === "number" && "items" in value && Array.isArray(value.items);
}

function isBoardStateMessage(message: object | null): message is {
	type: "board_state";
	revision: number;
	ranking?: { items: string[] };
	public_ranking?: RankingSnapshot;
	private_ranking?: RankingSnapshot;
	current_phase?: SessionPhase;
	timer_end_time_ms?: number;
} {
	return (
		!!message &&
		"type" in message &&
		message.type === "board_state" &&
		(("public_ranking" in message && isRankingSnapshot(message.public_ranking)) ||
			("private_ranking" in message && isRankingSnapshot(message.private_ranking)) ||
			("ranking" in message && typeof message.ranking === "object" && message.ranking !== null && "items" in message.ranking && Array.isArray(message.ranking.items)))
	);
}

function isPhaseChangedMessage(message: object | null): message is {
	type: "phase_changed";
	phase: SessionPhase;
	end_time_ms?: number;
} {
	return !!message && "type" in message && message.type === "phase_changed" && "phase" in message && (message.phase === "private" || message.phase === "group");
}

function isCountdownChangedMessage(message: object | null): message is {
	type: "countdown_changed";
	current_phase?: SessionPhase;
	timer_end_time_ms?: number;
	end_time_ms?: number;
} {
	return !!message && "type" in message && message.type === "countdown_changed";
}

function isJoinRejectedMessage(message: object | null): message is {
	type: "join_rejected";
	message?: string;
} {
	return !!message && "type" in message && message.type === "join_rejected";
}

function SortableLostAtSeaItem({ item, rankDelta, onPreview }: { item: LostAtSeaItem; rankDelta?: number; onPreview: (item: LostAtSeaItem) => void }) {
	const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
		id: item.id
	});
	const verticalTransform = transform ? { ...transform, x: 0 } : transform;
	const isRankConflict = typeof rankDelta === "number" && Math.abs(rankDelta) > PRIVATE_PUBLIC_RANK_CONFLICT_THRESHOLD;
	const rankConflictDirection = isRankConflict && rankDelta < 0 ? "up" : "down";
	const rankConflictAmount = isRankConflict ? Math.abs(rankDelta) : 0;

	return (
		<div
			ref={setNodeRef}
			className={cn(
				"flex min-h-10 cursor-grab select-none items-center gap-3 rounded-lg border bg-background px-3 py-2 transition-colors",
				isRankConflict && "border-muted-foreground/30",
				isDragging && "opacity-50"
			)}
			style={{
				transform: CSS.Transform.toString(verticalTransform),
				transition
			}}
			title={isRankConflict ? `與 Public 排序差 ${rankConflictAmount} 位` : undefined}
			{...attributes}
			{...listeners}
		>
			<button
				type="button"
				className="h-9 w-12 shrink-0 overflow-hidden rounded-md border bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
				aria-label={`放大查看 ${item.label}`}
				onClick={event => {
					event.stopPropagation();
					onPreview(item);
				}}
				onPointerDown={event => event.stopPropagation()}
			>
				<img className="h-full w-full object-cover" src={taskItemImageSrc(item.id)} alt={item.imageTitle} draggable={false} onError={event => handleTaskItemImageError(event, item)} />
			</button>
			<span className="grid h-6 w-6 place-items-center rounded-full bg-muted text-xs font-semibold text-primary">{item.rank}</span>
			<span className="min-w-0 flex-1">{item.label}</span>
			{isRankConflict && (
				<span
					className={cn("inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-xs font-semibold", rankConflictDirection === "up" ? "text-emerald-700" : "text-rose-700")}
					aria-label={`與 Public 排序差 ${rankConflictAmount} 位，Private 排序${rankConflictDirection === "up" ? "較前" : "較後"}`}
				>
					<span
						className={cn("h-0 w-0 border-x-[5px] border-x-transparent", rankConflictDirection === "up" ? "border-b-[8px] border-b-emerald-600" : "border-t-[8px] border-t-rose-600")}
						aria-hidden="true"
					/>
					{rankConflictAmount}
				</span>
			)}
			<GripVertical className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
		</div>
	);
}

function LostAtSeaRankingPanel({
	title,
	status,
	items,
	sensors,
	onDragStart,
	onDragCancel,
	onDragEnd,
	onPreviewItem,
	getRankDelta
}: {
	title: string;
	status: string;
	items: LostAtSeaItem[];
	sensors: ReturnType<typeof useSensors>;
	onDragStart: () => void;
	onDragCancel: () => void;
	onDragEnd: (event: DragEndEvent) => void;
	onPreviewItem: (item: LostAtSeaItem) => void;
	getRankDelta?: (item: LostAtSeaItem) => number | undefined;
}) {
	return (
		<section className="flex min-h-[260px] min-w-0 flex-col overflow-hidden rounded-lg border p-3" aria-label={title}>
			<header className="mb-3 flex shrink-0 items-center justify-between gap-3">
				<h3 className="min-w-0 truncate text-sm font-semibold">{title}</h3>
				<span className="shrink-0 text-xs text-muted-foreground">{status}</span>
			</header>
			<DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={onDragStart} onDragCancel={onDragCancel} onDragEnd={onDragEnd}>
				<SortableContext items={items.map(item => item.id)} strategy={verticalListSortingStrategy}>
					<div className="grid min-h-0 flex-1 gap-2 overflow-y-auto pr-1">
						{items.map(item => (
							<SortableLostAtSeaItem key={item.id} item={item} rankDelta={getRankDelta?.(item)} onPreview={onPreviewItem} />
						))}
					</div>
				</SortableContext>
			</DndContext>
		</section>
	);
}

export default function MeetingRoom() {
	const [micMode, setMicMode] = useState<MicMode>("off");
	const [micPermission, setMicPermission] = useState<PermissionState | "unknown">("unknown");
	const [taskTitle, setTaskTitle] = useState("Lost at Sea");
	const [taskDetail, setTaskDetail] = useState("");
	const [taskItems, setTaskItems] = useState<TaskConfigItem[]>([]);
	const [publicItems, setPublicItems] = useState<LostAtSeaItem[]>([]);
	const [privateItems, setPrivateItems] = useState<LostAtSeaItem[]>([]);
	const [publicRankingRevision, setPublicRankingRevision] = useState(0);
	const [privateRankingRevision, setPrivateRankingRevision] = useState(0);
	const [currentPhase, setCurrentPhase] = useState<SessionPhase>("private");
	const [timerEndTime, setTimerEndTime] = useState(0);
	const [isTaskDetailOpen, setIsTaskDetailOpen] = useState(false);
	const [previewItem, setPreviewItem] = useState<LostAtSeaItem | null>(null);
	const [jitsiStatus, setJitsiStatus] = useState<JitsiConnectionStatus>("loading");
	const [privateBoardWidth, setPrivateBoardWidth] = useState(() => {
		const storedWidth = Number(window.localStorage.getItem(PRIVATE_BOARD_WIDTH_STORAGE_KEY));
		return clampPrivateBoardWidth(Number.isFinite(storedWidth) ? storedWidth : DEFAULT_PRIVATE_BOARD_WIDTH);
	});
	const [jitsiHeight, setJitsiHeight] = useState(() => {
		const storedHeight = Number(window.localStorage.getItem(JITSI_HEIGHT_STORAGE_KEY));
		return clampJitsiHeight(Number.isFinite(storedHeight) ? Math.min(storedHeight, DEFAULT_JITSI_HEIGHT) : DEFAULT_JITSI_HEIGHT);
	});
	const [isFullscreen, setIsFullscreen] = useState(false);
	const [resizeCursor, setResizeCursor] = useState<"col-resize" | "row-resize" | null>(null);
	const isDraggingRef = useRef<Record<RankingScope, boolean>>({ public: false, private: false });
	const pendingRankingRef = useRef<Record<RankingScope, RankingSnapshot | null>>({ public: null, private: null });
	const { participantId, displayName, roomName } = useParticipantIdentity();
	const isParticipantIdValid = isValidParticipantId(participantId);
	const connectionParticipantId = isParticipantIdValid ? participantId : undefined;
	const sessionId = roomName;
	const { sendMessage, lastMessage, isConnected } = useWebSocket(sessionId, connectionParticipantId);
	const joinRejectedMessage = isJoinRejectedMessage(lastMessage) ? lastMessage.message || "這個 Participant ID 已經在此 session 中，不能重複進入。" : null;
	const { startAudioStream, stopAudioStream, lastAudioMessage, audioError } = useAudioStream(sessionId, connectionParticipantId, displayName);
	const sensors = useSensors(useSensor(PointerSensor), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
	const hasAudioConnectionError = micMode !== "off" && !!audioError;
	const handleJitsiStatusChange = useCallback((status: JitsiConnectionStatus) => {
		setJitsiStatus(status);
	}, []);
	const taskItemsById = useMemo(() => Object.fromEntries(taskItems.map(item => [item.id, item])), [taskItems]);
	const defaultItemIds = useMemo(() => taskItems.map(item => item.id), [taskItems]);
	const publicRankIndexById = useMemo(() => createRankIndexById(publicItems), [publicItems]);
	const shouldHighlightRankConflict = currentPhase === "group";
	const meetingLayoutStyle = {
		"--private-board-width": `${privateBoardWidth}px`,
		"--jitsi-height": `${jitsiHeight}px`
	} as CSSProperties;

	useEffect(() => {
		const queryPermission = async () => {
			try {
				const result = await navigator.permissions.query({ name: "microphone" as PermissionName });
				setMicPermission(result.state);
				result.onchange = () => {
					setMicPermission(result.state);
				};
			} catch (err) {
				console.error("Failed to query microphone permission", err);
			}
		};
		void queryPermission();
	}, []);

	useEffect(() => {
		const handleFullscreenChange = () => {
			setIsFullscreen(!!document.fullscreenElement);
		};
		document.addEventListener("fullscreenchange", handleFullscreenChange);
		return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
	}, []);

	const toggleFullscreen = async () => {
		if (!document.fullscreenElement) {
			await document.documentElement.requestFullscreen();
		} else {
			await document.exitFullscreen();
		}
	};

	useEffect(() => {
		const abortController = new AbortController();

		const loadTaskConfig = async () => {
			try {
				const taskConfig = await fetchTaskConfig(abortController.signal);
				const nextTaskItemsById = Object.fromEntries(taskConfig.items.map(item => [item.id, item]));
				const nextDefaultItemIds = taskConfig.items.map(item => item.id);
				const nextItems = createInitialItems(taskConfig.items);

				setTaskTitle(taskConfig.title);
				setTaskDetail(taskConfig.task_detail);
				setTaskItems(taskConfig.items);
				setPublicItems(current =>
					current.length > 0
						? createRankedItems(
								current.map(item => item.id),
								nextTaskItemsById,
								nextDefaultItemIds
							)
						: nextItems
				);
				setPrivateItems(current =>
					current.length > 0
						? createRankedItems(
								current.map(item => item.id),
								nextTaskItemsById,
								nextDefaultItemIds
							)
						: nextItems
				);
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

	const requestMicPermission = async () => {
		try {
			const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
			stream.getTracks().forEach(track => track.stop());
			setMicPermission("granted");
		} catch (err) {
			console.error("Failed to get mic permission", err);
			setMicPermission("denied");
		}
	};

	const handleMic = useCallback(
		async (mode: MicMode) => {
			const shouldRetryCurrentMode = mode !== "off" && micMode === mode && hasAudioConnectionError;
			const nextMode = shouldRetryCurrentMode ? mode : mode === "off" ? "off" : micMode === mode ? "off" : mode;

			setMicMode(nextMode);

			if (nextMode === "off") {
				stopAudioStream();
				return;
			}

			await startAudioStream(nextMode);
		},
		[hasAudioConnectionError, micMode, startAudioStream, stopAudioStream]
	);

	useEffect(() => {
		const handleMicShortcutKeyDown = (event: KeyboardEvent) => {
			if (event.defaultPrevented || event.repeat || event.metaKey || event.ctrlKey || event.altKey || isEditableShortcutTarget(event.target)) {
				return;
			}

			if (event.code === "Space") {
				event.preventDefault();
				void handleMic("public");
				return;
			}

			if (event.code === "KeyW") {
				event.preventDefault();
				void handleMic("private");
			}
		};

		window.addEventListener("keydown", handleMicShortcutKeyDown);
		return () => window.removeEventListener("keydown", handleMicShortcutKeyDown);
	}, [handleMic]);

	const applyRankingSnapshot = useCallback(
		(scope: RankingScope, snapshot: RankingSnapshot) => {
			if (defaultItemIds.length === 0) {
				pendingRankingRef.current[scope] = snapshot;
				return;
			}
			if (scope === "private") {
				setPrivateRankingRevision(snapshot.revision);
				setPrivateItems(createRankedItems(snapshot.items, taskItemsById, defaultItemIds));
				return;
			}

			setPublicRankingRevision(snapshot.revision);
			setPublicItems(createRankedItems(snapshot.items, taskItemsById, defaultItemIds));
		},
		[defaultItemIds, taskItemsById]
	);

	useEffect(() => {
		if (defaultItemIds.length === 0) {
			return;
		}

		(["public", "private"] as RankingScope[]).forEach(scope => {
			const pendingRanking = pendingRankingRef.current[scope];
			if (!pendingRanking || isDraggingRef.current[scope]) {
				return;
			}
			applyRankingSnapshot(scope, pendingRanking);
			pendingRankingRef.current[scope] = null;
		});
	}, [applyRankingSnapshot, defaultItemIds.length]);

	const handleRankingDragCancel = (scope: RankingScope) => {
		isDraggingRef.current[scope] = false;
		const pendingRanking = pendingRankingRef.current[scope];
		if (pendingRanking) {
			applyRankingSnapshot(scope, pendingRanking);
			pendingRankingRef.current[scope] = null;
		}
	};

	const handleRankingDragEnd = (scope: RankingScope, event: DragEndEvent) => {
		isDraggingRef.current[scope] = false;
		pendingRankingRef.current[scope] = null;

		const { active, over } = event;
		if (!over || active.id === over.id) {
			return;
		}

		const currentItems = scope === "private" ? privateItems : publicItems;
		const currentRevision = scope === "private" ? privateRankingRevision : publicRankingRevision;
		const oldIndex = currentItems.findIndex(item => item.id === active.id);
		const newIndex = currentItems.findIndex(item => item.id === over.id);
		if (oldIndex < 0 || newIndex < 0) {
			return;
		}

		sendMessage({
			type: "ranking_move",
			scope,
			itemId: String(active.id),
			toIndex: newIndex,
			baseRevision: currentRevision
		});

		const updateItems = (current: LostAtSeaItem[]) => {
			const currentOldIndex = current.findIndex(item => item.id === active.id);
			const currentNewIndex = current.findIndex(item => item.id === over.id);
			if (currentOldIndex < 0 || currentNewIndex < 0) {
				return current;
			}
			return arrayMove(current, currentOldIndex, currentNewIndex).map((item, index) => ({
				...item,
				rank: index + 1
			}));
		};

		if (scope === "private") {
			setPrivateItems(updateItems);
		} else {
			setPublicItems(updateItems);
		}
	};

	useEffect(() => {
		const handleResize = () => {
			setPrivateBoardWidth(current => clampPrivateBoardWidth(current));
			setJitsiHeight(current => clampJitsiHeight(current));
		};

		window.addEventListener("resize", handleResize);
		return () => window.removeEventListener("resize", handleResize);
	}, []);

	useEffect(() => {
		window.localStorage.setItem(PRIVATE_BOARD_WIDTH_STORAGE_KEY, String(privateBoardWidth));
	}, [privateBoardWidth]);

	useEffect(() => {
		window.localStorage.setItem(JITSI_HEIGHT_STORAGE_KEY, String(jitsiHeight));
	}, [jitsiHeight]);

	const handlePrivateBoardResizeStart = (event: React.PointerEvent<HTMLButtonElement>) => {
		event.preventDefault();
		const resizeHandle = event.currentTarget;
		resizeHandle.setPointerCapture(event.pointerId);
		const startX = event.clientX;
		const startWidth = privateBoardWidth;

		const handlePointerMove = (moveEvent: PointerEvent) => {
			setPrivateBoardWidth(clampPrivateBoardWidth(startWidth - (moveEvent.clientX - startX)));
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

	const handlePrivateBoardResizeKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
		if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
			return;
		}

		event.preventDefault();
		const direction = event.key === "ArrowLeft" ? 1 : -1;
		setPrivateBoardWidth(current => clampPrivateBoardWidth(current + direction * 24));
	};

	const handleJitsiResizeStart = (event: React.PointerEvent<HTMLButtonElement>) => {
		event.preventDefault();
		const resizeHandle = event.currentTarget;
		resizeHandle.setPointerCapture(event.pointerId);
		const startY = event.clientY;
		const startHeight = jitsiHeight;

		const handlePointerMove = (moveEvent: PointerEvent) => {
			setJitsiHeight(clampJitsiHeight(startHeight - (moveEvent.clientY - startY)));
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

		setResizeCursor("row-resize");
		document.body.style.cursor = "row-resize";
		document.body.style.userSelect = "none";
		window.addEventListener("pointermove", handlePointerMove);
		window.addEventListener("pointerup", handlePointerUp);
		window.addEventListener("pointercancel", handlePointerUp);
	};

	const handleJitsiResizeKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
		if (event.key !== "ArrowUp" && event.key !== "ArrowDown") {
			return;
		}

		event.preventDefault();
		const direction = event.key === "ArrowUp" ? 1 : -1;
		setJitsiHeight(current => clampJitsiHeight(current + direction * 24));
	};

	useEffect(() => {
		if (isPhaseChangedMessage(lastMessage)) {
			const timer = window.setTimeout(() => {
				setCurrentPhase(lastMessage.phase);
				setTimerEndTime(lastMessage.end_time_ms || 0);
			}, 0);
			return () => window.clearTimeout(timer);
		}

		if (isCountdownChangedMessage(lastMessage)) {
			const timer = window.setTimeout(() => {
				if (lastMessage.current_phase) setCurrentPhase(lastMessage.current_phase);
				setTimerEndTime(lastMessage.timer_end_time_ms ?? lastMessage.end_time_ms ?? 0);
			}, 0);
			return () => window.clearTimeout(timer);
		}

		if (isBoardStateMessage(lastMessage)) {
			let phaseTimer: number | null = null;
			const timerEndTimeMs = lastMessage.timer_end_time_ms;
			if (lastMessage.current_phase || typeof timerEndTimeMs === "number") {
				phaseTimer = window.setTimeout(() => {
					if (lastMessage.current_phase) setCurrentPhase(lastMessage.current_phase);
					if (typeof timerEndTimeMs === "number") setTimerEndTime(timerEndTimeMs);
				}, 0);
			}

			const publicRanking = lastMessage.public_ranking ?? (lastMessage.ranking ? { revision: lastMessage.revision, items: lastMessage.ranking.items } : null);
			const privateRanking = lastMessage.private_ranking;
			const rankings: Array<[RankingScope, RankingSnapshot]> = [];
			if (publicRanking) {
				rankings.push(["public", publicRanking]);
			}
			if (privateRanking) {
				rankings.push(["private", privateRanking]);
			}

			rankings.forEach(([scope, nextRanking]) => {
				if (isDraggingRef.current[scope]) {
					pendingRankingRef.current[scope] = nextRanking;
					return;
				}
				applyRankingSnapshot(scope, nextRanking);
			});
			return () => {
				if (phaseTimer !== null) {
					window.clearTimeout(phaseTimer);
				}
			};
		}

		if (isRankingStateMessage(lastMessage)) {
			const scope = lastMessage.scope === "private" ? "private" : "public";
			const nextRanking = {
				revision: lastMessage.revision,
				items: lastMessage.items
			};
			if (isDraggingRef.current[scope]) {
				pendingRankingRef.current[scope] = nextRanking;
				return;
			}
			applyRankingSnapshot(scope, nextRanking);
		}
	}, [applyRankingSnapshot, lastMessage]);

	if (!isParticipantIdValid) {
		return (
			<main className="grid min-h-screen place-items-center bg-background p-4 text-foreground">
				<section className="grid max-w-md gap-4 rounded-lg border bg-card p-6 text-card-foreground shadow-sm">
					<div className="flex items-center gap-3">
						<AlertCircle className="h-5 w-5 text-destructive" aria-hidden="true" />
						<h1 className="text-lg font-semibold">Participant ID 格式錯誤</h1>
					</div>
					<p className="text-sm leading-6 text-muted-foreground">
						目前 URL 的 <span className="font-mono text-foreground">id</span> 是「{participantId}」，但 Participant ID 必須是整數。請回首頁重新產生會議連結。
					</p>
					<Button type="button" onClick={() => window.location.assign(window.location.pathname)}>
						回到設定首頁
					</Button>
				</section>
			</main>
		);
	}

	if (joinRejectedMessage) {
		return (
			<main className="grid min-h-screen place-items-center bg-background p-4 text-foreground">
				<section className="grid max-w-md gap-4 rounded-lg border bg-card p-6 text-card-foreground shadow-sm">
					<div className="flex items-center gap-3">
						<AlertCircle className="h-5 w-5 text-destructive" aria-hidden="true" />
						<h1 className="text-lg font-semibold">不能進入這個 session</h1>
					</div>
					<p className="text-sm leading-6 text-muted-foreground">{joinRejectedMessage}</p>
					<Button type="button" onClick={() => window.location.assign(window.location.pathname)}>
						回到設定首頁
					</Button>
				</section>
			</main>
		);
	}

	return (
		<main
			className="grid min-h-screen grid-cols-1 gap-4 bg-background p-4 text-foreground xl:h-screen xl:overflow-hidden xl:grid-cols-[minmax(0,1fr)_var(--private-board-width)]"
			style={meetingLayoutStyle}
		>
			{resizeCursor && <div className="fixed inset-0 z-50 touch-none select-none" style={{ cursor: resizeCursor }} />}
			<section className="grid min-w-0 grid-rows-[minmax(0,1fr)_10px_var(--jitsi-height)_auto] gap-y-1 rounded-lg border bg-card p-3 text-card-foreground xl:min-h-0">
				<section className="grid min-h-0 grid-rows-[auto_auto_minmax(0,1fr)] overflow-hidden rounded-lg border p-3" aria-label="Lost at sea ranking task">
					<header className="mb-3 flex shrink-0 flex-wrap items-center justify-between gap-3">
						<div className="flex min-w-0 flex-wrap items-center gap-3">
							<button
								type="button"
								className="text-left text-base font-semibold transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
								aria-expanded={isTaskDetailOpen}
								onClick={() => setIsTaskDetailOpen(current => !current)}
							>
								{taskTitle}
							</button>
						</div>
					</header>
					{isTaskDetailOpen && taskDetail && <p className="mb-3 w-full shrink-0 rounded-lg border bg-background px-3 py-2 text-sm leading-6 text-muted-foreground">{taskDetail}</p>}
					<div className={cn("grid h-full min-h-0 gap-3 overflow-y-auto pr-1 lg:overflow-hidden lg:pr-0", currentPhase === "group" && "lg:grid-cols-2")}>
						{currentPhase === "group" && (
							<LostAtSeaRankingPanel
								title="Public 排序"
								status="協作中"
								items={publicItems}
								sensors={sensors}
								onDragStart={() => {
									isDraggingRef.current.public = true;
								}}
								onDragCancel={() => handleRankingDragCancel("public")}
								onDragEnd={event => handleRankingDragEnd("public", event)}
								onPreviewItem={setPreviewItem}
							/>
						)}
						<LostAtSeaRankingPanel
							title="Private 排序"
							status="個人"
							items={privateItems}
							sensors={sensors}
							onDragStart={() => {
								isDraggingRef.current.private = true;
							}}
							onDragCancel={() => handleRankingDragCancel("private")}
							onDragEnd={event => handleRankingDragEnd("private", event)}
							onPreviewItem={setPreviewItem}
							getRankDelta={item => {
								if (!shouldHighlightRankConflict) {
									return undefined;
								}
								const publicRank = publicRankIndexById.get(item.id);
								return publicRank == null ? undefined : item.rank - publicRank;
							}}
						/>
					</div>
				</section>

				<div className="grid place-items-center">
					<button
						type="button"
						className="h-2 w-24 cursor-row-resize rounded-full bg-border transition-colors hover:bg-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
						aria-label="調整 Jitsi 區塊高度"
						aria-orientation="horizontal"
						aria-valuemin={MIN_JITSI_HEIGHT}
						aria-valuenow={jitsiHeight}
						role="separator"
						onPointerDown={handleJitsiResizeStart}
						onKeyDown={handleJitsiResizeKeyDown}
					/>
				</div>

				<div className="min-h-0 overflow-hidden rounded-lg border bg-muted">
					<JitsiRoom meetingDomain={jitsiBaseUrl} roomName={roomName} displayName={displayName} micMode={micMode} onStatusChange={handleJitsiStatusChange} />
					<div className="hidden">
						<div>WebSocket: {isConnected ? "已連線" : "未連線"}</div>
						<div>Jitsi: {jitsiStatusLabels[jitsiStatus]}</div>
						{micPermission !== "granted" && micPermission !== "unknown" && (
							<button onClick={() => void requestMicPermission()} className="text-left text-primary transition-colors hover:text-primary/80 hover:underline">
								{micPermission === "denied" ? "麥克風已拒絕" : "允許麥克風權限"}
							</button>
						)}
					</div>
					<div className="hidden">
						<div className="flex flex-wrap items-center justify-center gap-2 rounded-md bg-background/85 p-1.5 shadow-sm backdrop-blur">
							<Button
								variant={micMode === "public" ? "destructive" : "outline"}
								className={cn("gap-2", micMode !== "public" && "border-destructive bg-background/90 text-destructive hover:bg-destructive/10 hover:text-destructive")}
								onClick={() => void handleMic("public")}
							>
								<Mic className="h-4 w-4" />
								公開麥克風
								<ShortcutKey label="Space" />
							</Button>
							<Button className="bg-background/90" variant={micMode === "private" ? "default" : "outline"} onClick={() => void handleMic("private")}>
								<Radio className="h-4 w-4" />
								<span className="text-sm">悄悄話</span>
								<ShortcutKey label="W" />
							</Button>
							<Button className="bg-background/90" variant={micMode === "off" ? "default" : "outline"} onClick={() => void handleMic("off")}>
								<MicOff className="h-4 w-4" />
								關閉
							</Button>
						</div>
					</div>
					{hasAudioConnectionError && (
						<AlertCircle className="hidden" aria-label="音訊後端連線失敗" role="img">
							<title>{audioError}</title>
						</AlertCircle>
					)}
				</div>

				<div className="relative flex items-center justify-center pt-2">
					<div className="absolute left-0 flex flex-col items-start gap-0.5 text-xs text-muted-foreground">
						<div>WebSocket: {isConnected ? "已連線" : "未連線"}</div>
						<div>Jitsi: {jitsiStatusLabels[jitsiStatus]}</div>
						{micPermission !== "granted" && micPermission !== "unknown" && (
							<button onClick={() => void requestMicPermission()} className="text-primary hover:underline hover:text-primary/80 transition-colors text-left">
								{micPermission === "denied" ? "麥克風已拒絕 (需至瀏覽器開啟)" : "點擊允許麥克風權限"}
							</button>
						)}
					</div>
					<div className="flex flex-wrap items-center justify-center gap-2">
						<Button
							variant={micMode === "public" ? "destructive" : "outline"}
							className={cn("gap-2", micMode !== "public" && "border-destructive text-destructive hover:bg-destructive/10 hover:text-destructive")}
							onClick={() => void handleMic("public")}
						>
							<Mic className="h-4 w-4" />
							公開發言
							<ShortcutKey label="Space" />
						</Button>
						<Button className="hidden" variant={micMode === "private" ? "default" : "outline"} onClick={() => void handleMic("private")}>
							<Radio className="h-4 w-4" />
							<span className="text-sm">悄悄話</span>
							<ShortcutKey label="W" />
						</Button>
						<Button variant={micMode === "off" ? "default" : "outline"} onClick={() => void handleMic("off")}>
							<MicOff className="h-4 w-4" />
							靜音
						</Button>
					</div>
					{hasAudioConnectionError && (
						<AlertCircle className="absolute right-0 h-4 w-4 text-destructive" aria-label="音訊後端連線失敗" role="img">
							<title>{audioError}</title>
						</AlertCircle>
					)}
				</div>
			</section>

			{previewItem && (
				<div className="fixed inset-0 z-40 grid place-items-center bg-background/80 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" onClick={() => setPreviewItem(null)}>
					<div className="grid w-full max-w-md gap-3 rounded-lg border bg-card p-3 shadow-lg" onClick={event => event.stopPropagation()}>
						<img
							className="aspect-[16/11] w-full rounded-md border object-cover"
							src={taskItemImageSrc(previewItem.id)}
							alt={previewItem.imageTitle}
							onError={event => handleTaskItemImageError(event, previewItem)}
						/>
						<div className="flex items-start justify-between gap-3">
							<div className="min-w-0">
								<div className="truncate text-sm font-semibold">{previewItem.label}</div>
								<div className="text-xs text-muted-foreground">{previewItem.imageTitle}</div>
								{previewItem.description && <p className="mt-2 text-sm leading-6 text-foreground/80">{previewItem.description}</p>}
							</div>
							<Button type="button" variant="outline" onClick={() => setPreviewItem(null)}>
								關閉
							</Button>
						</div>
					</div>
				</div>
			)}

			<aside className="relative min-h-0 min-w-[var(--private-board-width)]">
				<button
					type="button"
					className="absolute -left-3 top-1/2 hidden h-24 w-2 -translate-y-1/2 cursor-col-resize rounded-full bg-border transition-colors hover:bg-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring xl:block"
					aria-label="調整 Private Board 寬度"
					aria-orientation="vertical"
					aria-valuemin={MIN_PRIVATE_BOARD_WIDTH}
					aria-valuenow={privateBoardWidth}
					role="separator"
					onPointerDown={handlePrivateBoardResizeStart}
					onKeyDown={handlePrivateBoardResizeKeyDown}
				/>
				<PrivateBoard
					sessionId={sessionId}
					participantId={participantId}
					lastMessage={lastMessage}
					lastAudioMessage={lastAudioMessage}
					isConnected={isConnected}
					micMode={micMode}
					onMicModeChange={handleMic}
					onSendBoardMessage={sendMessage}
					displayName={displayName}
					currentPhase={currentPhase}
					timerEndTime={timerEndTime}
				/>
			</aside>
			<button
				onClick={toggleFullscreen}
				className="fixed bottom-4 right-4 z-50 grid h-10 w-10 place-items-center rounded-full bg-background/80 text-foreground shadow-sm backdrop-blur transition-colors hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
				title={isFullscreen ? "退出全螢幕" : "全螢幕"}
			>
				{isFullscreen ? <Minimize className="h-5 w-5" /> : <Maximize className="h-5 w-5" />}
			</button>
		</main>
	);
}
