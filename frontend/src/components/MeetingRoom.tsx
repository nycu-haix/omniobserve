import type { DragEndEvent } from "@dnd-kit/core";
import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Mic, MicOff, Radio } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useAudioStream } from "../hooks/useAudioStream";
import { useParticipantIdentity } from "../hooks/useParticipantIdentity";
import { usePresenceWebSocket } from "../hooks/usePresenceWebSocket";
import { useWebSocket } from "../hooks/useWebSocket";
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

function isRankingStateMessage(message: object | null): message is { type: "ranking_state"; revision: number; items: string[] } {
	return !!message && "type" in message && message.type === "ranking_state" && "items" in message && Array.isArray(message.items);
}

function isBoardStateMessage(message: object | null): message is { type: "board_state"; revision: number; ranking: { items: string[] } } {
	return (
		!!message &&
		"type" in message &&
		message.type === "board_state" &&
		"ranking" in message &&
		typeof message.ranking === "object" &&
		message.ranking !== null &&
		"items" in message.ranking &&
		Array.isArray(message.ranking.items)
	);
}

function SortableLostAtSeaItem({ item }: { item: LostAtSeaItem }) {
	const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
		id: item.id
	});

	return (
		<div
			ref={setNodeRef}
			className={cn("flex min-h-10 cursor-grab select-none items-center gap-3 rounded-lg border bg-background px-3 py-2", isDragging && "opacity-50")}
			style={{
				transform: CSS.Transform.toString(transform),
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

export default function MeetingRoom() {
	const [micMode, setMicMode] = useState<MicMode>("off");
	const [items, setItems] = useState(INITIAL_ITEMS);
	const [rankingRevision, setRankingRevision] = useState(0);
	const isDraggingRef = useRef(false);
	const pendingRankingRef = useRef<{ revision: number; items: string[] } | null>(null);
	const { participantId, displayName, roomName } = useParticipantIdentity();
	const sessionId = roomName;
	const { sendMessage, lastMessage, isConnected } = useWebSocket(sessionId, participantId);
	const { isConnected: isPresenceConnected } = usePresenceWebSocket(sessionId, participantId);
	const { startAudioStream, stopAudioStream, isAudioStreaming, isAudioConnected, lastAudioMessage, audioError } = useAudioStream(sessionId, participantId, displayName);
	const sensors = useSensors(useSensor(PointerSensor), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
	const latestTranscript = typeof lastAudioMessage?.text === "string" ? lastAudioMessage.text : null;
	const audioStatusText = audioError ? `音訊錯誤：${audioError}` : isAudioConnected ? "音訊後端已連線" : isAudioStreaming ? "音訊串流啟動中" : "音訊串流未啟動";

	const handleMic = async (mode: MicMode) => {
		const nextMode = mode === "off" ? "off" : micMode === mode ? "off" : mode;

		setMicMode(nextMode);

		if (nextMode === "off") {
			stopAudioStream();
			return;
		}

		await startAudioStream(nextMode);
	};

	const handleDragEnd = (event: DragEndEvent) => {
		isDraggingRef.current = false;
		pendingRankingRef.current = null;

		const { active, over } = event;
		if (!over || active.id === over.id) {
			return;
		}

		const oldIndex = items.findIndex(item => item.id === active.id);
		const newIndex = items.findIndex(item => item.id === over.id);
		if (oldIndex < 0 || newIndex < 0) {
			return;
		}

		sendMessage({
			type: "ranking_move",
			itemId: String(active.id),
			toIndex: newIndex,
			baseRevision: rankingRevision
		});

		setItems(current => {
			const currentOldIndex = current.findIndex(item => item.id === active.id);
			const currentNewIndex = current.findIndex(item => item.id === over.id);
			if (currentOldIndex < 0 || currentNewIndex < 0) {
				return current;
			}
			return arrayMove(current, currentOldIndex, currentNewIndex).map((item, index) => ({
				...item,
				rank: index + 1
			}));
		});
	};

	useEffect(() => {
		if (isBoardStateMessage(lastMessage)) {
			const nextRanking = {
				revision: lastMessage.revision,
				items: lastMessage.ranking.items
			};
			if (isDraggingRef.current) {
				pendingRankingRef.current = nextRanking;
				return;
			}
			setRankingRevision(nextRanking.revision);
			setItems(createRankedItems(nextRanking.items));
			return;
		}

		if (isRankingStateMessage(lastMessage)) {
			const nextRanking = {
				revision: lastMessage.revision,
				items: lastMessage.items
			};
			if (isDraggingRef.current) {
				pendingRankingRef.current = nextRanking;
				return;
			}
			setRankingRevision(nextRanking.revision);
			setItems(createRankedItems(nextRanking.items));
		}
	}, [lastMessage]);

	return (
		<main className="grid min-h-screen grid-cols-1 gap-4 bg-background p-4 text-foreground xl:h-screen xl:overflow-hidden xl:grid-cols-[minmax(0,1fr)_560px]">
			<section className="grid min-w-0 grid-rows-[minmax(180px,1fr)_minmax(0,2fr)_auto] gap-3 rounded-lg border bg-card p-3 text-card-foreground xl:min-h-0">
				<div className="min-h-0 overflow-hidden rounded-lg border bg-muted">
					<JitsiRoom meetingDomain={jitsiBaseUrl} roomName={roomName} displayName={displayName} micMode={micMode} />
				</div>

				<section className="flex min-h-0 flex-col overflow-hidden rounded-lg border p-3" aria-label="Lost at sea ranking task">
					<header className="mb-3 flex shrink-0 items-center justify-between">
						<h2 className="text-base font-semibold">海上求生排序</h2>
						<span className="text-sm text-muted-foreground">協作中</span>
					</header>
					<DndContext
						sensors={sensors}
						collisionDetection={closestCenter}
						onDragStart={() => {
							isDraggingRef.current = true;
						}}
						onDragCancel={() => {
							isDraggingRef.current = false;
							if (pendingRankingRef.current) {
								setRankingRevision(pendingRankingRef.current.revision);
								setItems(createRankedItems(pendingRankingRef.current.items));
								pendingRankingRef.current = null;
							}
						}}
						onDragEnd={handleDragEnd}
					>
						<SortableContext items={items.map(item => item.id)} strategy={verticalListSortingStrategy}>
							<div className="grid min-h-0 flex-1 gap-2 overflow-y-auto pr-1">
								{items.map(item => (
									<SortableLostAtSeaItem key={item.id} item={item} />
								))}
							</div>
						</SortableContext>
					</DndContext>
				</section>

				<div className="grid gap-2">
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

					<div className="rounded-lg border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
						<div>{audioStatusText}</div>
						<div>Presence：{isPresenceConnected ? "已連線" : "未連線"}</div>
						{latestTranscript && <div className="mt-1 text-foreground">最新逐字稿：{latestTranscript}</div>}
					</div>
				</div>
			</section>

			<aside className="min-h-0">
				<PrivateBoard sessionId={sessionId} lastMessage={lastMessage} isConnected={isConnected} />
			</aside>
		</main>
	);
}
