import type { DragEndEvent } from "@dnd-kit/core";
import { DndContext, PointerSensor, useDraggable, useDroppable, useSensor, useSensors } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { ArrowDown, ArrowUp, Check, GripVertical, Pencil, Plus, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { cn } from "../lib/utils";
import {
	createPrivatePhaseTaskItem,
	deletePrivatePhaseTaskItem,
	fetchPrivatePhaseTaskItems,
	reorderPrivatePhaseTaskItems,
	updatePrivatePhaseTaskItem,
	type Phase1BuilderConfig,
	type Phase1BuilderOption,
	type PrivatePhaseTaskItem
} from "../services/api";
import { Button } from "./ui/Button";

interface PrivatePhaseTaskItemsPanelProps {
	sessionId: string;
	participantId: string;
	taskId?: string;
	builder: Phase1BuilderConfig;
}

interface PhaseTaskFormState {
	componentId: string;
	actionId: string;
	detail: string;
}

type KeywordKind = "component" | "action";

interface PhaseTaskKeywordDragData {
	kind: KeywordKind;
	id: string;
}

const COMPONENT_DROP_ID = "phase-task-component-drop";
const ACTION_DROP_ID = "phase-task-action-drop";

function createPhaseTaskForm(): PhaseTaskFormState {
	return {
		componentId: "",
		actionId: "",
		detail: ""
	};
}

function getParticipantUserId(participantId: string): number {
	const userId = Number(participantId);
	return Number.isInteger(userId) ? userId : 0;
}

function buildPhaseTaskStatement(component: Phase1BuilderOption | undefined, action: Phase1BuilderOption | undefined, detail: string): string {
	if (!component || !action) {
		return "";
	}

	const template = action.template_zh?.trim();
	const baseStatement = template ? template.replace("{component}", component.label_zh) : `${action.label_zh}「${component.label_zh}」`;
	const normalizedDetail = detail.trim();
	return normalizedDetail ? `${baseStatement}：${normalizedDetail}` : baseStatement;
}

function sortPrivatePhaseTaskItems(items: PrivatePhaseTaskItem[]): PrivatePhaseTaskItem[] {
	return [...items].sort((left, right) => left.priority - right.priority || left.id - right.id);
}

function reindexPrivatePhaseTaskItems(items: PrivatePhaseTaskItem[]): PrivatePhaseTaskItem[] {
	return sortPrivatePhaseTaskItems(items).map((item, index) => ({
		...item,
		priority: index + 1
	}));
}

function KeywordDropSlot({ id, label, selectedOption, isActive, onClear }: { id: string; label: string; selectedOption?: Phase1BuilderOption; isActive: boolean; onClear: () => void }) {
	const { isOver, setNodeRef } = useDroppable({ id });

	return (
		<div
			ref={setNodeRef}
			className={cn("grid min-h-24 gap-2 rounded-lg border border-dashed bg-card p-3 transition-colors", isOver && "border-primary bg-primary/5", isActive && "border-primary/60 bg-primary/5")}
		>
			<div className="flex items-center justify-between gap-2">
				<span className="text-xs font-semibold text-muted-foreground">{label}</span>
				{selectedOption && (
					<Button type="button" variant="ghost" size="icon" className="h-7 w-7 shrink-0" title="清除" aria-label={`清除${label}`} onClick={onClear}>
						<X className="h-3.5 w-3.5" />
					</Button>
				)}
			</div>
			{selectedOption ? (
				<div className="grid gap-1">
					<div className="break-words text-sm font-semibold leading-6">{selectedOption.label_zh}</div>
					{selectedOption.description_zh && <div className="break-words text-xs leading-5 text-muted-foreground">{selectedOption.description_zh}</div>}
				</div>
			) : (
				<div className="grid min-h-10 place-items-center rounded-md bg-muted/50 px-2 text-center text-sm text-muted-foreground">尚未選擇</div>
			)}
		</div>
	);
}

function KeywordChip({ kind, option, isSelected, onSelect }: { kind: KeywordKind; option: Phase1BuilderOption; isSelected: boolean; onSelect: () => void }) {
	const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
		id: `phase-task-keyword-${kind}-${option.id}`,
		data: {
			kind,
			id: option.id
		} satisfies PhaseTaskKeywordDragData
	});
	const style = {
		transform: CSS.Translate.toString(transform)
	};

	return (
		<button
			ref={setNodeRef}
			type="button"
			className={cn(
				"inline-flex min-h-9 min-w-0 items-center gap-2 rounded-md border bg-card px-2.5 py-1.5 text-left text-xs font-medium leading-5 shadow-sm transition hover:border-primary/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
				isSelected && "border-primary bg-primary/10 text-primary",
				isDragging && "opacity-60"
			)}
			style={style}
			onClick={onSelect}
			{...attributes}
			{...listeners}
		>
			<GripVertical className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
			<span className="min-w-0 break-words">{option.label_zh}</span>
		</button>
	);
}

function PrivatePhaseTaskItemRow({
	item,
	index,
	isFirst,
	isLast,
	isMoving,
	onMove,
	onEdit,
	onDelete
}: {
	item: PrivatePhaseTaskItem;
	index: number;
	isFirst: boolean;
	isLast: boolean;
	isMoving: boolean;
	onMove: (itemId: number, direction: -1 | 1) => void;
	onEdit: (item: PrivatePhaseTaskItem) => void;
	onDelete: (itemId: number) => void;
}) {
	return (
		<div className={cn("flex min-h-10 select-none items-center gap-3 rounded-lg border bg-background px-3 py-2 transition-colors", isMoving && "opacity-60")}>
			<div className="grid h-9 w-12 shrink-0 place-items-center overflow-hidden rounded-md border bg-muted px-1 text-center text-[10px] font-semibold uppercase leading-3 text-muted-foreground">
				TASK
			</div>
			<span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-muted text-xs font-semibold text-primary">{item.priority || index + 1}</span>
			<div className="grid min-w-0 flex-1 gap-0.5">
				<div className="break-words text-sm font-medium leading-6">{item.statement}</div>
				<div className="min-w-0 truncate text-xs text-muted-foreground">
					{item.component_label} / {item.action_label}
				</div>
			</div>
			<div className="flex shrink-0 items-center gap-1">
				<Button type="button" variant="ghost" size="icon" className="h-7 w-7" title="提高優先順序" aria-label="提高優先順序" disabled={isFirst || isMoving} onClick={() => onMove(item.id, -1)}>
					<ArrowUp className="h-4 w-4" />
				</Button>
				<Button type="button" variant="ghost" size="icon" className="h-7 w-7" title="降低優先順序" aria-label="降低優先順序" disabled={isLast || isMoving} onClick={() => onMove(item.id, 1)}>
					<ArrowDown className="h-4 w-4" />
				</Button>
				<Button type="button" variant="ghost" size="icon" className="h-7 w-7" title="編輯" aria-label="編輯" onClick={() => onEdit(item)}>
					<Pencil className="h-4 w-4" />
				</Button>
				<Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" title="刪除" aria-label="刪除" onClick={() => onDelete(item.id)}>
					<Trash2 className="h-4 w-4" />
				</Button>
				<GripVertical className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
			</div>
		</div>
	);
}

export function PrivatePhaseTaskItemsPanel({ sessionId, participantId, taskId, builder }: PrivatePhaseTaskItemsPanelProps) {
	const [items, setItems] = useState<PrivatePhaseTaskItem[]>([]);
	const [form, setForm] = useState<PhaseTaskFormState>(() => createPhaseTaskForm());
	const [editingItemId, setEditingItemId] = useState<number | null>(null);
	const [isLoading, setIsLoading] = useState(false);
	const [isSaving, setIsSaving] = useState(false);
	const [movingItemId, setMovingItemId] = useState<number | null>(null);
	const [error, setError] = useState<string | null>(null);
	const participantUserId = getParticipantUserId(participantId);
	const selectedComponent = builder.components.find(item => item.id === form.componentId);
	const selectedAction = builder.actions.find(item => item.id === form.actionId);
	const previewStatement = buildPhaseTaskStatement(selectedComponent, selectedAction, form.detail);
	const canSave = !!selectedComponent && !!selectedAction && !isSaving;
	const keywordSensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

	const resetForm = useCallback(() => {
		setForm(createPhaseTaskForm());
		setEditingItemId(null);
		setError(null);
	}, []);

	useEffect(() => {
		const timer = window.setTimeout(() => {
			setForm(current => {
				const hasComponent = builder.components.some(item => item.id === current.componentId);
				const hasAction = builder.actions.some(item => item.id === current.actionId);
				return {
					componentId: hasComponent ? current.componentId : "",
					actionId: hasAction ? current.actionId : "",
					detail: current.detail
				};
			});
		}, 0);
		return () => window.clearTimeout(timer);
	}, [builder]);

	useEffect(() => {
		const controller = new AbortController();
		const timer = window.setTimeout(() => {
			setIsLoading(true);
			setError(null);
			fetchPrivatePhaseTaskItems({
				sessionName: sessionId,
				userId: participantUserId,
				signal: controller.signal
			})
				.then(nextItems => setItems(sortPrivatePhaseTaskItems(nextItems)))
				.catch(loadError => {
					if (loadError instanceof DOMException && loadError.name === "AbortError") {
						return;
					}
					setError(loadError instanceof Error ? loadError.message : "Task items 載入失敗");
				})
				.finally(() => {
					if (!controller.signal.aborted) {
						setIsLoading(false);
					}
				});
		}, 0);

		return () => {
			window.clearTimeout(timer);
			controller.abort();
		};
	}, [participantUserId, sessionId]);

	const saveTaskItem = async () => {
		if (!selectedComponent || !selectedAction) {
			return;
		}

		setIsSaving(true);
		setError(null);
		try {
			if (editingItemId !== null) {
				const updatedItem = await updatePrivatePhaseTaskItem(sessionId, participantUserId, editingItemId, {
					component_id: selectedComponent.id,
					action_id: selectedAction.id,
					detail: form.detail
				});
				setItems(current => sortPrivatePhaseTaskItems(current.map(item => (item.id === updatedItem.id ? updatedItem : item))));
			} else {
				const createdItem = await createPrivatePhaseTaskItem(sessionId, participantUserId, {
					task_id: taskId,
					component_id: selectedComponent.id,
					action_id: selectedAction.id,
					detail: form.detail
				});
				setItems(current => sortPrivatePhaseTaskItems([...current, createdItem]));
			}
			resetForm();
		} catch (saveError) {
			setError(saveError instanceof Error ? saveError.message : "Task item 儲存失敗");
		} finally {
			setIsSaving(false);
		}
	};

	const selectKeyword = (kind: KeywordKind, id: string) => {
		setForm(current => ({
			...current,
			componentId: kind === "component" ? id : current.componentId,
			actionId: kind === "action" ? id : current.actionId
		}));
		setError(null);
	};

	const handleKeywordDragEnd = (event: DragEndEvent) => {
		const dragData = event.active.data.current as PhaseTaskKeywordDragData | undefined;
		const dropId = event.over?.id;
		if (!dragData || !dropId) {
			return;
		}

		if (dragData.kind === "component" && dropId === COMPONENT_DROP_ID) {
			selectKeyword("component", dragData.id);
			return;
		}

		if (dragData.kind === "action" && dropId === ACTION_DROP_ID) {
			selectKeyword("action", dragData.id);
		}
	};

	const editTaskItem = (item: PrivatePhaseTaskItem) => {
		setEditingItemId(item.id);
		setForm({
			componentId: item.component_id,
			actionId: item.action_id,
			detail: item.detail
		});
		setError(null);
	};

	const deleteTaskItem = async (itemId: number) => {
		const previousItems = items;
		setItems(current => reindexPrivatePhaseTaskItems(current.filter(item => item.id !== itemId)));
		if (editingItemId === itemId) {
			resetForm();
		}
		setError(null);
		try {
			await deletePrivatePhaseTaskItem(sessionId, participantUserId, itemId);
		} catch (deleteError) {
			setItems(previousItems);
			setError(deleteError instanceof Error ? deleteError.message : "Task item 刪除失敗");
		}
	};

	const moveTaskItem = async (itemId: number, direction: -1 | 1) => {
		const currentItems = sortPrivatePhaseTaskItems(items);
		const currentIndex = currentItems.findIndex(item => item.id === itemId);
		const nextIndex = currentIndex + direction;
		if (currentIndex < 0 || nextIndex < 0 || nextIndex >= currentItems.length) {
			return;
		}

		const nextItems = [...currentItems];
		const [movedItem] = nextItems.splice(currentIndex, 1);
		nextItems.splice(nextIndex, 0, movedItem);
		const reindexedItems = nextItems.map((item, index) => ({ ...item, priority: index + 1 }));
		setItems(reindexedItems);
		setMovingItemId(itemId);
		setError(null);
		try {
			const savedItems = await reorderPrivatePhaseTaskItems(
				sessionId,
				participantUserId,
				reindexedItems.map(item => item.id)
			);
			setItems(sortPrivatePhaseTaskItems(savedItems));
		} catch (moveError) {
			setItems(currentItems);
			setError(moveError instanceof Error ? moveError.message : "Task item 排序失敗");
		} finally {
			setMovingItemId(null);
		}
	};

	return (
		<section className="grid h-full min-h-0 content-start gap-4 overflow-y-auto pr-1" aria-label="Private Phase 1 task items">
			<div className="grid gap-3 rounded-md border bg-background p-3" aria-label="建立 Private Phase 1 task item">
				<DndContext sensors={keywordSensors} onDragEnd={handleKeywordDragEnd}>
					<div className="grid gap-3 sm:grid-cols-2">
						<KeywordDropSlot
							id={COMPONENT_DROP_ID}
							label="海報元件"
							selectedOption={selectedComponent}
							isActive={!!selectedComponent}
							onClear={() => {
								setForm(current => ({ ...current, componentId: "" }));
								setError(null);
							}}
						/>
						<KeywordDropSlot
							id={ACTION_DROP_ID}
							label="改善動作"
							selectedOption={selectedAction}
							isActive={!!selectedAction}
							onClear={() => {
								setForm(current => ({ ...current, actionId: "" }));
								setError(null);
							}}
						/>
					</div>
					<label className="grid gap-1 text-sm font-medium">
						<span>補充條件</span>
						<textarea
							className="min-h-20 resize-y rounded-md border bg-card px-3 py-2 text-sm leading-6 outline-none focus:ring-1 focus:ring-ring"
							placeholder={builder.detail_placeholder || "補充限制或目標"}
							value={form.detail}
							maxLength={280}
							onChange={event => {
								setForm(current => ({ ...current, detail: event.target.value }));
								setError(null);
							}}
						/>
					</label>
					<div className="flex flex-col gap-2 sm:flex-row sm:items-center">
						<div className="min-w-0 flex-1 rounded-md bg-muted px-3 py-2 text-sm leading-6 text-foreground">
							<span className="break-words">{previewStatement || "尚未建立 task item"}</span>
						</div>
						<div className="flex shrink-0 gap-2">
							{editingItemId !== null && (
								<Button type="button" variant="outline" size="icon" className="h-10 w-10" title="取消編輯" aria-label="取消編輯" onClick={resetForm}>
									<X className="h-4 w-4" />
								</Button>
							)}
							<Button type="button" className="h-10 gap-2 px-3" disabled={!canSave} onClick={() => void saveTaskItem()}>
								{editingItemId !== null ? <Check className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
								{isSaving ? "儲存中" : editingItemId !== null ? "更新" : "新增"}
							</Button>
						</div>
					</div>
					<div className="grid gap-3 rounded-md bg-muted/40 p-3" aria-label="Keyword Pool">
						<div className="text-xs font-semibold text-muted-foreground">Keyword Pool</div>
						<div className="grid gap-2">
							<div className="text-xs font-medium text-muted-foreground">海報元件</div>
							<div className="flex flex-wrap gap-2">
								{builder.components.map(component => (
									<KeywordChip key={component.id} kind="component" option={component} isSelected={component.id === form.componentId} onSelect={() => selectKeyword("component", component.id)} />
								))}
							</div>
						</div>
						<div className="grid gap-2">
							<div className="text-xs font-medium text-muted-foreground">改善動作</div>
							<div className="flex flex-wrap gap-2">
								{builder.actions.map(action => (
									<KeywordChip key={action.id} kind="action" option={action} isSelected={action.id === form.actionId} onSelect={() => selectKeyword("action", action.id)} />
								))}
							</div>
						</div>
					</div>
				</DndContext>
				{error && <p className="text-xs text-destructive">{error}</p>}
			</div>

			<div className="grid gap-2" aria-label="Private Phase 1 priority list">
				<div className="flex items-center justify-between gap-3">
					<h3 className="text-sm font-semibold">優先改善 Task Items</h3>
					<span className="rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground">{items.length}</span>
				</div>
				{isLoading && <div className="grid min-h-24 place-items-center rounded-lg border border-dashed text-sm text-muted-foreground">載入中</div>}
				{!isLoading && items.length === 0 && <div className="grid min-h-32 place-items-center rounded-lg border border-dashed text-sm text-muted-foreground">尚無 task items</div>}
				{!isLoading &&
					sortPrivatePhaseTaskItems(items).map((item, index, sortedItems) => (
						<PrivatePhaseTaskItemRow
							key={item.id}
							item={item}
							index={index}
							isFirst={index === 0}
							isLast={index === sortedItems.length - 1}
							isMoving={movingItemId === item.id}
							onMove={(itemId, direction) => void moveTaskItem(itemId, direction)}
							onEdit={editTaskItem}
							onDelete={itemId => void deleteTaskItem(itemId)}
						/>
					))}
			</div>
		</section>
	);
}
