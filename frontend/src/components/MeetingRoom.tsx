import { useState } from "react";
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import type { DragEndEvent } from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Mic, MicOff, Radio } from "lucide-react";
import { Button } from "./ui/Button";
import { PrivateBoard } from "./private-board/PrivateBoard";
import { cn } from "../lib/utils";
import type { MicMode } from "../types";

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
  { id: "food", label: "濃縮食物", rank: 5 },
];

function SortableSurvivalItem({ item }: { item: SurvivalItem }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
  });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex min-h-10 cursor-grab select-none items-center gap-3 rounded-lg border bg-background px-3 py-2",
        isDragging && "opacity-50",
      )}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
      }}
      {...attributes}
      {...listeners}
    >
      <span className="grid h-6 w-6 place-items-center rounded-full bg-muted text-xs font-semibold text-primary">
        {item.rank}
      </span>
      <span className="min-w-0 flex-1">{item.label}</span>
      <GripVertical className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
    </div>
  );
}

export default function MeetingRoom() {
  const [micMode, setMicMode] = useState<MicMode>("off");
  const [items, setItems] = useState(INITIAL_ITEMS);
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleMic = (mode: MicMode) => {
    setMicMode((current) => (current === mode ? "off" : mode));
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) {
      return;
    }

    setItems((current) => {
      const oldIndex = current.findIndex((item) => item.id === active.id);
      const newIndex = current.findIndex((item) => item.id === over.id);
      return arrayMove(current, oldIndex, newIndex).map((item, index) => ({
        ...item,
        rank: index + 1,
      }));
    });
  };

  return (
    <main className="grid min-h-screen grid-cols-1 gap-4 bg-background p-4 text-foreground xl:grid-cols-[minmax(0,1fr)_560px]">
      <section className="grid min-w-0 grid-rows-[minmax(320px,1fr)_auto_auto] gap-3 rounded-lg border bg-card p-3 text-card-foreground">
        <div className="min-h-0 overflow-hidden rounded-lg border bg-muted">
          <div className="grid h-full min-h-[320px] place-items-center text-muted-foreground">
            <div className="text-center">
              <div className="text-lg font-semibold text-foreground">Public Meeting</div>
              <div className="text-sm">Jitsi iframe placeholder</div>
            </div>
          </div>
        </div>

        <section className="min-h-[260px] rounded-lg border p-3" aria-label="Survival ranking task">
          <header className="mb-3 flex items-center justify-between">
            <h2 className="text-base font-semibold">月球生存排序</h2>
            <span className="text-sm text-muted-foreground">協作中</span>
          </header>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={items.map((item) => item.id)} strategy={verticalListSortingStrategy}>
              <div className="grid gap-2">
                {items.map((item) => (
                  <SortableSurvivalItem key={item.id} item={item} />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        </section>

        <div className="flex flex-wrap items-center justify-center gap-2">
          <Button
            variant={micMode === "public" ? "default" : "outline"}
            onClick={() => handleMic("public")}
          >
            <Mic className="h-4 w-4" />
            公開麥克風
          </Button>
          <Button
            variant={micMode === "private" ? "default" : "outline"}
            onClick={() => handleMic("private")}
          >
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
        <PrivateBoard roomId="mars-survival-001" />
      </aside>
    </main>
  );
}
