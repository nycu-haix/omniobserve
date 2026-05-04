import type { DragEndEvent } from "@dnd-kit/core";
import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { AlertCircle, GripVertical, Mic, MicOff, Radio } from "lucide-react";
import { type CSSProperties, useCallback, useEffect, useRef, useState } from "react";
import { useAudioStream } from "../hooks/useAudioStream";
import { useParticipantIdentity } from "../hooks/useParticipantIdentity";
import { usePresenceWebSocket } from "../hooks/usePresenceWebSocket";
import { useWebSocket } from "../hooks/useWebSocket";
import { isValidParticipantId } from "../lib/participantDefaults";
import { cn } from "../lib/utils";
import type { MicMode } from "../types";
import { JitsiRoom } from "./JitsiRoom";
import { PrivateBoard } from "./private-board/PrivateBoard";
import { Button } from "./ui/Button";

interface LostAtSeaItem {
	id: string;
	label: string;
	rank: number;
}

type RankingScope = "public" | "private";

interface RankingSnapshot {
	revision: number;
	items: string[];
}

const INITIAL_ITEMS: LostAtSeaItem[] = [
	{ id: "mosquito_net", label: "蚊帳", rank: 1 },
	{ id: "petrol", label: "一罐汽油", rank: 2 },
	{ id: "water_container", label: "裝水容器", rank: 3 },
	{ id: "shaving_mirror", label: "刮鬍鏡／小鏡子", rank: 4 },
	{ id: "sextant", label: "六分儀", rank: 5 },
	{ id: "emergency_rations", label: "緊急糧食", rank: 6 },
	{ id: "sea_chart", label: "海圖", rank: 7 },
	{ id: "floating_cushion", label: "可漂浮的坐墊", rank: 8 },
	{ id: "rope", label: "繩子", rank: 9 },
	{ id: "chocolate_bars", label: "巧克力棒", rank: 10 },
	{ id: "waterproof_sheet", label: "防水塑膠布", rank: 11 },
	{ id: "fishing_rod", label: "釣魚竿", rank: 12 },
	{ id: "shark_repellent", label: "驅鯊劑", rank: 13 },
	{ id: "rum", label: "一瓶蘭姆酒", rank: 14 },
	{ id: "vhf_radio", label: "VHF 無線電", rank: 15 }
];

const jitsiBaseUrl = import.meta.env.VITE_JITSI_BASE_URL || "https://meet.omni.elvismao.com";
const DEFAULT_PRIVATE_BOARD_WIDTH = 560;
const MIN_PRIVATE_BOARD_WIDTH = 360;
const MIN_MEETING_COLUMN_WIDTH = 520;
const PRIVATE_BOARD_WIDTH_STORAGE_KEY = "omni.meeting.privateBoardWidth";
const DEFAULT_JITSI_HEIGHT = 390;
const MIN_JITSI_HEIGHT = 240;
const MIN_RANKING_HEIGHT = 220;
const JITSI_HEIGHT_STORAGE_KEY = "omni.meeting.jitsiHeight";
const LOST_AT_SEA_TASK_DETAIL =
	"你和你的團隊被困在南太平洋的一艘橡皮救生筏上，具體位置不詳，周圍看不到陸地。團隊無法確定方向，也沒有足夠能力自行划回岸邊，因此主要策略是留在救生筏上、保存體力並等待救援。請根據物品對生存的重要程度進行排序，將最重要的物品排在第 1 名，最不重要的物品排在第 15 名。每個物品需附上簡短理由。";

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

const ITEM_LABELS = INITIAL_ITEMS.reduce<Record<string, string>>((labels, item) => {
	labels[item.id] = item.label;
	return labels;
}, {});
const DEFAULT_ITEM_IDS = INITIAL_ITEMS.map(item => item.id);

function normalizeRankingItemIds(itemIds: string[]): string[] {
	const validIds = new Set(DEFAULT_ITEM_IDS);
	const rankedValidIds = itemIds.filter((id, index) => validIds.has(id) && itemIds.indexOf(id) === index);
	const missingIds = DEFAULT_ITEM_IDS.filter(id => !rankedValidIds.includes(id));

	return [...rankedValidIds, ...missingIds];
}

function createRankedItems(itemIds: string[]): LostAtSeaItem[] {
	return normalizeRankingItemIds(itemIds).map((id, index) => ({
		id,
		label: ITEM_LABELS[id] ?? id,
		rank: index + 1
	}));
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

function SortableLostAtSeaItem({ item }: { item: LostAtSeaItem }) {
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
		>
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
	onDragEnd
}: {
	title: string;
	status: string;
	items: LostAtSeaItem[];
	sensors: ReturnType<typeof useSensors>;
	onDragStart: () => void;
	onDragCancel: () => void;
	onDragEnd: (event: DragEndEvent) => void;
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
							<SortableLostAtSeaItem key={item.id} item={item} />
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
	const [publicItems, setPublicItems] = useState(INITIAL_ITEMS);
	const [privateItems, setPrivateItems] = useState(INITIAL_ITEMS);
	const [publicRankingRevision, setPublicRankingRevision] = useState(0);
	const [privateRankingRevision, setPrivateRankingRevision] = useState(0);
	const [isTaskDetailOpen, setIsTaskDetailOpen] = useState(false);
	const [privateBoardWidth, setPrivateBoardWidth] = useState(() => {
		const storedWidth = Number(window.localStorage.getItem(PRIVATE_BOARD_WIDTH_STORAGE_KEY));
		return clampPrivateBoardWidth(Number.isFinite(storedWidth) ? storedWidth : DEFAULT_PRIVATE_BOARD_WIDTH);
	});
	const [jitsiHeight, setJitsiHeight] = useState(() => {
		const storedHeight = Number(window.localStorage.getItem(JITSI_HEIGHT_STORAGE_KEY));
		return clampJitsiHeight(Number.isFinite(storedHeight) ? storedHeight : DEFAULT_JITSI_HEIGHT);
	});
	const isDraggingRef = useRef<Record<RankingScope, boolean>>({ public: false, private: false });
	const pendingRankingRef = useRef<Record<RankingScope, RankingSnapshot | null>>({ public: null, private: null });
	const { participantId, displayName, roomName } = useParticipantIdentity();
	const isParticipantIdValid = isValidParticipantId(participantId);
	const connectionParticipantId = isParticipantIdValid ? participantId : undefined;
	const sessionId = roomName;
	const { sendMessage, lastMessage, isConnected } = useWebSocket(sessionId, connectionParticipantId);
	usePresenceWebSocket(sessionId, connectionParticipantId);
	const { startAudioStream, stopAudioStream, lastAudioMessage, audioError } = useAudioStream(sessionId, connectionParticipantId, displayName);
	const sensors = useSensors(useSensor(PointerSensor), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
	const hasAudioConnectionError = micMode !== "off" && !!audioError;
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

	const applyRankingSnapshot = useCallback((scope: RankingScope, snapshot: RankingSnapshot) => {
		if (scope === "private") {
			setPrivateRankingRevision(snapshot.revision);
			setPrivateItems(createRankedItems(snapshot.items));
			return;
		}

		setPublicRankingRevision(snapshot.revision);
		setPublicItems(createRankedItems(snapshot.items));
	}, []);

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
		const startX = event.clientX;
		const startWidth = privateBoardWidth;

		const handlePointerMove = (moveEvent: PointerEvent) => {
			setPrivateBoardWidth(clampPrivateBoardWidth(startWidth - (moveEvent.clientX - startX)));
		};

		const handlePointerUp = () => {
			document.body.style.cursor = "";
			document.body.style.userSelect = "";
			window.removeEventListener("pointermove", handlePointerMove);
			window.removeEventListener("pointerup", handlePointerUp);
			window.removeEventListener("pointercancel", handlePointerUp);
		};

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
		const startY = event.clientY;
		const startHeight = jitsiHeight;

		const handlePointerMove = (moveEvent: PointerEvent) => {
			setJitsiHeight(clampJitsiHeight(startHeight + moveEvent.clientY - startY));
		};

		const handlePointerUp = () => {
			document.body.style.cursor = "";
			document.body.style.userSelect = "";
			window.removeEventListener("pointermove", handlePointerMove);
			window.removeEventListener("pointerup", handlePointerUp);
			window.removeEventListener("pointercancel", handlePointerUp);
		};

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
		const direction = event.key === "ArrowDown" ? 1 : -1;
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
			<section className="grid min-w-0 grid-rows-[var(--jitsi-height)_10px_minmax(0,1fr)_auto] gap-y-1 rounded-lg border bg-card p-3 text-card-foreground xl:min-h-0">
				<div className="min-h-0 overflow-hidden rounded-lg border bg-muted">
					<JitsiRoom meetingDomain={jitsiBaseUrl} roomName={roomName} displayName={displayName} micMode={micMode} />
				</div>
				<div className="grid place-items-center">
					<button
						type="button"
						className="h-2 w-24 cursor-row-resize rounded-full bg-border transition-colors hover:bg-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
						aria-label="調整 Jitsi 視訊高度"
						aria-orientation="horizontal"
						aria-valuemin={MIN_JITSI_HEIGHT}
						aria-valuenow={jitsiHeight}
						role="separator"
						onPointerDown={handleJitsiResizeStart}
						onKeyDown={handleJitsiResizeKeyDown}
					/>
				</div>

				<section className="grid min-h-0 grid-rows-[auto_auto_minmax(0,1fr)] overflow-hidden rounded-lg border p-3" aria-label="Lost at sea ranking task">
					<header className="mb-3 flex shrink-0 flex-wrap items-center justify-between gap-3">
						<div className="flex min-w-0 flex-wrap items-center gap-3">
							<button
								type="button"
								className="text-left text-base font-semibold transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
								aria-expanded={isTaskDetailOpen}
								onClick={() => setIsTaskDetailOpen(current => !current)}
							>
								海上求生排序
							</button>
						</div>
					</header>
					{isTaskDetailOpen && <p className="mb-3 w-full shrink-0 rounded-lg border bg-background px-3 py-2 text-sm leading-6 text-muted-foreground">{LOST_AT_SEA_TASK_DETAIL}</p>}
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
						/>
					</div>
				</section>

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
						<Button variant={micMode === "public" ? "default" : "outline"} onClick={() => void handleMic("public")}>
							<Mic className="h-4 w-4" />
							公開麥克風
						</Button>
						<Button variant={micMode === "private" ? "default" : "outline"} onClick={() => void handleMic("private")}>
							<Radio className="h-4 w-4" />
							私人錄音
						</Button>
						<Button variant="secondary" onClick={() => void handleMic("off")}>
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
				<PrivateBoard sessionId={sessionId} participantId={participantId} lastMessage={lastMessage} lastAudioMessage={lastAudioMessage} isConnected={isConnected} />
			</aside>
		</main>
	);
}
