import type { DragEndEvent } from "@dnd-kit/core";
import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Mic, MicOff, Radio } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useParticipantIdentity } from "../hooks/useParticipantIdentity";
import { useWebSocket } from "../hooks/useWebSocket";
import { cn } from "../lib/utils";
import type { MicMode } from "../types";
import { JitsiRoom } from "./JitsiRoom";
import { PrivateBoard } from "./private-board/PrivateBoard";
import { Button } from "./ui/Button";

interface SurvivalItem {
	id: string;
	label: string;
	rank: number;
}

const INITIAL_ITEMS: SurvivalItem[] = [
	{ id: "oxygen", label: "氧氣筒", rank: 1 },
	{ id: "water", label: "水", rank: 2 },
	{ id: "map", label: "星圖", rank: 3 },
	{ id: "radio", label: "無線電", rank: 4 },
	{ id: "food", label: "濃縮食物", rank: 5 }
];

const jitsiBaseUrl = import.meta.env.VITE_JITSI_BASE_URL || "https://meet.omni.elvismao.com";

const ITEM_LABELS = INITIAL_ITEMS.reduce<Record<string, string>>((labels, item) => {
	labels[item.id] = item.label;
	return labels;
}, {});

function createRankedItems(itemIds: string[]): SurvivalItem[] {
	return itemIds.map((id, index) => ({
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

function SortableSurvivalItem({ item }: { item: SurvivalItem }) {
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
	const sensors = useSensors(useSensor(PointerSensor), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));

	const handleMic = (mode: MicMode) => {
		setMicMode(current => (current === mode ? "off" : mode));
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
		<main className="grid min-h-screen grid-cols-1 gap-4 bg-background p-4 text-foreground xl:grid-cols-[minmax(0,1fr)_560px]">
			<section className="grid min-w-0 grid-rows-[minmax(320px,1fr)_auto_auto] gap-3 rounded-lg border bg-card p-3 text-card-foreground">
				<div className="min-h-0 overflow-hidden rounded-lg border bg-muted">
					<JitsiRoom meetingDomain={jitsiBaseUrl} roomName={roomName} displayName={displayName} micMode={micMode} />
				</div>

				<section className="min-h-[260px] rounded-lg border p-3" aria-label="Survival ranking task">
					<header className="mb-3 flex items-center justify-between">
						<h2 className="text-base font-semibold">月球生存排序</h2>
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
							<div className="grid gap-2">
								{items.map(item => (
									<SortableSurvivalItem key={item.id} item={item} />
								))}
							</div>
						</SortableContext>
					</DndContext>
				</section>

				<div className="flex flex-wrap items-center justify-center gap-2">
					<Button variant={micMode === "public" ? "default" : "outline"} onClick={() => handleMic("public")}>
						<Mic className="h-4 w-4" />
						公開麥克風
					</Button>
					<Button variant={micMode === "private" ? "default" : "outline"} onClick={() => handleMic("private")}>
						<Radio className="h-4 w-4" />
						私人錄音
					</Button>
					<Button variant="secondary" onClick={() => handleMic("off")}>
						<MicOff className="h-4 w-4" />
						靜音
					</Button>
				</div>
			</section>

			<aside className="min-h-0">
				<PrivateBoard roomId={sessionId} lastMessage={lastMessage} isConnected={isConnected} />
			</aside>
		</main>
	);
}
