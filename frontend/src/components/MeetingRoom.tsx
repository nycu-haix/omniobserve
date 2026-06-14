import type { DragEndEvent, UniqueIdentifier } from "@dnd-kit/core";
import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useDroppable, useSensor, useSensors } from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { AlertCircle, Bell, ChevronDown, ChevronLeft, ChevronUp, GripVertical, Keyboard, Lock, Maximize, Mic, Minimize, Radio } from "lucide-react";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from "react";
import { useAudioStream } from "../hooks/useAudioStream";
import { useParticipantIdentity } from "../hooks/useParticipantIdentity";
import { useWebSocket } from "../hooks/useWebSocket";
import { getNextMicModeAfterPublicActivation } from "../lib/micMode";
import { isValidParticipantId } from "../lib/participantDefaults";
import { DEFAULT_SESSION_PHASE, isGroupPhase, isPrivatePhase1, isPrivatePhase2, normalizeSessionPhase, normalizeSessionPhaseOptions, type SessionPhase } from "../lib/sessionPhase";
import { cn } from "../lib/utils";
import { fetchTaskConfig, type Phase1BuilderConfig, type TaskConfigItem, type TaskPaneLayoutConfig } from "../services/api";
import type { MicMode } from "../types";
import { JitsiRoom, type JitsiAudioParticipant, type JitsiAudioSnapshot, type JitsiConnectionStatus } from "./JitsiRoom";
import { PrivatePhaseTaskItemsPanel } from "./PrivatePhaseTaskItemsPanel";
import { PrivateBoard, type PrivateBoardHandle } from "./private-board/PrivateBoard";
import { formatUnreadCount, type IdeaBlockUnreadState } from "./private-board/unreadIdeaBlocks";
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
type TaskPaneContent = "task-instructions" | "phase-task-items" | "private-ranking" | "public-ranking";
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

const EMPTY_JITSI_AUDIO_SNAPSHOT: JitsiAudioSnapshot = {
	participants: [],
	dominantSpeakerId: null,
	connected: false
};

interface RankingSnapshot {
	revision: number;
	items: string[];
	change_count?: number;
}

function isTaskConfigItemList(value: unknown): value is TaskConfigItem[] {
	return Array.isArray(value) && value.every(item => typeof item === "object" && item !== null && "id" in item && typeof item.id === "string" && "label" in item && typeof item.label === "string");
}

const jitsiBaseUrl = import.meta.env.VITE_JITSI_BASE_URL || "https://meet.omni.elvismao.com";
const DEFAULT_PRIVATE_BOARD_WIDTH = 500;
const MIN_PRIVATE_BOARD_WIDTH = 420;
const MIN_MEETING_COLUMN_WIDTH = 640;
const PRIVATE_BOARD_WIDTH_STORAGE_KEY = "omni.meeting.privateBoardWidth";
const MIN_JITSI_HEIGHT = 220;
const MIN_TASK_WORKSPACE_HEIGHT = 260;
const PREFERRED_JITSI_VIEWPORT_RATIO = 0.34;
const MEETING_VERTICAL_PADDING = 32;
const JITSI_RESIZE_HANDLE_HEIGHT = 16;
const MIC_CONTROLS_HEIGHT = 40;
const MEETING_ROW_GAP_HEIGHT = 4;
const PRIVATE_PUBLIC_RANK_CONFLICT_THRESHOLD = 3;
const MAX_TASK_PANES = 3;
const MIN_TASK_PANE_RATIO = 24;
const RANKING_CUTOFF_DROP_PREFIX = "ranking-cutoff:";
const TASK_PANE_CONTENT_LABELS: Record<TaskPaneContent, string> = {
	"task-instructions": "Task Instructions",
	"phase-task-items": "Task Items",
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

function getParticipantInitial(participant: JitsiAudioParticipant) {
	const label = participant.displayName.trim() || participant.id;
	return label.slice(0, 1).toUpperCase();
}

const MAX_VISIBLE_AUDIO_PARTICIPANT_SLOTS = 4;

function JitsiAudioIndicator({ snapshot }: { snapshot: JitsiAudioSnapshot }) {
	const participants = snapshot.participants;
	const activeSpeaker = participants.find(participant => participant.isDominant && !participant.isMuted) ?? participants.find(participant => participant.isDominant);
	const openMicCount = participants.filter(participant => !participant.isMuted).length;
	const visibleParticipantCount = participants.length <= MAX_VISIBLE_AUDIO_PARTICIPANT_SLOTS ? participants.length : MAX_VISIBLE_AUDIO_PARTICIPANT_SLOTS - 1;
	const visibleParticipants = participants.slice(0, visibleParticipantCount);
	const hiddenParticipantCount = Math.max(0, participants.length - visibleParticipants.length);
	const statusLabel = snapshot.connected ? (activeSpeaker ? `${activeSpeaker.displayName} 發言中` : "無人發言") : "Jitsi 未連線";

	return (
		<div
			className={cn(
				"grid h-8 w-full min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 rounded-md border bg-background/90 px-2 text-xs shadow-sm backdrop-blur",
				activeSpeaker ? "border-destructive/30 text-foreground" : "text-muted-foreground"
			)}
			title={`${statusLabel}，開麥 ${openMicCount}`}
		>
			<span className={cn("h-2 w-2 shrink-0 rounded-full", activeSpeaker ? "animate-pulse bg-destructive" : snapshot.connected ? "bg-muted-foreground/50" : "bg-border")} aria-hidden="true" />
			<span className="flex min-w-0 items-center gap-1 font-medium">
				{activeSpeaker ? <span className="min-w-0 truncate">{activeSpeaker.displayName}</span> : <span className="min-w-0 truncate">{snapshot.connected ? "無人發言" : "Jitsi 未連線"}</span>}
			</span>
			<div className="flex shrink-0 items-center justify-end gap-1.5">
				<span className="whitespace-nowrap text-muted-foreground">開麥 {openMicCount}</span>
				<div className="hidden shrink-0 -space-x-1 sm:flex" aria-hidden="true">
					{visibleParticipants.map(participant => (
						<span
							key={participant.id}
							className={cn(
								"grid h-5 w-5 place-items-center rounded-full border bg-muted text-[10px] font-semibold text-muted-foreground",
								participant.isDominant && "ring-2 ring-destructive ring-offset-1 ring-offset-background",
								participant.isMuted && "opacity-40"
							)}
							title={`${participant.displayName}${participant.isMuted ? " 靜音" : " 開麥"}`}
						>
							{getParticipantInitial(participant)}
						</span>
					))}
					{hiddenParticipantCount > 0 && (
						<span className="grid h-5 w-5 place-items-center rounded-full border bg-muted text-[10px] font-semibold text-muted-foreground">+{hiddenParticipantCount}</span>
					)}
				</div>
			</div>
		</div>
	);
}

function withLocalSpeakingParticipant(snapshot: JitsiAudioSnapshot, displayName: string, isLocalSpeaking: boolean): JitsiAudioSnapshot {
	if (!isLocalSpeaking) {
		return snapshot;
	}

	let localParticipantId = "local-speaking";
	let hasLocalParticipant = false;
	const participants = snapshot.participants.map(participant => {
		const isLocalParticipant = participant.isLocal || participant.displayName === displayName;
		if (!isLocalParticipant) {
			return {
				...participant,
				isDominant: false
			};
		}

		hasLocalParticipant = true;
		localParticipantId = participant.id;
		return {
			...participant,
			displayName,
			isMuted: false,
			isLocal: true,
			isDominant: true
		};
	});

	if (!hasLocalParticipant) {
		participants.push({
			id: localParticipantId,
			displayName,
			isMuted: false,
			isLocal: true,
			isDominant: true
		});
	}

	participants.sort((first, second) => {
		if (first.isDominant !== second.isDominant) return first.isDominant ? -1 : 1;
		if (first.isMuted !== second.isMuted) return first.isMuted ? 1 : -1;
		if (first.isLocal !== second.isLocal) return first.isLocal ? -1 : 1;
		return first.displayName.localeCompare(second.displayName);
	});

	return {
		participants,
		dominantSpeakerId: localParticipantId,
		connected: true
	};
}

const TASK_ITEM_IMAGE_CACHE_KEYS: Record<string, string> = {
	floating_cushion: "20260608-realistic",
	receive_only_radio: "20260608-rca"
};

function taskItemImageSrc(itemId: string): string {
	const cacheKey = TASK_ITEM_IMAGE_CACHE_KEYS[itemId];
	const cacheQuery = cacheKey ? `?v=${cacheKey}` : "";
	return `/task-item-images/${itemId}.jpg${cacheQuery}`;
}

function taskItemFallbackImageSrc(item: LostAtSeaItem): string {
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 220"><rect width="320" height="220" rx="24" fill="${item.imageBg}"/><circle cx="72" cy="76" r="36" fill="#fff" opacity=".72"/><rect x="112" y="48" width="136" height="96" rx="18" fill="#fff" opacity=".72"/><path d="M68 156 C112 126 156 188 204 146 C226 126 250 128 276 150" fill="none" stroke="${item.imageFg}" stroke-width="10" stroke-linecap="round"/><text x="160" y="113" text-anchor="middle" font-family="Arial, sans-serif" font-size="34" font-weight="700" fill="${item.imageFg}">${item.imageMark}</text><text x="160" y="194" text-anchor="middle" font-family="Arial, sans-serif" font-size="18" font-weight="600" fill="${item.imageFg}">${item.imageTitle}</text></svg>`;
	return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function handleTaskItemImageError(event: React.SyntheticEvent<HTMLImageElement>, item: LostAtSeaItem) {
	event.currentTarget.src = taskItemFallbackImageSrc(item);
}

function getViewportWidth() {
	return Math.floor(window.visualViewport?.width ?? window.innerWidth);
}

function getViewportHeight() {
	return Math.floor(window.visualViewport?.height ?? window.innerHeight);
}

function clampPrivateBoardWidth(width: number) {
	const availableWidth = getViewportWidth() - 32 - 16;
	const responsiveMinWidth = Math.min(MIN_PRIVATE_BOARD_WIDTH, Math.max(360, Math.floor(availableWidth * 0.38)));
	const maxWidth = Math.max(responsiveMinWidth, availableWidth - MIN_MEETING_COLUMN_WIDTH);
	return Math.min(Math.max(width, responsiveMinWidth), maxWidth);
}

function clampJitsiHeight(height: number) {
	const fixedHeight = MEETING_VERTICAL_PADDING + JITSI_RESIZE_HANDLE_HEIGHT + MIC_CONTROLS_HEIGHT + MEETING_ROW_GAP_HEIGHT;
	const maxHeight = Math.max(MIN_JITSI_HEIGHT, getViewportHeight() - fixedHeight - MIN_TASK_WORKSPACE_HEIGHT);
	return Math.min(Math.max(height, MIN_JITSI_HEIGHT), maxHeight);
}

function getPreferredJitsiHeight() {
	return clampJitsiHeight(Math.round(getViewportHeight() * PREFERRED_JITSI_VIEWPORT_RATIO));
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

function normalizeRankingLimit(value: unknown): number | undefined {
	const rankingLimit = Number(value);
	return Number.isFinite(rankingLimit) && rankingLimit > 0 ? Math.floor(rankingLimit) : undefined;
}

function shouldDefaultCollapseJitsi() {
	const roomName = new URLSearchParams(window.location.search)
		.get("room_name")
		?.trim()
		.replace(/^["']|["']$/g, "");
	return roomName?.startsWith("enhance-the-poster") ?? false;
}

function getActiveRankingLimit(taskId: string, phase: SessionPhase, configuredLimit: number | undefined, itemCount: number): number | undefined {
	if (taskId !== "enhance-the-poster" || isPrivatePhase1(phase) || configuredLimit === undefined || itemCount <= 0) {
		return undefined;
	}
	return configuredLimit;
}

function normalizeRankingChangeCount(value: unknown, rankingLimit: number | undefined, itemCount: number): number | undefined {
	if (rankingLimit === undefined || itemCount <= 0) {
		return undefined;
	}
	const maxChangeCount = Math.min(rankingLimit, itemCount);
	const changeCount = Number(value);
	return Number.isFinite(changeCount) ? Math.max(0, Math.min(Math.floor(changeCount), maxChangeCount)) : maxChangeCount;
}

function getRankingCutoffDropId(scope: RankingScope) {
	return `${RANKING_CUTOFF_DROP_PREFIX}${scope}`;
}

function isRankingCutoffDropId(value: UniqueIdentifier, scope: RankingScope) {
	return String(value) === getRankingCutoffDropId(scope);
}

function getNextRankingChangeCount({
	currentChangeCount,
	rankingLimit,
	itemCount,
	oldIndex,
	targetIndex
}: {
	currentChangeCount: number | undefined;
	rankingLimit: number | undefined;
	itemCount: number;
	oldIndex: number;
	targetIndex: number;
}) {
	if (currentChangeCount === undefined || rankingLimit === undefined) {
		return currentChangeCount;
	}
	const boundedTargetIndex = Math.max(0, Math.min(targetIndex, itemCount));
	if (oldIndex < currentChangeCount && boundedTargetIndex >= currentChangeCount) {
		return Math.max(0, currentChangeCount - 1);
	}
	if (oldIndex >= currentChangeCount && boundedTargetIndex <= currentChangeCount) {
		return normalizeRankingChangeCount(currentChangeCount + 1, rankingLimit, itemCount);
	}
	return currentChangeCount;
}

function moveRankingItem(items: LostAtSeaItem[], itemId: UniqueIdentifier, targetIndex: number): LostAtSeaItem[] {
	const currentOldIndex = items.findIndex(item => item.id === itemId);
	if (currentOldIndex < 0) {
		return items;
	}
	const nextItems = [...items];
	const [movedItem] = nextItems.splice(currentOldIndex, 1);
	nextItems.splice(Math.max(0, Math.min(targetIndex, nextItems.length)), 0, movedItem);
	return nextItems.map((item, index) => ({
		...item,
		rank: index + 1
	}));
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

function createPhaseLayoutConfigById(phases: Array<{ id?: unknown; default_layout?: TaskPaneLayoutConfig }> | undefined): Partial<Record<SessionPhase, TaskPaneLayoutConfig>> {
	const layoutsByPhase: Partial<Record<SessionPhase, TaskPaneLayoutConfig>> = {};
	phases?.forEach(phase => {
		const phaseId = normalizeSessionPhase(phase.id);
		if (phaseId && phase.default_layout) {
			layoutsByPhase[phaseId] = phase.default_layout;
		}
	});
	return layoutsByPhase;
}

function createTaskPaneLeaf(content: TaskPaneContent): TaskPaneLeaf {
	return {
		type: "leaf",
		id: `task-pane-${Date.now()}-${Math.random().toString(36).slice(2)}`,
		content
	};
}

function isTaskPaneContent(value: unknown): value is TaskPaneContent {
	return typeof value === "string" && value in TASK_PANE_CONTENT_LABELS;
}

function createTaskPaneLayoutFromConfig(config: TaskPaneLayoutConfig | undefined, phase: SessionPhase, phase1BuilderEnabled = false): TaskPaneNode | null {
	if (!config) {
		return null;
	}

	if (config.type === "leaf") {
		if (!isTaskPaneContent(config.content) || !getTaskPaneContentAvailability(config.content, phase, phase1BuilderEnabled)) {
			return null;
		}
		return createTaskPaneLeaf(config.content);
	}

	if (config.type !== "split") {
		return null;
	}

	const first = createTaskPaneLayoutFromConfig(config.first, phase, phase1BuilderEnabled);
	const second = createTaskPaneLayoutFromConfig(config.second, phase, phase1BuilderEnabled);
	if (!first || !second) {
		return null;
	}

	const configuredLayout: TaskPaneSplit = {
		type: "split",
		id: `task-split-${Date.now()}-${Math.random().toString(36).slice(2)}`,
		direction: config.direction === "vertical" ? "vertical" : "horizontal",
		ratio: Math.min(Math.max(Number(config.ratio) || 50, MIN_TASK_PANE_RATIO), 100 - MIN_TASK_PANE_RATIO),
		first,
		second
	};

	return countTaskPaneLeaves(configuredLayout) <= MAX_TASK_PANES ? configuredLayout : null;
}

function createDefaultTaskPaneLayout(phase: SessionPhase, phase1BuilderEnabled = false, layoutConfig?: TaskPaneLayoutConfig): TaskPaneNode {
	const configuredLayout = createTaskPaneLayoutFromConfig(layoutConfig, phase, phase1BuilderEnabled);
	if (configuredLayout) {
		return configuredLayout;
	}

	if (isGroupPhase(phase)) {
		return {
			type: "split",
			id: `task-split-${Date.now()}-${Math.random().toString(36).slice(2)}`,
			direction: "horizontal",
			ratio: 50,
			first: createTaskPaneLeaf("public-ranking"),
			second: createTaskPaneLeaf("private-ranking")
		};
	}

	if (isPrivatePhase1(phase) && phase1BuilderEnabled) {
		return createTaskPaneLeaf("phase-task-items");
	}

	if (isPrivatePhase2(phase)) {
		return createTaskPaneLeaf("private-ranking");
	}

	return createTaskPaneLeaf("private-ranking");
}

function countTaskPaneLeaves(node: TaskPaneNode): number {
	return node.type === "leaf" ? 1 : countTaskPaneLeaves(node.first) + countTaskPaneLeaves(node.second);
}

function getTaskPaneContentAvailability(content: TaskPaneContent, phase: SessionPhase, phase1BuilderEnabled = false): boolean {
	if (content === "phase-task-items") {
		return isPrivatePhase1(phase) && phase1BuilderEnabled;
	}
	if (content === "private-ranking") {
		return !isPrivatePhase1(phase) || !phase1BuilderEnabled;
	}
	if (content === "public-ranking") {
		return isGroupPhase(phase);
	}
	return true;
}

function isRankingStateMessage(message: object | null): message is { type: "ranking_state"; scope?: RankingScope; revision: number; items: string[]; change_count?: number } {
	return !!message && "type" in message && message.type === "ranking_state" && "items" in message && Array.isArray(message.items);
}

function isRankingSnapshot(value: unknown): value is RankingSnapshot {
	return (
		typeof value === "object" &&
		value !== null &&
		"revision" in value &&
		typeof value.revision === "number" &&
		"items" in value &&
		Array.isArray(value.items) &&
		(!("change_count" in value) || typeof value.change_count === "number")
	);
}

function isBoardStateMessage(message: object | null): message is {
	type: "board_state";
	revision: number;
	ranking?: { items: string[] };
	public_ranking?: RankingSnapshot;
	private_ranking?: RankingSnapshot;
	ranking_items?: TaskConfigItem[] | null;
	current_phase?: unknown;
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
	phase: unknown;
	end_time_ms?: number;
} {
	return !!message && "type" in message && message.type === "phase_changed" && "phase" in message && normalizeSessionPhase(message.phase) !== null;
}

function isCountdownChangedMessage(message: object | null): message is {
	type: "countdown_changed";
	current_phase?: unknown;
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

function RankingCutoffSeparator({ scope, limit, changeCount }: { scope: RankingScope; limit: number; changeCount: number }) {
	const { setNodeRef, isOver } = useDroppable({
		id: getRankingCutoffDropId(scope)
	});
	const label = changeCount >= limit ? `前 ${limit} 個會納入改善排序；以下項目不會改動` : `前 ${changeCount} 個會納入改善排序（最多 ${limit} 個）；以下項目不會改動`;
	return (
		<div
			ref={setNodeRef}
			className={cn(
				"grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 rounded-md py-1 text-xs font-medium text-muted-foreground transition-colors",
				isOver && "bg-primary/5 text-primary"
			)}
			aria-label="拖到這條線下方代表不改動"
		>
			<span className="h-px bg-border" />
			<span className="max-w-[min(34rem,78vw)] rounded-full border bg-background px-3 py-1 text-center leading-5">{label}</span>
			<span className="h-px bg-border" />
		</div>
	);
}

function SortableLostAtSeaItem({
	item,
	rankDelta,
	showImage,
	rankingLimit,
	changeCount,
	onPreview
}: {
	item: LostAtSeaItem;
	rankDelta?: number;
	showImage: boolean;
	rankingLimit?: number;
	changeCount?: number;
	onPreview: (item: LostAtSeaItem) => void;
}) {
	const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
		id: item.id
	});
	const verticalTransform = transform ? { ...transform, x: 0 } : transform;
	const rankDeltaAmount = typeof rankDelta === "number" ? Math.abs(rankDelta) : 0;
	const hasRankDelta = rankDeltaAmount > 0;
	const isRankConflict = rankDeltaAmount > PRIVATE_PUBLIC_RANK_CONFLICT_THRESHOLD;
	const rankDeltaDirection = typeof rankDelta === "number" && rankDelta < 0 ? "up" : "down";
	const isBeyondRankingLimit = changeCount !== undefined && item.rank > changeCount;
	const itemTitle =
		isBeyondRankingLimit && rankingLimit !== undefined
			? `這個項目目前不會改動；拖到分隔線上方可納入排序，最多 ${rankingLimit} 個`
			: hasRankDelta
				? `與 Public 排序差 ${rankDeltaAmount} 位`
				: undefined;

	return (
		<div
			ref={setNodeRef}
			className={cn(
				"grid min-h-10 w-full shrink-0 cursor-grab select-none items-start gap-3 rounded-lg border bg-background px-3 py-2 transition-colors",
				showImage ? "grid-cols-[auto_auto_minmax(0,1fr)_auto_auto]" : "grid-cols-[auto_minmax(0,1fr)_auto_auto]",
				isRankConflict && "border-muted-foreground/30",
				isBeyondRankingLimit && "bg-muted/35 text-muted-foreground",
				isDragging && "opacity-50"
			)}
			style={{
				transform: CSS.Transform.toString(verticalTransform),
				transition
			}}
			title={itemTitle}
			{...attributes}
			{...listeners}
		>
			{showImage && (
				<button
					type="button"
					className="mt-0.5 h-9 w-12 shrink-0 overflow-hidden rounded-md border bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
					aria-label={`放大查看 ${item.label}`}
					onClick={event => {
						event.stopPropagation();
						onPreview(item);
					}}
					onPointerDown={event => event.stopPropagation()}
				>
					<img className="h-full w-full object-cover" src={taskItemImageSrc(item.id)} alt={item.imageTitle} draggable={false} onError={event => handleTaskItemImageError(event, item)} />
				</button>
			)}
			<span className={cn("mt-0.5 grid h-6 shrink-0 place-items-center rounded-full bg-muted text-xs font-semibold text-primary", isBeyondRankingLimit ? "w-10" : "w-6")}>
				{isBeyondRankingLimit ? "不改" : item.rank}
			</span>
			<span className="min-w-0 whitespace-normal break-words py-0.5 leading-5">{item.label}</span>
			{hasRankDelta && (
				<span
					className={cn(
						"mt-1 inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-xs font-semibold",
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
			<GripVertical className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
		</div>
	);
}

function LostAtSeaRankingPanel({
	scope,
	title,
	status,
	items,
	sensors,
	onDragStart,
	onDragCancel,
	onDragEnd,
	showImages,
	onPreviewItem,
	getRankDelta,
	rankingLimit,
	changeCount,
	scrollContainerRef
}: {
	scope: RankingScope;
	title: string;
	status: string;
	items: LostAtSeaItem[];
	sensors: ReturnType<typeof useSensors>;
	onDragStart: () => void;
	onDragCancel: () => void;
	onDragEnd: (event: DragEndEvent) => void;
	showImages: boolean;
	onPreviewItem: (item: LostAtSeaItem) => void;
	getRankDelta?: (item: LostAtSeaItem) => number | undefined;
	rankingLimit?: number;
	changeCount?: number;
	scrollContainerRef?: RefObject<HTMLDivElement | null>;
}) {
	return (
		<section className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden" aria-label={title}>
			<div className="sr-only">{status}</div>
			<DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={onDragStart} onDragCancel={onDragCancel} onDragEnd={onDragEnd}>
				<SortableContext items={items.map(item => item.id)} strategy={verticalListSortingStrategy}>
					<div ref={scrollContainerRef} className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pr-1">
						{items.map((item, index) => (
							<Fragment key={item.id}>
								{rankingLimit !== undefined && changeCount !== undefined && index === changeCount && <RankingCutoffSeparator scope={scope} limit={rankingLimit} changeCount={changeCount} />}
								<SortableLostAtSeaItem item={item} rankDelta={getRankDelta?.(item)} showImage={showImages} rankingLimit={rankingLimit} changeCount={changeCount} onPreview={onPreviewItem} />
							</Fragment>
						))}
						{rankingLimit !== undefined && changeCount !== undefined && changeCount >= items.length && <RankingCutoffSeparator scope={scope} limit={rankingLimit} changeCount={changeCount} />}
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
	referenceImageSrc,
	referenceImageAlt,
	sessionId,
	participantId,
	taskId,
	phase1Builder,
	phaseLayoutConfig,
	renderPrivateRanking,
	renderPublicRanking
}: {
	currentPhase: SessionPhase;
	taskTitle: string;
	taskDetail: string;
	referenceImageSrc?: string;
	referenceImageAlt?: string;
	sessionId: string;
	participantId: string;
	taskId: string;
	phase1Builder?: Phase1BuilderConfig;
	phaseLayoutConfig?: TaskPaneLayoutConfig;
	renderPrivateRanking: () => React.ReactNode;
	renderPublicRanking: () => React.ReactNode;
}) {
	const phase1BuilderEnabled = !!phase1Builder?.enabled && phase1Builder.components.length > 0 && phase1Builder.actions.length > 0;
	const [isNarrowLayout, setIsNarrowLayout] = useState(() => window.matchMedia("(max-width: 767px)").matches);
	const visibleLayout = useMemo(() => createDefaultTaskPaneLayout(currentPhase, phase1BuilderEnabled, phaseLayoutConfig), [currentPhase, phase1BuilderEnabled, phaseLayoutConfig]);

	useEffect(() => {
		const mediaQuery = window.matchMedia("(max-width: 767px)");
		const handleChange = () => setIsNarrowLayout(mediaQuery.matches);
		handleChange();
		mediaQuery.addEventListener("change", handleChange);
		return () => mediaQuery.removeEventListener("change", handleChange);
	}, []);

	const renderPaneContent = (content: TaskPaneContent) => {
		if (!getTaskPaneContentAvailability(content, currentPhase, phase1BuilderEnabled)) {
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

		if (content === "phase-task-items" && phase1Builder) {
			return <PrivatePhaseTaskItemsPanel sessionId={sessionId} participantId={participantId} taskId={taskId} builder={phase1Builder} />;
		}

		return (
			<section className="flex h-full min-h-0 flex-col overflow-hidden" aria-label="Task Instructions">
				<div className="grid min-h-0 flex-1 gap-3 overflow-auto rounded-md bg-muted/40 p-3 text-sm leading-6 text-foreground/80">
					{referenceImageSrc && <img className="max-h-[80vh] w-full rounded-md border bg-white object-contain" src={referenceImageSrc} alt={referenceImageAlt || taskTitle} />}
					{taskDetail ? <p className="whitespace-pre-wrap">{taskDetail}</p> : <p className="text-muted-foreground">尚無任務說明</p>}
				</div>
			</section>
		);
	};

	return (
		<section className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden rounded-lg border p-3" aria-label="Task workspace">
			<header className="mb-3 flex shrink-0 items-center">
				<div className="grid min-w-0 gap-1">
					<h2 className="truncate text-base font-semibold">{taskTitle}</h2>
				</div>
			</header>
			<div className="min-h-0 overflow-hidden">
				<TaskPaneRenderer node={visibleLayout} isNarrowLayout={isNarrowLayout} renderPaneContent={renderPaneContent} />
			</div>
		</section>
	);
}

function TaskPaneRenderer({ node, isNarrowLayout, renderPaneContent }: { node: TaskPaneNode; isNarrowLayout: boolean; renderPaneContent: (content: TaskPaneContent) => React.ReactNode }) {
	if (node.type === "leaf") {
		return <TaskPane pane={node}>{renderPaneContent(node.content)}</TaskPane>;
	}

	const effectiveDirection = isNarrowLayout ? "vertical" : node.direction;
	const gridStyle =
		effectiveDirection === "horizontal"
			? ({ gridTemplateColumns: `minmax(280px, ${node.ratio}fr) minmax(280px, ${100 - node.ratio}fr)` } as CSSProperties)
			: ({ gridTemplateRows: `minmax(180px, ${node.ratio}fr) minmax(180px, ${100 - node.ratio}fr)` } as CSSProperties);

	return (
		<div className="grid h-full min-h-0 min-w-0 gap-3" style={gridStyle}>
			<TaskPaneRenderer node={node.first} isNarrowLayout={isNarrowLayout} renderPaneContent={renderPaneContent} />
			<TaskPaneRenderer node={node.second} isNarrowLayout={isNarrowLayout} renderPaneContent={renderPaneContent} />
		</div>
	);
}

function TaskPane({ pane, children }: { pane: TaskPaneLeaf; children: React.ReactNode }) {
	return (
		<section className="grid h-full min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden rounded-lg border bg-card" aria-label={TASK_PANE_CONTENT_LABELS[pane.content]}>
			<header className="flex min-h-11 shrink-0 items-center justify-between gap-2 border-b bg-muted/35 px-2 py-1.5">
				<div className="flex min-w-0 items-center gap-2">
					<div className="truncate text-sm font-medium">{TASK_PANE_CONTENT_LABELS[pane.content]}</div>
				</div>
			</header>
			<div className="min-h-0 overflow-hidden p-2">{children}</div>
		</section>
	);
}

export default function MeetingRoom() {
	const [micMode, setMicMode] = useState<MicMode>("private");
	const [micPermission, setMicPermission] = useState<PermissionState | "unknown">("unknown");
	const [taskId, setTaskId] = useState("lost-at-sea");
	const [taskTitle, setTaskTitle] = useState("Lost at Sea");
	const [taskDetail, setTaskDetail] = useState("");
	const [taskReferenceImageSrc, setTaskReferenceImageSrc] = useState("");
	const [taskReferenceImageAlt, setTaskReferenceImageAlt] = useState("");
	const [phase1BuilderConfig, setPhase1BuilderConfig] = useState<Phase1BuilderConfig | undefined>();
	const [taskRankingLimit, setTaskRankingLimit] = useState<number | undefined>();
	const [taskItems, setTaskItems] = useState<TaskConfigItem[]>([]);
	const [publicItems, setPublicItems] = useState<LostAtSeaItem[]>([]);
	const [privateItems, setPrivateItems] = useState<LostAtSeaItem[]>([]);
	const [publicRankingRevision, setPublicRankingRevision] = useState(0);
	const [privateRankingRevision, setPrivateRankingRevision] = useState(0);
	const [publicRankingChangeCount, setPublicRankingChangeCount] = useState<number | undefined>();
	const [privateRankingChangeCount, setPrivateRankingChangeCount] = useState<number | undefined>();
	const [currentPhase, setCurrentPhase] = useState<SessionPhase>(DEFAULT_SESSION_PHASE);
	const [phaseLayoutConfigById, setPhaseLayoutConfigById] = useState<Partial<Record<SessionPhase, TaskPaneLayoutConfig>>>({});
	const [timerEndTime, setTimerEndTime] = useState(0);
	const [previewItem, setPreviewItem] = useState<LostAtSeaItem | null>(null);
	const [jitsiStatus, setJitsiStatus] = useState<JitsiConnectionStatus>("loading");
	const [jitsiAudioSnapshot, setJitsiAudioSnapshot] = useState<JitsiAudioSnapshot>(EMPTY_JITSI_AUDIO_SNAPSHOT);
	const [isShortcutHelpOpen, setIsShortcutHelpOpen] = useState(false);
	const [isPrivateBoardCollapsed, setIsPrivateBoardCollapsed] = useState(false);
	const [privateBoardIdeaBlockUnreadState, setPrivateBoardIdeaBlockUnreadState] = useState<IdeaBlockUnreadState>({ count: 0, latestBlockId: null });
	const [isJitsiCollapsed, setIsJitsiCollapsed] = useState(shouldDefaultCollapseJitsi);
	const [isJitsiFocused, setIsJitsiFocused] = useState(false);
	const [privateBoardWidth, setPrivateBoardWidth] = useState(() => {
		const storedWidth = Number(window.localStorage.getItem(PRIVATE_BOARD_WIDTH_STORAGE_KEY));
		return clampPrivateBoardWidth(Number.isFinite(storedWidth) ? storedWidth : DEFAULT_PRIVATE_BOARD_WIDTH);
	});
	const [jitsiHeight, setJitsiHeight] = useState(() => {
		return getPreferredJitsiHeight();
	});
	const [isFullscreen, setIsFullscreen] = useState(false);
	const [resizeCursor, setResizeCursor] = useState<"col-resize" | "row-resize" | null>(null);
	const isDraggingRef = useRef<Record<RankingScope, boolean>>({ public: false, private: false });
	const privateBoardRef = useRef<PrivateBoardHandle | null>(null);
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
	const { startAudioStream, isLocalSpeaking, lastAudioMessage, audioError } = useAudioStream(sessionId, connectionParticipantId, displayName);
	const sensors = useSensors(useSensor(PointerSensor), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
	const hasAudioConnectionError = !!audioError;
	const handleJitsiStatusChange = useCallback((status: JitsiConnectionStatus) => {
		setJitsiStatus(status);
	}, []);
	const handleJitsiAudioParticipantsChange = useCallback((snapshot: JitsiAudioSnapshot) => {
		setJitsiAudioSnapshot(snapshot);
	}, []);

	const taskItemsById = useMemo(() => Object.fromEntries(taskItems.map(item => [item.id, item])), [taskItems]);
	const defaultItemIds = useMemo(() => taskItems.map(item => item.id), [taskItems]);
	const publicRankIndexById = useMemo(() => createRankIndexById(publicItems), [publicItems]);
	const shouldHighlightRankConflict = isGroupPhase(currentPhase);
	const publicRankingLimit = getActiveRankingLimit(taskId, currentPhase, taskRankingLimit, publicItems.length);
	const privateRankingLimit = getActiveRankingLimit(taskId, currentPhase, taskRankingLimit, privateItems.length);
	const publicChangeCount = normalizeRankingChangeCount(publicRankingChangeCount, publicRankingLimit, publicItems.length);
	const privateChangeCount = normalizeRankingChangeCount(privateRankingChangeCount, privateRankingLimit, privateItems.length);
	const meetingLayoutStyle = {
		"--private-board-width": `${isPrivateBoardCollapsed ? 18 : privateBoardWidth}px`,
		"--jitsi-height": `${isJitsiCollapsed ? 0 : jitsiHeight}px`
	} as CSSProperties;
	const displayedJitsiAudioSnapshot = useMemo(
		() => withLocalSpeakingParticipant(jitsiAudioSnapshot, displayName, micMode === "public" && isLocalSpeaking),
		[displayName, isLocalSpeaking, jitsiAudioSnapshot, micMode]
	);
	const publicMicToggleLabel = micMode === "public" ? "切回悄悄話" : "切到公開發言";

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
				const taskConfig = await fetchTaskConfig({ sessionName: roomName, signal: abortController.signal });
				const nextTaskItemsById = Object.fromEntries(taskConfig.items.map(item => [item.id, item]));
				const nextDefaultItemIds = taskConfig.items.map(item => item.id);
				const nextItems = createInitialItems(taskConfig.items);

				setTaskId(taskConfig.task_id);
				setPreviewItem(null);
				setTaskTitle(taskConfig.title);
				setTaskDetail(taskConfig.task_detail);
				setTaskReferenceImageSrc(taskConfig.reference_image_src || "");
				setTaskReferenceImageAlt(taskConfig.reference_image_alt || taskConfig.title);
				setPhase1BuilderConfig(taskConfig.phase1_builder);
				setTaskRankingLimit(normalizeRankingLimit(taskConfig.ranking_limit));
				const nextTaskPhases = normalizeSessionPhaseOptions(taskConfig.phases);
				setPhaseLayoutConfigById(createPhaseLayoutConfigById(taskConfig.phases));
				setCurrentPhase(current => (nextTaskPhases.some(phase => phase.id === current) ? current : (nextTaskPhases[0]?.id ?? DEFAULT_SESSION_PHASE)));
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
	}, [roomName]);

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

	const handleAudioReconnect = useCallback(() => {
		void handleMic(micMode);
	}, [handleMic, micMode]);

	const handlePublicMicActivation = useCallback(() => {
		void handleMic(getNextMicModeAfterPublicActivation(micMode));
	}, [handleMic, micMode]);

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

			if (isJitsiFocused && event.key === "Escape") {
				event.preventDefault();
				setIsJitsiFocused(false);
				setJitsiHeight(getPreferredJitsiHeight());
				return;
			}

			if (event.code === "Space") {
				event.preventDefault();
				void handleMic(getNextMicModeAfterPublicActivation(micMode));
			}
		};

		window.addEventListener("keydown", handleMicShortcutKeyDown);
		return () => window.removeEventListener("keydown", handleMicShortcutKeyDown);
	}, [handleMic, isJitsiFocused, micMode]);

	useEffect(() => {
		if (!isJitsiFocused) {
			return;
		}

		const previousOverflow = document.body.style.overflow;
		document.body.style.overflow = "hidden";
		return () => {
			document.body.style.overflow = previousOverflow;
		};
	}, [isJitsiFocused]);

	const applyRankingSnapshot = useCallback(
		(scope: RankingScope, snapshot: RankingSnapshot) => {
			if (defaultItemIds.length === 0) {
				pendingRankingRef.current[scope] = snapshot;
				return;
			}
			if (scope === "private") {
				setPrivateRankingRevision(snapshot.revision);
				setPrivateItems(createRankedItems(snapshot.items, taskItemsById, defaultItemIds));
				setPrivateRankingChangeCount(snapshot.change_count);
				return;
			}

			setPublicRankingRevision(snapshot.revision);
			setPublicItems(createRankedItems(snapshot.items, taskItemsById, defaultItemIds));
			setPublicRankingChangeCount(snapshot.change_count);
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
		const currentChangeCount = scope === "private" ? privateChangeCount : publicChangeCount;
		const oldIndex = currentItems.findIndex(item => item.id === active.id);
		const isCutoffDrop = isRankingCutoffDropId(over.id, scope);
		const newIndex = isCutoffDrop ? currentChangeCount : currentItems.findIndex(item => item.id === over.id);
		if (oldIndex < 0 || newIndex === undefined || newIndex < 0) {
			return;
		}
		const rankingLimit = getActiveRankingLimit(taskId, currentPhase, taskRankingLimit, currentItems.length);
		const nextChangeCount = getNextRankingChangeCount({
			currentChangeCount,
			rankingLimit,
			itemCount: currentItems.length,
			oldIndex,
			targetIndex: newIndex
		});

		sendMessage({
			type: "ranking_move",
			scope,
			itemId: String(active.id),
			toIndex: newIndex,
			baseRevision: currentRevision
		});

		const updateItems = (current: LostAtSeaItem[]) => {
			return moveRankingItem(current, active.id, newIndex);
		};

		if (scope === "private") {
			setPrivateItems(updateItems);
			setPrivateRankingChangeCount(nextChangeCount);
		} else {
			setPublicItems(updateItems);
			setPublicRankingChangeCount(nextChangeCount);
		}
	};

	useEffect(() => {
		const handleResize = () => {
			setPrivateBoardWidth(current => clampPrivateBoardWidth(current));
			setJitsiHeight(current => clampJitsiHeight(current));
		};
		const visualViewport = window.visualViewport;

		window.addEventListener("resize", handleResize);
		visualViewport?.addEventListener("resize", handleResize);
		return () => {
			window.removeEventListener("resize", handleResize);
			visualViewport?.removeEventListener("resize", handleResize);
		};
	}, []);

	useEffect(() => {
		window.localStorage.setItem(PRIVATE_BOARD_WIDTH_STORAGE_KEY, String(privateBoardWidth));
	}, [privateBoardWidth]);

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

	const openPrivateBoard = useCallback(() => {
		setIsPrivateBoardCollapsed(false);
	}, []);

	const openUnreadIdeaBlocks = useCallback(() => {
		setIsPrivateBoardCollapsed(false);
		window.setTimeout(() => privateBoardRef.current?.openLatestUnreadIdeaBlock(), 0);
	}, []);

	const handleJitsiResizeStart = (event: React.PointerEvent<HTMLButtonElement>) => {
		event.preventDefault();
		setIsJitsiFocused(false);
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
		setIsJitsiFocused(false);
		const direction = event.key === "ArrowUp" ? 1 : -1;
		setJitsiHeight(current => clampJitsiHeight(current + direction * 24));
	};

	const handleJitsiFocusToggle = () => {
		const shouldFocusJitsi = !isJitsiFocused;
		setIsJitsiCollapsed(false);
		setIsJitsiFocused(shouldFocusJitsi);
		if (!shouldFocusJitsi) {
			setJitsiHeight(getPreferredJitsiHeight());
		}
	};

	useEffect(() => {
		if (isPhaseChangedMessage(lastMessage)) {
			const timer = window.setTimeout(() => {
				const nextPhase = normalizeSessionPhase(lastMessage.phase);
				if (nextPhase) setCurrentPhase(nextPhase);
				setTimerEndTime(lastMessage.end_time_ms || 0);
			}, 0);
			return () => window.clearTimeout(timer);
		}

		if (isCountdownChangedMessage(lastMessage)) {
			const timer = window.setTimeout(() => {
				const nextPhase = normalizeSessionPhase(lastMessage.current_phase);
				if (nextPhase) setCurrentPhase(nextPhase);
				setTimerEndTime(lastMessage.timer_end_time_ms ?? lastMessage.end_time_ms ?? 0);
			}, 0);
			return () => window.clearTimeout(timer);
		}

		if (isBoardStateMessage(lastMessage)) {
			let phaseTimer: number | null = null;
			const timerEndTimeMs = lastMessage.timer_end_time_ms;
			if (lastMessage.current_phase || typeof timerEndTimeMs === "number") {
				phaseTimer = window.setTimeout(() => {
					const nextPhase = normalizeSessionPhase(lastMessage.current_phase);
					if (nextPhase) setCurrentPhase(nextPhase);
					if (typeof timerEndTimeMs === "number") setTimerEndTime(timerEndTimeMs);
				}, 0);
			}

			const publicRanking = lastMessage.public_ranking ?? (lastMessage.ranking ? { revision: lastMessage.revision, items: lastMessage.ranking.items } : null);
			const privateRanking = lastMessage.private_ranking;
			if (isTaskConfigItemList(lastMessage.ranking_items)) {
				const nextTaskItems = lastMessage.ranking_items;
				const nextTaskItemsById = Object.fromEntries(nextTaskItems.map(item => [item.id, item]));
				const nextDefaultItemIds = nextTaskItems.map(item => item.id);
				const rankingItemsTimer = window.setTimeout(() => {
					setTaskItems(nextTaskItems);
					if (publicRanking) {
						setPublicRankingRevision(publicRanking.revision);
						setPublicItems(createRankedItems(publicRanking.items, nextTaskItemsById, nextDefaultItemIds));
						setPublicRankingChangeCount(publicRanking.change_count);
					}
					if (privateRanking) {
						setPrivateRankingRevision(privateRanking.revision);
						setPrivateItems(createRankedItems(privateRanking.items, nextTaskItemsById, nextDefaultItemIds));
						setPrivateRankingChangeCount(privateRanking.change_count);
					}
				}, 0);
				return () => {
					if (phaseTimer !== null) {
						window.clearTimeout(phaseTimer);
					}
					window.clearTimeout(rankingItemsTimer);
				};
			}
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
				items: lastMessage.items,
				change_count: lastMessage.change_count
			};
			if (isDraggingRef.current[scope]) {
				pendingRankingRef.current[scope] = nextRanking;
				return;
			}
			applyRankingSnapshot(scope, nextRanking);
		}
	}, [applyRankingSnapshot, lastMessage]);

	const privateBoardUnreadCount = privateBoardIdeaBlockUnreadState.count;
	const privateBoardUnreadCountLabel = formatUnreadCount(privateBoardUnreadCount);

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
			className="grid min-h-[100dvh] grid-cols-1 gap-4 bg-background p-4 text-foreground xl:h-[100dvh] xl:max-h-[100dvh] xl:grid-cols-[minmax(0,1fr)_var(--private-board-width)] xl:overflow-hidden"
			style={meetingLayoutStyle}
		>
			{resizeCursor && <div className="fixed inset-0 z-50 touch-none select-none" style={{ cursor: resizeCursor }} />}
			<section className="grid min-w-0 grid-rows-[minmax(0,1fr)_auto_var(--jitsi-height)_2.5rem] gap-y-0.5 text-card-foreground xl:min-h-0">
				<TaskWorkspace
					currentPhase={currentPhase}
					taskTitle={taskTitle}
					taskDetail={taskDetail}
					referenceImageSrc={taskReferenceImageSrc}
					referenceImageAlt={taskReferenceImageAlt}
					sessionId={sessionId}
					participantId={participantId}
					taskId={taskId}
					phase1Builder={phase1BuilderConfig}
					phaseLayoutConfig={phaseLayoutConfigById[currentPhase]}
					renderPublicRanking={() => (
						<LostAtSeaRankingPanel
							scope="public"
							title="Public 排序"
							status="協作中"
							items={publicItems}
							sensors={sensors}
							onDragStart={() => {
								isDraggingRef.current.public = true;
							}}
							onDragCancel={() => handleRankingDragCancel("public")}
							onDragEnd={event => handleRankingDragEnd("public", event)}
							showImages={taskId !== "enhance-the-poster"}
							onPreviewItem={setPreviewItem}
							rankingLimit={publicRankingLimit}
							changeCount={publicChangeCount}
							scrollContainerRef={publicRankingScrollRef}
						/>
					)}
					renderPrivateRanking={() => (
						<LostAtSeaRankingPanel
							scope="private"
							title="Private 排序"
							status={`${displayName} (${participantId})`}
							items={privateItems}
							sensors={sensors}
							onDragStart={() => {
								isDraggingRef.current.private = true;
							}}
							onDragCancel={() => handleRankingDragCancel("private")}
							onDragEnd={event => handleRankingDragEnd("private", event)}
							showImages={taskId !== "enhance-the-poster"}
							onPreviewItem={setPreviewItem}
							rankingLimit={privateRankingLimit}
							changeCount={privateChangeCount}
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

				<div
					className={cn(
						"relative min-h-0 overflow-hidden bg-muted",
						!isJitsiFocused && "rounded-lg border",
						isJitsiFocused && "fixed inset-0 z-[70] h-[100dvh] w-[100vw] bg-black",
						isJitsiCollapsed && !isJitsiFocused && "border-transparent bg-transparent"
					)}
					role={isJitsiFocused ? "dialog" : undefined}
					aria-label={isJitsiFocused ? "Jitsi 放大模式" : undefined}
					aria-modal={isJitsiFocused ? "true" : undefined}
				>
					<div className={cn("absolute inset-0", isJitsiCollapsed && "pointer-events-none opacity-0")}>
						<JitsiRoom
							meetingDomain={jitsiBaseUrl}
							roomName={roomName}
							displayName={displayName}
							micMode={micMode}
							allowInteraction={isJitsiFocused}
							onStatusChange={handleJitsiStatusChange}
							onAudioParticipantsChange={handleJitsiAudioParticipantsChange}
						/>
					</div>
					{!isJitsiCollapsed && (
						<>
							{!isJitsiFocused && (
								<Button
									type="button"
									variant="outline"
									size="icon"
									className="absolute left-2 top-2 z-40 h-8 w-8 bg-background/90 shadow-sm backdrop-blur"
									aria-label="收合 Jitsi"
									title="收合 Jitsi"
									aria-expanded="true"
									onClick={() => {
										setIsJitsiFocused(false);
										setIsJitsiCollapsed(true);
									}}
								>
									<ChevronDown className="h-4 w-4" />
								</Button>
							)}
							<Button
								type="button"
								variant="outline"
								size="icon"
								className="absolute right-2 top-2 z-40 h-8 w-8 bg-background/90 shadow-sm backdrop-blur"
								aria-label={isJitsiFocused ? "退出 Jitsi 放大模式" : "放大 Jitsi"}
								title={isJitsiFocused ? "退出 Jitsi 放大模式" : "放大 Jitsi"}
								aria-pressed={isJitsiFocused}
								onClick={handleJitsiFocusToggle}
							>
								{isJitsiFocused ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}
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
								type="button"
								variant={micMode === "public" ? "destructive" : "outline"}
								className={cn("gap-2", micMode !== "public" && "border-destructive bg-background/90 text-destructive hover:bg-destructive/10 hover:text-destructive")}
								aria-pressed={micMode === "public"}
								aria-label={publicMicToggleLabel}
								title={publicMicToggleLabel}
								onClick={handlePublicMicActivation}
							>
								<Mic className="h-4 w-4" />
								公開麥克風
								<ShortcutKey label="Space" />
							</Button>
							<Button type="button" className="bg-background/90" variant={micMode === "private" ? "default" : "outline"} aria-pressed={micMode === "private"} onClick={() => void handleMic("private")}>
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
							type="button"
							variant={micMode === "public" ? "destructive" : "outline"}
							className={cn("h-9 gap-2 px-4 text-sm", micMode !== "public" && "border-destructive text-destructive hover:bg-destructive/10 hover:text-destructive")}
							aria-pressed={micMode === "public"}
							aria-label={publicMicToggleLabel}
							title={publicMicToggleLabel}
							onClick={handlePublicMicActivation}
						>
							<Mic className="h-4 w-4" />
							公開發言
							<ShortcutKey label="Space" />
						</Button>
						<Button
							type="button"
							className="h-9 gap-2 px-4 text-sm"
							variant={micMode === "private" ? "default" : "outline"}
							aria-pressed={micMode === "private"}
							onClick={() => void handleMic("private")}
						>
							<Radio className="h-4 w-4" />
							<span className="text-sm">悄悄話</span>
						</Button>
					</div>
					{hasAudioConnectionError && (
						<div
							className="absolute right-0 top-10 z-30 flex max-w-[min(30rem,calc(100vw-2rem))] items-center gap-2 rounded-md border border-destructive/30 bg-background px-3 py-2 text-xs text-destructive shadow-md"
							role="alert"
						>
							<AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
							<span className="min-w-0 flex-1 text-left leading-snug">{audioError}</span>
							<Button
								type="button"
								variant="outline"
								size="sm"
								className="h-7 shrink-0 border-destructive/30 px-2 text-destructive hover:bg-destructive/10 hover:text-destructive"
								onClick={handleAudioReconnect}
							>
								重新連線音訊
							</Button>
						</div>
					)}
					{isJitsiCollapsed && (
						<Button
							type="button"
							variant="outline"
							size="icon"
							className="absolute bottom-9 left-0 z-20 h-8 w-8 bg-background/90 shadow-sm backdrop-blur"
							aria-label="展開 Jitsi"
							title="展開 Jitsi"
							aria-expanded="false"
							onClick={() => {
								setIsJitsiFocused(false);
								setIsJitsiCollapsed(false);
								setJitsiHeight(getPreferredJitsiHeight());
							}}
						>
							<ChevronUp className="h-4 w-4" />
						</Button>
					)}
					<div className="absolute bottom-0 left-0 flex w-[calc(50%-9rem)] min-w-0 max-w-[13.5rem] items-center sm:w-[calc(50%-8.5rem)]">
						<JitsiAudioIndicator snapshot={displayedJitsiAudioSnapshot} />
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

			{previewItem && taskId !== "enhance-the-poster" && (
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

			<aside className="relative min-h-0 min-w-0 xl:min-w-[var(--private-board-width)]">
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
					<div className="absolute -right-2 top-3 z-20 grid justify-items-end gap-2">
						<Button
							type="button"
							variant="outline"
							size="icon"
							className="h-8 w-8 shadow-sm"
							aria-label="展開 Private Board"
							title="展開 Private Board"
							aria-expanded="false"
							onClick={openPrivateBoard}
						>
							<ChevronLeft className="h-4 w-4" />
						</Button>
						{privateBoardUnreadCount > 0 && (
							<Button
								type="button"
								variant="destructive"
								size="sm"
								className="h-8 min-w-8 gap-1 rounded-full px-2 text-xs font-semibold shadow-sm"
								aria-label={`${privateBoardUnreadCount} 個新的 Idea Blocks，開啟最新項目`}
								title="開啟新的 Idea Blocks"
								onClick={openUnreadIdeaBlocks}
							>
								<Bell className="h-3.5 w-3.5" />
								{privateBoardUnreadCountLabel}
							</Button>
						)}
					</div>
				)}
				<div className={cn("h-full", isPrivateBoardCollapsed && "hidden")}>
					<PrivateBoard
						ref={privateBoardRef}
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
						isCollapsed={isPrivateBoardCollapsed}
						onRequestOpen={openPrivateBoard}
						onIdeaBlockUnreadStateChange={setPrivateBoardIdeaBlockUnreadState}
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
