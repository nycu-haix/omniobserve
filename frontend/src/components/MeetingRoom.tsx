import type { DragEndEvent } from "@dnd-kit/core";
import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { AlertCircle, ChevronDown, ChevronLeft, ChevronUp, Columns2, GripVertical, Info, Keyboard, Lock, Maximize, Mic, Minimize, Radio, Rows2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from "react";
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
type TaskPaneContent = "task-instructions" | "private-ranking" | "public-ranking";
type TaskSplitDirection = "horizontal" | "vertical";

interface TaskPaneLeaf {
	type: "leaf";
	id: string;
	content: TaskPaneContent;
}

interface TaskPaneSplit {
	type: "split";
	id: string;
	direction: TaskSplitDirection;
	ratio: number;
	first: TaskPaneNode;
	second: TaskPaneNode;
}

type TaskPaneNode = TaskPaneLeaf | TaskPaneSplit;

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
const MIN_MEETING_COLUMN_WIDTH = 720;
const PRIVATE_BOARD_WIDTH_STORAGE_KEY = "omni.meeting.privateBoardWidth";
const DEFAULT_JITSI_HEIGHT = 220;
const MIN_JITSI_HEIGHT = 220;
const MIN_RANKING_HEIGHT = 220;
const JITSI_HEIGHT_STORAGE_KEY = "omni.meeting.jitsiHeight";
const PRIVATE_PUBLIC_RANK_CONFLICT_THRESHOLD = 3;
const MAX_TASK_PANES = 3;
const MIN_TASK_PANE_RATIO = 24;
const TASK_PANE_CONTENT_LABELS: Record<TaskPaneContent, string> = {
	"task-instructions": "Task Instructions",
	"private-ranking": "Private Ranking",
	"public-ranking": "Public Ranking"
};
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

function createTaskPaneLeaf(content: TaskPaneContent): TaskPaneLeaf {
	return {
		type: "leaf",
		id: `task-pane-${Date.now()}-${Math.random().toString(36).slice(2)}`,
		content
	};
}

function createDefaultTaskPaneLayout(phase: SessionPhase): TaskPaneNode {
	if (phase === "group") {
		return {
			type: "split",
			id: `task-split-${Date.now()}-${Math.random().toString(36).slice(2)}`,
			direction: "horizontal",
			ratio: 50,
			first: createTaskPaneLeaf("public-ranking"),
			second: createTaskPaneLeaf("private-ranking")
		};
	}

	return createTaskPaneLeaf("private-ranking");
}

function countTaskPaneLeaves(node: TaskPaneNode): number {
	return node.type === "leaf" ? 1 : countTaskPaneLeaves(node.first) + countTaskPaneLeaves(node.second);
}

function getFirstTaskPaneLeafId(node: TaskPaneNode): string {
	return node.type === "leaf" ? node.id : getFirstTaskPaneLeafId(node.first);
}

function hasTaskPaneContent(node: TaskPaneNode, content: TaskPaneContent): boolean {
	return node.type === "leaf" ? node.content === content : hasTaskPaneContent(node.first, content) || hasTaskPaneContent(node.second, content);
}

function chooseNewTaskPaneContent(node: TaskPaneNode, phase: SessionPhase): TaskPaneContent {
	const preferredContents: TaskPaneContent[] = phase === "group" ? ["public-ranking", "private-ranking", "task-instructions"] : ["private-ranking", "task-instructions", "public-ranking"];
	return preferredContents.find(content => !hasTaskPaneContent(node, content)) ?? "task-instructions";
}

function updateTaskPaneNode(node: TaskPaneNode, paneId: string, updater: (leaf: TaskPaneLeaf) => TaskPaneNode): TaskPaneNode {
	if (node.type === "leaf") {
		return node.id === paneId ? updater(node) : node;
	}

	return {
		...node,
		first: updateTaskPaneNode(node.first, paneId, updater),
		second: updateTaskPaneNode(node.second, paneId, updater)
	};
}

function updateTaskPaneSplit(node: TaskPaneNode, splitId: string, ratio: number): TaskPaneNode {
	if (node.type === "leaf") {
		return node;
	}

	if (node.id === splitId) {
		return {
			...node,
			ratio: Math.min(100 - MIN_TASK_PANE_RATIO, Math.max(MIN_TASK_PANE_RATIO, ratio))
		};
	}

	return {
		...node,
		first: updateTaskPaneSplit(node.first, splitId, ratio),
		second: updateTaskPaneSplit(node.second, splitId, ratio)
	};
}

function removeTaskPaneNode(node: TaskPaneNode, paneId: string): TaskPaneNode | null {
	if (node.type === "leaf") {
		return node.id === paneId ? null : node;
	}

	const nextFirst = removeTaskPaneNode(node.first, paneId);
	const nextSecond = removeTaskPaneNode(node.second, paneId);

	if (!nextFirst) {
		return nextSecond;
	}

	if (!nextSecond) {
		return nextFirst;
	}

	return {
		...node,
		first: nextFirst,
		second: nextSecond
	};
}

function getTaskPaneContentAvailability(content: TaskPaneContent, phase: SessionPhase): boolean {
	return content !== "public-ranking" || phase === "group";
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
	const rankDeltaAmount = typeof rankDelta === "number" ? Math.abs(rankDelta) : 0;
	const hasRankDelta = rankDeltaAmount > 0;
	const isRankConflict = rankDeltaAmount > PRIVATE_PUBLIC_RANK_CONFLICT_THRESHOLD;
	const rankDeltaDirection = typeof rankDelta === "number" && rankDelta < 0 ? "up" : "down";

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
			title={hasRankDelta ? `與 Public 排序差 ${rankDeltaAmount} 位` : undefined}
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
			{hasRankDelta && (
				<span
					className={cn(
						"inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-xs font-semibold",
						isRankConflict && rankDeltaDirection === "up" && "text-emerald-700",
						isRankConflict && rankDeltaDirection === "down" && "text-rose-700",
						!isRankConflict && "text-muted-foreground/60"
					)}
					aria-label={`與 Public 排序差 ${rankDeltaAmount} 位，Private 排序${rankDeltaDirection === "up" ? "較前" : "較後"}`}
				>
					<span
						className={cn(
							"h-0 w-0 border-x-[5px] border-x-transparent",
							rankDeltaDirection === "up" && isRankConflict && "border-b-[8px] border-b-emerald-600",
							rankDeltaDirection === "down" && isRankConflict && "border-t-[8px] border-t-rose-600",
							rankDeltaDirection === "up" && !isRankConflict && "border-b-[8px] border-b-muted-foreground/40",
							rankDeltaDirection === "down" && !isRankConflict && "border-t-[8px] border-t-muted-foreground/40"
						)}
						aria-hidden="true"
					/>
					{rankDeltaAmount}
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
	getRankDelta,
	scrollContainerRef
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
	scrollContainerRef?: RefObject<HTMLDivElement | null>;
}) {
	return (
		<section className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden" aria-label={title}>
			<div className="sr-only">{status}</div>
			<DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={onDragStart} onDragCancel={onDragCancel} onDragEnd={onDragEnd}>
				<SortableContext items={items.map(item => item.id)} strategy={verticalListSortingStrategy}>
					<div ref={scrollContainerRef} className="grid min-h-0 flex-1 content-start gap-2 overflow-y-auto pr-1">
						{items.map(item => (
							<SortableLostAtSeaItem key={item.id} item={item} rankDelta={getRankDelta?.(item)} onPreview={onPreviewItem} />
						))}
					</div>
				</SortableContext>
			</DndContext>
		</section>
	);
}

function TaskWorkspace({
	currentPhase,
	taskTitle,
	taskDetail,
	renderPrivateRanking,
	renderPublicRanking
}: {
	currentPhase: SessionPhase;
	taskTitle: string;
	taskDetail: string;
	renderPrivateRanking: () => React.ReactNode;
	renderPublicRanking: () => React.ReactNode;
}) {
	const [layout, setLayout] = useState<TaskPaneNode>(() => createDefaultTaskPaneLayout(currentPhase));
	const [hasUserCustomizedLayout, setHasUserCustomizedLayout] = useState(false);
	const [isNarrowLayout, setIsNarrowLayout] = useState(() => window.matchMedia("(max-width: 767px)").matches);
	const defaultLayout = useMemo(() => createDefaultTaskPaneLayout(currentPhase), [currentPhase]);
	const visibleLayout = hasUserCustomizedLayout ? layout : defaultLayout;
	const paneCount = countTaskPaneLeaves(visibleLayout);

	useEffect(() => {
		const mediaQuery = window.matchMedia("(max-width: 767px)");
		const handleChange = () => setIsNarrowLayout(mediaQuery.matches);
		handleChange();
		mediaQuery.addEventListener("change", handleChange);
		return () => mediaQuery.removeEventListener("change", handleChange);
	}, []);

	const markCustomized = () => setHasUserCustomizedLayout(true);

	const splitPane = (paneId: string, direction: TaskSplitDirection) => {
		if (paneCount >= MAX_TASK_PANES) {
			return;
		}

		markCustomized();
		setLayout(
			updateTaskPaneNode(visibleLayout, paneId, leaf => ({
				type: "split",
				id: `task-split-${Date.now()}-${Math.random().toString(36).slice(2)}`,
				direction,
				ratio: 50,
				first: leaf,
				second: createTaskPaneLeaf(chooseNewTaskPaneContent(visibleLayout, currentPhase))
			}))
		);
	};

	const changePaneContent = (paneId: string, content: TaskPaneContent) => {
		markCustomized();
		setLayout(
			updateTaskPaneNode(visibleLayout, paneId, leaf => ({
				...leaf,
				content
			}))
		);
	};

	const resizeSplit = (splitId: string, ratio: number) => {
		markCustomized();
		setLayout(updateTaskPaneSplit(visibleLayout, splitId, ratio));
	};

	const closePane = (paneId: string) => {
		if (paneCount <= 1) {
			return;
		}

		markCustomized();
		const nextLayout = removeTaskPaneNode(visibleLayout, paneId);
		if (!nextLayout) {
			return;
		}
		setLayout(nextLayout);
	};

	const showTaskInstructions = () => {
		markCustomized();
		if (hasTaskPaneContent(visibleLayout, "task-instructions")) {
			return;
		}

		if (paneCount < MAX_TASK_PANES) {
			const paneId = getFirstTaskPaneLeafId(visibleLayout);
			setLayout(
				updateTaskPaneNode(visibleLayout, paneId, leaf => ({
					type: "split",
					id: `task-split-${Date.now()}-${Math.random().toString(36).slice(2)}`,
					direction: "horizontal",
					ratio: 60,
					first: leaf,
					second: createTaskPaneLeaf("task-instructions")
				}))
			);
			return;
		}

		const paneId = getFirstTaskPaneLeafId(visibleLayout);
		changePaneContent(paneId, "task-instructions");
	};

	const renderPaneContent = (content: TaskPaneContent) => {
		if (!getTaskPaneContentAvailability(content, currentPhase)) {
			return (
				<div className="grid h-full min-h-0 place-items-center bg-muted/30 p-4 text-center">
					<div className="grid max-w-xs gap-2 text-muted-foreground">
						<Lock className="mx-auto h-5 w-5" aria-hidden="true" />
						<div className="text-sm font-medium text-foreground">{TASK_PANE_CONTENT_LABELS[content]}</div>
						<p className="text-sm leading-6">此區塊目前階段尚未開放</p>
					</div>
				</div>
			);
		}

		if (content === "private-ranking") {
			return renderPrivateRanking();
		}

		if (content === "public-ranking") {
			return renderPublicRanking();
		}

		return (
			<section className="flex h-full min-h-0 flex-col overflow-hidden" aria-label="Task Instructions">
				<div className="min-h-0 flex-1 overflow-auto rounded-md bg-muted/40 p-3 text-sm leading-6 text-foreground/80">
					{taskDetail ? <p className="whitespace-pre-wrap">{taskDetail}</p> : <p className="text-muted-foreground">尚無任務說明</p>}
				</div>
			</section>
		);
	};

	return (
		<section className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden rounded-lg border p-3" aria-label="Task workspace">
			<header className="mb-3 flex shrink-0 flex-wrap items-center justify-between gap-3">
				<div className="grid min-w-0 gap-1">
					<h2 className="truncate text-base font-semibold">{taskTitle}</h2>
				</div>
				<Button type="button" variant="outline" size="sm" className="shrink-0 gap-1.5" onClick={showTaskInstructions}>
					<Info className="h-4 w-4" />
					任務說明
				</Button>
			</header>
			<div className="min-h-0 overflow-hidden">
				<TaskPaneRenderer
					node={visibleLayout}
					currentPhase={currentPhase}
					paneCount={paneCount}
					isNarrowLayout={isNarrowLayout}
					onSplitPane={splitPane}
					onClosePane={closePane}
					onChangePaneContent={changePaneContent}
					onResizeSplit={resizeSplit}
					renderPaneContent={renderPaneContent}
				/>
			</div>
		</section>
	);
}

function TaskPaneRenderer({
	node,
	currentPhase,
	paneCount,
	isNarrowLayout,
	onSplitPane,
	onClosePane,
	onChangePaneContent,
	onResizeSplit,
	renderPaneContent
}: {
	node: TaskPaneNode;
	currentPhase: SessionPhase;
	paneCount: number;
	isNarrowLayout: boolean;
	onSplitPane: (paneId: string, direction: TaskSplitDirection) => void;
	onClosePane: (paneId: string) => void;
	onChangePaneContent: (paneId: string, content: TaskPaneContent) => void;
	onResizeSplit: (splitId: string, ratio: number) => void;
	renderPaneContent: (content: TaskPaneContent) => React.ReactNode;
}) {
	if (node.type === "leaf") {
		return (
			<TaskPane
				pane={node}
				currentPhase={currentPhase}
				canSplit={paneCount < MAX_TASK_PANES}
				canClose={paneCount > 1}
				onSplit={direction => onSplitPane(node.id, direction)}
				onClose={() => onClosePane(node.id)}
				onChangeContent={content => onChangePaneContent(node.id, content)}
			>
				{renderPaneContent(node.content)}
			</TaskPane>
		);
	}

	const effectiveDirection = isNarrowLayout ? "vertical" : node.direction;
	const gridStyle =
		effectiveDirection === "horizontal"
			? ({ gridTemplateColumns: `minmax(280px, ${node.ratio}fr) 1rem minmax(280px, ${100 - node.ratio}fr)` } as CSSProperties)
			: ({ gridTemplateRows: `minmax(180px, ${node.ratio}fr) 1rem minmax(180px, ${100 - node.ratio}fr)` } as CSSProperties);

	return (
		<div className="grid h-full min-h-0 min-w-0 gap-0" style={gridStyle}>
			<TaskPaneRenderer
				node={node.first}
				currentPhase={currentPhase}
				paneCount={paneCount}
				isNarrowLayout={isNarrowLayout}
				onSplitPane={onSplitPane}
				onClosePane={onClosePane}
				onChangePaneContent={onChangePaneContent}
				onResizeSplit={onResizeSplit}
				renderPaneContent={renderPaneContent}
			/>
			<PaneSeparator split={node} direction={effectiveDirection} onResize={onResizeSplit} />
			<TaskPaneRenderer
				node={node.second}
				currentPhase={currentPhase}
				paneCount={paneCount}
				isNarrowLayout={isNarrowLayout}
				onSplitPane={onSplitPane}
				onClosePane={onClosePane}
				onChangePaneContent={onChangePaneContent}
				onResizeSplit={onResizeSplit}
				renderPaneContent={renderPaneContent}
			/>
		</div>
	);
}

function TaskPane({
	pane,
	currentPhase,
	canSplit,
	canClose,
	onSplit,
	onClose,
	onChangeContent,
	children
}: {
	pane: TaskPaneLeaf;
	currentPhase: SessionPhase;
	canSplit: boolean;
	canClose: boolean;
	onSplit: (direction: TaskSplitDirection) => void;
	onClose: () => void;
	onChangeContent: (content: TaskPaneContent) => void;
	children: React.ReactNode;
}) {
	const isLocked = !getTaskPaneContentAvailability(pane.content, currentPhase);

	return (
		<section className="grid h-full min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden rounded-lg border bg-card" aria-label={TASK_PANE_CONTENT_LABELS[pane.content]}>
			<header className="flex min-h-11 shrink-0 items-center justify-between gap-2 border-b bg-muted/35 px-2 py-1.5">
				<div className="flex min-w-0 items-center gap-2">
					{canClose && (
						<Button
							type="button"
							variant="ghost"
							size="icon"
							className="h-8 w-8 shrink-0"
							title="Close pane"
							aria-label={`Close ${TASK_PANE_CONTENT_LABELS[pane.content]} pane`}
							onClick={event => {
								event.stopPropagation();
								onClose();
							}}
						>
							<X className="h-4 w-4" />
						</Button>
					)}
					<select
						className="h-8 min-w-0 rounded-md border bg-background px-2 text-sm font-medium outline-none focus:ring-1 focus:ring-ring"
						value={pane.content}
						aria-label="選擇 pane 內容"
						onChange={event => onChangeContent(event.target.value as TaskPaneContent)}
						onPointerDown={event => event.stopPropagation()}
					>
						{(Object.keys(TASK_PANE_CONTENT_LABELS) as TaskPaneContent[]).map(content => (
							<option key={content} value={content}>
								{TASK_PANE_CONTENT_LABELS[content]}
							</option>
						))}
					</select>
					{isLocked && <Lock className="h-4 w-4 shrink-0 text-muted-foreground" aria-label="目前階段鎖定" />}
				</div>
				<div className="flex shrink-0 items-center gap-1">
					<Button type="button" variant="ghost" size="icon" className="h-8 w-8" title="Split Right" aria-label="Split Right" disabled={!canSplit} onClick={() => onSplit("horizontal")}>
						<Columns2 className="h-4 w-4" />
					</Button>
					<Button type="button" variant="ghost" size="icon" className="h-8 w-8" title="Split Down" aria-label="Split Down" disabled={!canSplit} onClick={() => onSplit("vertical")}>
						<Rows2 className="h-4 w-4" />
					</Button>
				</div>
			</header>
			<div className="min-h-0 overflow-hidden p-2">{children}</div>
		</section>
	);
}

function PaneSeparator({ split, direction, onResize }: { split: TaskPaneSplit; direction: TaskSplitDirection; onResize: (splitId: string, ratio: number) => void }) {
	const handleResizeStart = (event: React.PointerEvent<HTMLButtonElement>) => {
		event.preventDefault();
		const separator = event.currentTarget;
		const container = separator.parentElement;
		if (!container) {
			return;
		}

		separator.setPointerCapture(event.pointerId);
		const containerRect = container.getBoundingClientRect();

		const handlePointerMove = (moveEvent: PointerEvent) => {
			const nextRatio = direction === "horizontal" ? ((moveEvent.clientX - containerRect.left) / containerRect.width) * 100 : ((moveEvent.clientY - containerRect.top) / containerRect.height) * 100;
			onResize(split.id, nextRatio);
		};

		const handlePointerUp = () => {
			if (separator.hasPointerCapture(event.pointerId)) {
				separator.releasePointerCapture(event.pointerId);
			}
			document.body.style.cursor = "";
			document.body.style.userSelect = "";
			window.removeEventListener("pointermove", handlePointerMove);
			window.removeEventListener("pointerup", handlePointerUp);
			window.removeEventListener("pointercancel", handlePointerUp);
		};

		document.body.style.cursor = direction === "horizontal" ? "col-resize" : "row-resize";
		document.body.style.userSelect = "none";
		window.addEventListener("pointermove", handlePointerMove);
		window.addEventListener("pointerup", handlePointerUp);
		window.addEventListener("pointercancel", handlePointerUp);
	};

	const handleResizeKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
		const isHorizontalKey = event.key === "ArrowLeft" || event.key === "ArrowRight";
		const isVerticalKey = event.key === "ArrowUp" || event.key === "ArrowDown";
		if ((direction === "horizontal" && !isHorizontalKey) || (direction === "vertical" && !isVerticalKey)) {
			return;
		}

		event.preventDefault();
		const directionMultiplier = event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 1;
		onResize(split.id, split.ratio + directionMultiplier * 4);
	};

	return (
		<button
			type="button"
			className={cn(
				"group grid place-items-center rounded-sm transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
				direction === "horizontal" ? "h-full w-4 cursor-col-resize" : "h-4 w-full cursor-row-resize"
			)}
			aria-label={direction === "horizontal" ? "調整左右 pane 大小" : "調整上下 pane 大小"}
			aria-orientation={direction === "horizontal" ? "vertical" : "horizontal"}
			aria-valuemin={MIN_TASK_PANE_RATIO}
			aria-valuemax={100 - MIN_TASK_PANE_RATIO}
			aria-valuenow={Math.round(split.ratio)}
			role="separator"
			onPointerDown={handleResizeStart}
			onKeyDown={handleResizeKeyDown}
		>
			<span className={cn("rounded-full bg-border transition-colors group-hover:bg-primary/30", direction === "horizontal" ? "h-20 w-0.5" : "h-0.5 w-20")} aria-hidden="true" />
		</button>
	);
}

export default function MeetingRoom() {
	const [micMode, setMicMode] = useState<MicMode>("private");
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
	const [previewItem, setPreviewItem] = useState<LostAtSeaItem | null>(null);
	const [jitsiStatus, setJitsiStatus] = useState<JitsiConnectionStatus>("loading");
	const [isShortcutHelpOpen, setIsShortcutHelpOpen] = useState(false);
	const [isPrivateBoardCollapsed, setIsPrivateBoardCollapsed] = useState(false);
	const [isJitsiCollapsed, setIsJitsiCollapsed] = useState(false);
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
	const publicRankingScrollRef = useRef<HTMLDivElement | null>(null);
	const privateRankingScrollRef = useRef<HTMLDivElement | null>(null);
	const autoStartedMicKeyRef = useRef<string | null>(null);
	const { participantId, displayName, roomName } = useParticipantIdentity();
	const isParticipantIdValid = isValidParticipantId(participantId);
	const connectionParticipantId = isParticipantIdValid ? participantId : undefined;
	const sessionId = roomName;
	const { sendMessage, lastMessage, isConnected } = useWebSocket(sessionId, connectionParticipantId, displayName);
	const joinRejectedMessage = isJoinRejectedMessage(lastMessage) ? lastMessage.message || "這個 Participant ID 已經在此 session 中，不能重複進入。" : null;
	const { startAudioStream, lastAudioMessage, audioError } = useAudioStream(sessionId, connectionParticipantId, displayName);
	const sensors = useSensors(useSensor(PointerSensor), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
	const hasAudioConnectionError = !!audioError;
	const handleJitsiStatusChange = useCallback((status: JitsiConnectionStatus) => {
		setJitsiStatus(status);
	}, []);
	const taskItemsById = useMemo(() => Object.fromEntries(taskItems.map(item => [item.id, item])), [taskItems]);
	const defaultItemIds = useMemo(() => taskItems.map(item => item.id), [taskItems]);
	const publicRankIndexById = useMemo(() => createRankIndexById(publicItems), [publicItems]);
	const shouldHighlightRankConflict = currentPhase === "group";
	const meetingLayoutStyle = {
		"--private-board-width": `${isPrivateBoardCollapsed ? 18 : privateBoardWidth}px`,
		"--jitsi-height": `${isJitsiCollapsed ? 0 : jitsiHeight}px`
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
			const shouldRetryCurrentMode = micMode === mode && hasAudioConnectionError;
			const nextMode = shouldRetryCurrentMode ? mode : mode;

			setMicMode(nextMode);
			await startAudioStream(nextMode);
		},
		[hasAudioConnectionError, micMode, startAudioStream]
	);

	useEffect(() => {
		if (!connectionParticipantId || joinRejectedMessage) {
			return;
		}

		const autoStartKey = `${sessionId}:${connectionParticipantId}`;
		if (autoStartedMicKeyRef.current === autoStartKey) {
			return;
		}

		autoStartedMicKeyRef.current = autoStartKey;
		setMicMode("private");
		void startAudioStream("private");
	}, [connectionParticipantId, joinRejectedMessage, sessionId, startAudioStream]);

	useEffect(() => {
		const handleMicShortcutKeyDown = (event: KeyboardEvent) => {
			if (event.defaultPrevented || event.repeat || event.metaKey || event.ctrlKey || event.altKey || isEditableShortcutTarget(event.target)) {
				return;
			}

			if (event.code === "Space") {
				event.preventDefault();
				void handleMic(micMode === "public" ? "private" : "public");
			}
		};

		window.addEventListener("keydown", handleMicShortcutKeyDown);
		return () => window.removeEventListener("keydown", handleMicShortcutKeyDown);
	}, [handleMic, micMode]);

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
			<section className="grid min-w-0 grid-rows-[minmax(0,1fr)_auto_var(--jitsi-height)_2rem] gap-y-0.5 text-card-foreground xl:min-h-0">
				<TaskWorkspace
					currentPhase={currentPhase}
					taskTitle={taskTitle}
					taskDetail={taskDetail}
					renderPublicRanking={() => (
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
							scrollContainerRef={publicRankingScrollRef}
						/>
					)}
					renderPrivateRanking={() => (
						<LostAtSeaRankingPanel
							title="Private 排序"
							status={`${displayName} (${participantId})`}
							items={privateItems}
							sensors={sensors}
							onDragStart={() => {
								isDraggingRef.current.private = true;
							}}
							onDragCancel={() => handleRankingDragCancel("private")}
							onDragEnd={event => handleRankingDragEnd("private", event)}
							onPreviewItem={setPreviewItem}
							scrollContainerRef={privateRankingScrollRef}
							getRankDelta={item => {
								if (!shouldHighlightRankConflict) {
									return undefined;
								}
								const publicRank = publicRankIndexById.get(item.id);
								return publicRank == null ? undefined : item.rank - publicRank;
							}}
						/>
					)}
				/>

				<div className={cn("grid h-4 grid-cols-[1fr_auto_1fr] items-center gap-2", isJitsiCollapsed && "hidden")}>
					<div />
					{!isJitsiCollapsed && (
						<button
							type="button"
							className="group grid h-4 w-20 cursor-row-resize place-items-center rounded-sm transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
							aria-label="調整 Jitsi 區塊高度"
							aria-orientation="horizontal"
							aria-valuemin={MIN_JITSI_HEIGHT}
							aria-valuenow={jitsiHeight}
							role="separator"
							onPointerDown={handleJitsiResizeStart}
							onKeyDown={handleJitsiResizeKeyDown}
						>
							<span className="h-0.5 w-20 rounded-full bg-border transition-colors group-hover:bg-primary/30" aria-hidden="true" />
						</button>
					)}
					<div />
				</div>

				<div className={cn("relative min-h-0 overflow-hidden rounded-lg border bg-muted", isJitsiCollapsed && "border-transparent bg-transparent")}>
					<div className={cn("absolute inset-0", isJitsiCollapsed && "pointer-events-none opacity-0")}>
						<JitsiRoom meetingDomain={jitsiBaseUrl} roomName={roomName} displayName={displayName} micMode={micMode} onStatusChange={handleJitsiStatusChange} />
					</div>
					{!isJitsiCollapsed && (
						<>
							<Button
								type="button"
								variant="outline"
								size="icon"
								className="absolute left-2 top-2 z-40 h-8 w-8 bg-background/90 shadow-sm backdrop-blur"
								aria-label="收合 Jitsi"
								title="收合 Jitsi"
								aria-expanded="true"
								onClick={() => setIsJitsiCollapsed(true)}
							>
								<ChevronDown className="h-4 w-4" />
							</Button>
						</>
					)}
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
							</Button>
						</div>
					</div>
					{hasAudioConnectionError && (
						<AlertCircle className="hidden" aria-label="音訊後端連線失敗" role="img">
							<title>{audioError}</title>
						</AlertCircle>
					)}
				</div>

				<div className="relative flex h-10 items-start justify-center pt-1">
					<div className="hidden">
						<div>WebSocket: {isConnected ? "已連線" : "未連線"}</div>
						<div>Jitsi: {jitsiStatusLabels[jitsiStatus]}</div>
						{micPermission !== "granted" && micPermission !== "unknown" && (
							<button onClick={() => void requestMicPermission()} className="text-primary hover:underline hover:text-primary/80 transition-colors text-left">
								{micPermission === "denied" ? "麥克風已拒絕 (需至瀏覽器開啟)" : "點擊允許麥克風權限"}
							</button>
						)}
					</div>
					<div className="flex flex-wrap items-center justify-center gap-2.5">
						<Button
							variant={micMode === "public" ? "destructive" : "outline"}
							className={cn("h-9 gap-2 px-4 text-sm", micMode !== "public" && "border-destructive text-destructive hover:bg-destructive/10 hover:text-destructive")}
							onClick={() => void handleMic("public")}
						>
							<Mic className="h-4 w-4" />
							公開發言
							<ShortcutKey label="Space" />
						</Button>
						<Button className="h-9 gap-2 px-4 text-sm" variant={micMode === "private" ? "default" : "outline"} onClick={() => void handleMic("private")}>
							<Radio className="h-4 w-4" />
							<span className="text-sm">悄悄話</span>
						</Button>
					</div>
					{hasAudioConnectionError && (
						<AlertCircle className="absolute right-24 h-4 w-4 text-destructive" aria-label="音訊後端連線失敗" role="img">
							<title>{audioError}</title>
						</AlertCircle>
					)}
					<div className="absolute bottom-0 left-0">
						<Button
							type="button"
							variant="outline"
							size="icon"
							className={cn("h-8 w-8", !isJitsiCollapsed && "hidden")}
							aria-label={isJitsiCollapsed ? "展開 Jitsi" : "收合 Jitsi"}
							title={isJitsiCollapsed ? "展開 Jitsi" : "收合 Jitsi"}
							aria-expanded={!isJitsiCollapsed}
							onClick={() => setIsJitsiCollapsed(current => !current)}
						>
							{isJitsiCollapsed ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
						</Button>
					</div>
					<div className="absolute bottom-0 right-0 hidden xl:block">
						<Button
							type="button"
							variant="ghost"
							size="sm"
							className="h-7 gap-1.5 px-2 text-xs text-muted-foreground"
							aria-expanded={isShortcutHelpOpen}
							onClick={() => setIsShortcutHelpOpen(current => !current)}
						>
							<Keyboard className="h-3.5 w-3.5" />
							快捷鍵
						</Button>
						{isShortcutHelpOpen && (
							<div className="absolute bottom-full right-0 z-30 mb-1 grid w-44 gap-1 rounded-md border bg-popover p-2 text-xs text-popover-foreground shadow-md">
								<div className="flex items-center justify-between gap-3">
									<span>切換發言狀態</span>
									<ShortcutKey label="Space" />
								</div>
								<div className="flex items-center justify-between gap-3">
									<span>切換分頁</span>
									<ShortcutKey label="1/2/3" />
								</div>
								<div className="flex items-center justify-between gap-3">
									<span>輸入</span>
									<ShortcutKey label="Enter" />
								</div>
							</div>
						)}
					</div>
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
				{!isPrivateBoardCollapsed && (
					<button
						type="button"
						className="group absolute -left-4 top-1/2 hidden h-20 w-4 -translate-y-1/2 cursor-col-resize place-items-center rounded-sm transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring xl:grid"
						aria-label="調整 Private Board 寬度"
						aria-orientation="vertical"
						aria-valuemin={MIN_PRIVATE_BOARD_WIDTH}
						aria-valuenow={privateBoardWidth}
						role="separator"
						onPointerDown={handlePrivateBoardResizeStart}
						onKeyDown={handlePrivateBoardResizeKeyDown}
					>
						<span className="h-20 w-0.5 rounded-full bg-border transition-colors group-hover:bg-primary/30" aria-hidden="true" />
					</button>
				)}
				{isPrivateBoardCollapsed && (
					<Button
						type="button"
						variant="outline"
						size="icon"
						className="absolute -right-2 top-3 z-20 h-8 w-8 shadow-sm"
						aria-label="展開 Private Board"
						title="展開 Private Board"
						aria-expanded="false"
						onClick={() => setIsPrivateBoardCollapsed(false)}
					>
						<ChevronLeft className="h-4 w-4" />
					</Button>
				)}
				<div className={cn("h-full", isPrivateBoardCollapsed && "hidden")}>
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
						onCollapse={() => setIsPrivateBoardCollapsed(true)}
					/>
				</div>
			</aside>
			<button
				onClick={toggleFullscreen}
				className="fixed bottom-1 right-1 z-50 grid h-10 w-10 place-items-center rounded-full bg-background/80 text-foreground shadow-sm backdrop-blur transition-colors hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
				title={isFullscreen ? "退出全螢幕" : "全螢幕"}
			>
				{isFullscreen ? <Minimize className="h-5 w-5" /> : <Maximize className="h-5 w-5" />}
			</button>
		</main>
	);
}
