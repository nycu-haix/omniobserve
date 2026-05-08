import type { DragEndEvent } from "@dnd-kit/core";
import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { AlertCircle, GripVertical, Mic, MicOff, Radio } from "lucide-react";
import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAudioStream } from "../hooks/useAudioStream";
import { useParticipantIdentity } from "../hooks/useParticipantIdentity";
import { useWebSocket } from "../hooks/useWebSocket";
import { isValidParticipantId } from "../lib/participantDefaults";
import { cn } from "../lib/utils";
import { fetchTaskConfig, type TaskConfigItem } from "../services/api";
import type { MicMode } from "../types";
import { JitsiRoom } from "./JitsiRoom";
import { PrivateBoard } from "./private-board/PrivateBoard";
import { Button } from "./ui/Button";

interface LostAtSeaItem {
	id: string;
	label: string;
	rank: number;
	imageTitle: string;
	imageBg: string;
	imageFg: string;
	imageMark: string;
}

type RankingScope = "public" | "private";

interface RankingSnapshot {
	revision: number;
	items: string[];
}

const jitsiBaseUrl = import.meta.env.VITE_JITSI_BASE_URL || "https://meet.omni.elvismao.com";
const DEFAULT_PRIVATE_BOARD_WIDTH = 560;
const MIN_PRIVATE_BOARD_WIDTH = 360;
const MIN_MEETING_COLUMN_WIDTH = 520;
const PRIVATE_BOARD_WIDTH_STORAGE_KEY = "omni.meeting.privateBoardWidth";
const DEFAULT_JITSI_HEIGHT = 120;
const MIN_JITSI_HEIGHT = 96;
const MIN_RANKING_HEIGHT = 220;
const JITSI_HEIGHT_STORAGE_KEY = "omni.meeting.jitsiHeight";
function createInitialItems(items: TaskConfigItem[]): LostAtSeaItem[] {
	return items.map((item, index) => createLostAtSeaItem(item, index));
}

function createLostAtSeaItem(item: TaskConfigItem, index: number): LostAtSeaItem {
	return {
		id: item.id,
		label: item.label,
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

function SortableLostAtSeaItem({ item, onPreview }: { item: LostAtSeaItem; onPreview: (item: LostAtSeaItem) => void }) {
	const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
		id: item.id
	});
	const verticalTransform = transform ? { ...transform, x: 0 } : transform;

	return (
		<div
			ref={setNodeRef}
			className={cn("flex min-h-10 cursor-grab select-none items-center gap-3 rounded-lg border bg-background px-3 py-2", isDragging && "opacity-50")}
			style={{
				transform: CSS.Transform.toString(verticalTransform),
				transition
			}}
			{...attributes}
			{...listeners}
			onDoubleClick={() => onPreview(item)}
		>
			<img
				className="h-9 w-12 shrink-0 rounded-md border object-cover"
				src={taskItemImageSrc(item.id)}
				alt={item.imageTitle}
				draggable={false}
				onError={event => handleTaskItemImageError(event, item)}
			/>
			<span className="grid h-6 w-6 place-items-center rounded-full bg-muted text-xs font-semibold text-primary">{item.rank}</span>
			<span className="min-w-0 flex-1">{item.label}</span>
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
	onPreviewItem
}: {
	title: string;
	status: string;
	items: LostAtSeaItem[];
	sensors: ReturnType<typeof useSensors>;
	onDragStart: () => void;
	onDragCancel: () => void;
	onDragEnd: (event: DragEndEvent) => void;
	onPreviewItem: (item: LostAtSeaItem) => void;
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
							<SortableLostAtSeaItem key={item.id} item={item} onPreview={onPreviewItem} />
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
	const [isTaskDetailOpen, setIsTaskDetailOpen] = useState(false);
	const [previewItem, setPreviewItem] = useState<LostAtSeaItem | null>(null);
	const [privateBoardWidth, setPrivateBoardWidth] = useState(() => {
		const storedWidth = Number(window.localStorage.getItem(PRIVATE_BOARD_WIDTH_STORAGE_KEY));
		return clampPrivateBoardWidth(Number.isFinite(storedWidth) ? storedWidth : DEFAULT_PRIVATE_BOARD_WIDTH);
	});
	const [jitsiHeight, setJitsiHeight] = useState(() => {
		const storedHeight = Number(window.localStorage.getItem(JITSI_HEIGHT_STORAGE_KEY));
		return clampJitsiHeight(Number.isFinite(storedHeight) ? Math.min(storedHeight, DEFAULT_JITSI_HEIGHT) : DEFAULT_JITSI_HEIGHT);
	});
	const [resizeCursor, setResizeCursor] = useState<"col-resize" | "row-resize" | null>(null);
	const isDraggingRef = useRef<Record<RankingScope, boolean>>({ public: false, private: false });
	const pendingRankingRef = useRef<Record<RankingScope, RankingSnapshot | null>>({ public: null, private: null });
	const { participantId, displayName, roomName } = useParticipantIdentity();
	const isParticipantIdValid = isValidParticipantId(participantId);
	const connectionParticipantId = isParticipantIdValid ? participantId : undefined;
	const sessionId = roomName;
	const { sendMessage, lastMessage, isConnected } = useWebSocket(sessionId, connectionParticipantId);
	const { startAudioStream, stopAudioStream, lastAudioMessage, audioError } = useAudioStream(sessionId, connectionParticipantId, displayName);
	const sensors = useSensors(useSensor(PointerSensor), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
	const hasAudioConnectionError = micMode !== "off" && !!audioError;
	const taskItemsById = useMemo(() => Object.fromEntries(taskItems.map(item => [item.id, item])), [taskItems]);
	const defaultItemIds = useMemo(() => taskItems.map(item => item.id), [taskItems]);
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

	const handleMic = async (mode: MicMode) => {
		const shouldRetryCurrentMode = mode !== "off" && micMode === mode && hasAudioConnectionError;
		const nextMode = shouldRetryCurrentMode ? mode : mode === "off" ? "off" : micMode === mode ? "off" : mode;

		setMicMode(nextMode);

		if (nextMode === "off") {
			stopAudioStream();
			return;
		}

		await startAudioStream(nextMode);
	};

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
		if (isBoardStateMessage(lastMessage)) {
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
			return;
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
					<div className="grid h-full min-h-0 gap-3 overflow-y-auto pr-1 lg:grid-cols-2 lg:overflow-hidden lg:pr-0">
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
					<JitsiRoom meetingDomain={jitsiBaseUrl} roomName={roomName} displayName={displayName} micMode={micMode} />
					<div className="hidden">
						<div>WebSocket: {isConnected ? "已連線" : "未連線"}</div>
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
								className={cn(micMode !== "public" && "border-destructive bg-background/90 text-destructive hover:bg-destructive/10 hover:text-destructive")}
								onClick={() => void handleMic("public")}
							>
								<Mic className="h-4 w-4" />
								公開麥克風
							</Button>
							<Button className="bg-background/90" variant={micMode === "private" ? "default" : "outline"} onClick={() => void handleMic("private")}>
								<Radio className="h-4 w-4" />
								<span className="text-sm">悄悄話</span>
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
						{micPermission !== "granted" && micPermission !== "unknown" && (
							<button onClick={() => void requestMicPermission()} className="text-primary hover:underline hover:text-primary/80 transition-colors text-left">
								{micPermission === "denied" ? "麥克風已拒絕 (需至瀏覽器開啟)" : "點擊允許麥克風權限"}
							</button>
						)}
					</div>
					<div className="flex flex-wrap items-center justify-center gap-2">
						<Button
							variant={micMode === "public" ? "destructive" : "outline"}
							className={cn(micMode !== "public" && "border-destructive text-destructive hover:bg-destructive/10 hover:text-destructive")}
							onClick={() => void handleMic("public")}
						>
							<Mic className="h-4 w-4" />
							公開發言
						</Button>
						<Button className="hidden" variant={micMode === "private" ? "default" : "outline"} onClick={() => void handleMic("private")}>
							<Radio className="h-4 w-4" />
							<span className="text-sm">悄悄話</span>
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
						<div className="flex items-center justify-between gap-3">
							<div className="min-w-0">
								<div className="truncate text-sm font-semibold">{previewItem.label}</div>
								<div className="text-xs text-muted-foreground">{previewItem.imageTitle}</div>
							</div>
							<Button type="button" variant="outline" onClick={() => setPreviewItem(null)}>
								關閉
							</Button>
						</div>
					</div>
				</div>
			)}

			<aside className="relative min-h-0">
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
				/>
			</aside>
		</main>
	);
}
