import { ArrowDown, ArrowUp, Check, Pencil, Plus, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { getPrivatePhaseTaskItemActionLabel, reindexPrivatePhaseTaskItems, sortPrivatePhaseTaskItems } from "../lib/privatePhaseTaskItems";
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

function buildPhaseTaskStatement(component: Phase1BuilderOption | undefined, action: Phase1BuilderOption | undefined, detail = ""): string {
	if (!component || !action) {
		return "";
	}

	const template = action.template_zh?.trim();
	const normalizedDetail = detail.trim();
	const hasDetailPlaceholder = !!template?.includes("{detail}");
	const statement = template ? template.replace("{component}", component.label_zh).replace("{detail}", normalizedDetail).trim() : `${action.label_zh}「${component.label_zh}」`;
	return normalizedDetail && !hasDetailPlaceholder ? `${statement}：${normalizedDetail}` : statement;
}

function getAllowedActionsForComponent(component: Phase1BuilderOption | undefined, actions: Phase1BuilderOption[]): Phase1BuilderOption[] {
	if (!component) {
		return [];
	}

	if (!component.allowed_action_ids) {
		return actions;
	}

	const allowedActionIds = new Set(component.allowed_action_ids);
	return actions.filter(action => allowedActionIds.has(action.id));
}

function getDetailInputKind(action: Phase1BuilderOption | undefined): string {
	return action?.detail_input?.kind ?? "";
}

function isLibraryNumberAction(action: Phase1BuilderOption | undefined): boolean {
	return getDetailInputKind(action) === "library_number";
}

function normalizeLibraryNumberDetail(value: string): string {
	const trimmed = value.trim();
	if (!/^0*[1-9]\d*$/.test(trimmed)) {
		return "";
	}
	return trimmed.replace(/^0+/, "");
}

function normalizeDetailForAction(action: Phase1BuilderOption | undefined, value: string): string {
	if (!action?.requires_detail) {
		return "";
	}
	if (isLibraryNumberAction(action)) {
		return normalizeLibraryNumberDetail(value);
	}
	return value.trim();
}

function shouldKeepDetailForActionChange(currentAction: Phase1BuilderOption | undefined, nextAction: Phase1BuilderOption | undefined): boolean {
	if (!nextAction?.requires_detail) {
		return false;
	}
	if (currentAction?.id === nextAction.id) {
		return true;
	}
	return getDetailInputKind(currentAction) === getDetailInputKind(nextAction);
}

function minimumItemCount(builder: Phase1BuilderConfig): number {
	const configuredMinimum = Number(builder.minimum_items);
	return Number.isFinite(configuredMinimum) && configuredMinimum > 0 ? Math.floor(configuredMinimum) : 4;
}

function PhaseTaskItemThresholdSeparator({ label }: { label: string }) {
	return (
		<div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 py-1 text-xs font-medium text-muted-foreground">
			<span className="h-px bg-border" />
			<span className="max-w-[min(28rem,70vw)] rounded-full border bg-background px-3 py-1 text-center leading-5">{label}</span>
			<span className="h-px bg-border" />
		</div>
	);
}

function KeywordDropSlot({ label, selectedOption, isActive, onClear }: { label: string; selectedOption?: Phase1BuilderOption; isActive: boolean; onClear: () => void }) {
	return (
		<div className={cn("flex min-h-12 items-center justify-between gap-3 rounded-md border border-dashed bg-card px-3 py-2 transition-colors", isActive && "border-primary/60 bg-primary/5")}>
			<div className="flex min-w-0 items-baseline gap-2">
				<span className="shrink-0 text-xs font-semibold text-muted-foreground">{label}</span>
				{selectedOption ? (
					<span className="min-w-0 truncate text-sm font-semibold leading-6">{selectedOption.label_zh}</span>
				) : (
					<span className="text-sm leading-6 text-muted-foreground">尚未選擇</span>
				)}
			</div>
			{selectedOption && (
				<Button type="button" variant="ghost" size="icon" className="h-7 w-7 shrink-0" title="清除" aria-label={`清除${label}`} onClick={onClear}>
					<X className="h-3.5 w-3.5" />
				</Button>
			)}
		</div>
	);
}

function KeywordChip({ kind, option, isSelected, onSelect }: { kind: KeywordKind; option: Phase1BuilderOption; isSelected: boolean; onSelect: () => void }) {
	return (
		<button
			type="button"
			className={cn(
				"inline-flex min-h-9 min-w-0 items-center rounded-md border bg-card px-2.5 py-1.5 text-left text-xs font-medium leading-5 shadow-sm transition hover:border-primary/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
				isSelected && "border-primary bg-primary/10 text-primary"
			)}
			onClick={onSelect}
			aria-pressed={isSelected}
			aria-label={`選擇${kind === "component" ? "海報元件" : "改善動作"}：${option.label_zh}`}
		>
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
	isDeleting,
	onMove,
	onEdit,
	onDelete
}: {
	item: PrivatePhaseTaskItem;
	index: number;
	isFirst: boolean;
	isLast: boolean;
	isMoving: boolean;
	isDeleting: boolean;
	onMove: (itemId: number, direction: -1 | 1) => void;
	onEdit: (item: PrivatePhaseTaskItem) => void;
	onDelete: (itemId: number) => void;
}) {
	const upLabel = getPrivatePhaseTaskItemActionLabel("提高優先順序：", item, index);
	const downLabel = getPrivatePhaseTaskItemActionLabel("降低優先順序：", item, index);
	const editLabel = getPrivatePhaseTaskItemActionLabel("編輯", item, index);
	const deleteLabel = getPrivatePhaseTaskItemActionLabel("刪除", item, index);

	return (
		<div className={cn("flex min-h-10 select-none items-center gap-3 rounded-lg border bg-background px-3 py-2 transition-colors", (isMoving || isDeleting) && "opacity-60")}>
			<span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-muted text-xs font-semibold text-primary">{item.priority || index + 1}</span>
			<div className="grid min-w-0 flex-1 gap-0.5">
				<div className="break-words text-sm font-medium leading-6">{item.statement}</div>
				<div className="min-w-0 truncate text-xs text-muted-foreground">
					{item.component_label} / {item.action_label}
				</div>
			</div>
			<div className="flex shrink-0 items-center gap-1">
				<Button type="button" variant="ghost" size="icon" className="h-7 w-7" title={upLabel} aria-label={upLabel} disabled={isFirst || isMoving || isDeleting} onClick={() => onMove(item.id, -1)}>
					<ArrowUp className="h-4 w-4" />
				</Button>
				<Button type="button" variant="ghost" size="icon" className="h-7 w-7" title={downLabel} aria-label={downLabel} disabled={isLast || isMoving || isDeleting} onClick={() => onMove(item.id, 1)}>
					<ArrowDown className="h-4 w-4" />
				</Button>
				<Button type="button" variant="ghost" size="icon" className="h-7 w-7" title={editLabel} aria-label={editLabel} disabled={isMoving || isDeleting} onClick={() => onEdit(item)}>
					<Pencil className="h-4 w-4" />
				</Button>
				<Button type="button" variant="ghost" size="icon" className="h-7 w-7" title={deleteLabel} aria-label={deleteLabel} disabled={isMoving || isDeleting} onClick={() => onDelete(item.id)}>
					<Trash2 className="h-4 w-4" />
				</Button>
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
	const [deletingItemId, setDeletingItemId] = useState<number | null>(null);
	const [error, setError] = useState<string | null>(null);
	const participantUserId = getParticipantUserId(participantId);
	const selectedComponent = builder.components.find(item => item.id === form.componentId);
	const availableActions = getAllowedActionsForComponent(selectedComponent, builder.actions);
	const selectedAction = availableActions.find(item => item.id === form.actionId);
	const selectedActionRequiresDetail = !!selectedAction?.requires_detail;
	const selectedActionUsesLibraryNumber = isLibraryNumberAction(selectedAction);
	const normalizedDetail = normalizeDetailForAction(selectedAction, form.detail);
	const hasDetailValue = form.detail.trim().length > 0;
	const isLibraryNumberInvalid = selectedActionUsesLibraryNumber && hasDetailValue && normalizedDetail.length === 0;
	const previewStatement = buildPhaseTaskStatement(selectedComponent, selectedAction, selectedActionRequiresDetail ? normalizedDetail : "");
	const isDeletingTaskItem = deletingItemId !== null;
	const canSave = !!selectedComponent && !!selectedAction && (!selectedActionRequiresDetail || normalizedDetail.length > 0) && !isSaving && !isDeletingTaskItem;
	const requiredItemCount = minimumItemCount(builder);
	const editingItem = editingItemId === null ? undefined : items.find(item => item.id === editingItemId);
	const canDeleteEditingItem = !!editingItem && !isDeletingTaskItem && !isSaving;

	const resetForm = useCallback(() => {
		setForm(createPhaseTaskForm());
		setEditingItemId(null);
		setError(null);
	}, []);

	useEffect(() => {
		const timer = window.setTimeout(() => {
			setForm(current => {
				const component = builder.components.find(item => item.id === current.componentId);
				const availableActionsForComponent = getAllowedActionsForComponent(component, builder.actions);
				const action = availableActionsForComponent.find(item => item.id === current.actionId);
				return {
					componentId: component ? current.componentId : "",
					actionId: component && action ? current.actionId : "",
					detail: component && action?.requires_detail ? current.detail : ""
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
					setError(loadError instanceof Error ? loadError.message : "改善項目載入失敗");
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
			const detail = selectedActionRequiresDetail ? normalizedDetail : "";
			if (editingItemId !== null) {
				const updatedItem = await updatePrivatePhaseTaskItem(sessionId, participantUserId, editingItemId, {
					component_id: selectedComponent.id,
					action_id: selectedAction.id,
					detail
				});
				setItems(current => sortPrivatePhaseTaskItems(current.map(item => (item.id === updatedItem.id ? updatedItem : item))));
			} else {
				const createdItem = await createPrivatePhaseTaskItem(sessionId, participantUserId, {
					task_id: taskId,
					component_id: selectedComponent.id,
					action_id: selectedAction.id,
					detail
				});
				setItems(current => sortPrivatePhaseTaskItems([...current, createdItem]));
			}
			resetForm();
		} catch (saveError) {
			setError(saveError instanceof Error ? saveError.message : "改善項目儲存失敗");
		} finally {
			setIsSaving(false);
		}
	};

	const selectKeyword = (kind: KeywordKind, id: string) => {
		setForm(current => {
			if (kind === "component") {
				const component = builder.components.find(item => item.id === id);
				const availableActionsForComponent = getAllowedActionsForComponent(component, builder.actions);
				const action = availableActionsForComponent.find(action => action.id === current.actionId);
				const currentAction = availableActions.find(action => action.id === current.actionId);
				return {
					componentId: id,
					actionId: action ? current.actionId : "",
					detail: shouldKeepDetailForActionChange(currentAction, action) ? current.detail : ""
				};
			}

			const action = availableActions.find(action => action.id === id);
			const currentAction = availableActions.find(action => action.id === current.actionId);
			return {
				...current,
				actionId: id,
				detail: shouldKeepDetailForActionChange(currentAction, action) ? current.detail : ""
			};
		});
		setError(null);
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
		const deletedEditingItem = editingItemId === itemId ? items.find(item => item.id === itemId) : undefined;
		setDeletingItemId(itemId);
		setItems(current => reindexPrivatePhaseTaskItems(current.filter(item => item.id !== itemId)));
		if (editingItemId === itemId) {
			resetForm();
		}
		setError(null);
		try {
			await deletePrivatePhaseTaskItem(sessionId, participantUserId, itemId);
		} catch (deleteError) {
			setItems(previousItems);
			if (deletedEditingItem) {
				setEditingItemId(deletedEditingItem.id);
				setForm({
					componentId: deletedEditingItem.component_id,
					actionId: deletedEditingItem.action_id,
					detail: deletedEditingItem.detail
				});
			}
			setError(deleteError instanceof Error ? deleteError.message : "改善項目刪除失敗");
		} finally {
			setDeletingItemId(current => (current === itemId ? null : current));
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
			setError(moveError instanceof Error ? moveError.message : "改善項目排序失敗");
		} finally {
			setMovingItemId(null);
		}
	};

	return (
		<section className="grid h-full min-h-0 content-start gap-4 overflow-y-auto pr-1" aria-label="第一階段改善項目">
			<div className="grid gap-2" aria-label="優先改善項目清單">
				<div className="flex items-center justify-between gap-3">
					<h3 className="text-sm font-semibold">優先改善項目</h3>
					<span className="rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground">
						{items.length} / 至少 {requiredItemCount}
					</span>
				</div>
				{isLoading && <div className="grid min-h-24 place-items-center rounded-lg border border-dashed text-sm text-muted-foreground">載入中</div>}
				{!isLoading && items.length === 0 && <div className="grid min-h-32 place-items-center rounded-lg border border-dashed text-sm text-muted-foreground">尚無改善項目</div>}
				{!isLoading &&
					sortPrivatePhaseTaskItems(items).map((item, index, sortedItems) => (
						<div key={item.id} className="contents">
							<PrivatePhaseTaskItemRow
								key={item.id}
								item={item}
								index={index}
								isFirst={index === 0}
								isLast={index === sortedItems.length - 1}
								isMoving={movingItemId === item.id}
								isDeleting={isDeletingTaskItem}
								onMove={(itemId, direction) => void moveTaskItem(itemId, direction)}
								onEdit={editTaskItem}
								onDelete={itemId => void deleteTaskItem(itemId)}
							/>
							{index === requiredItemCount - 1 && <PhaseTaskItemThresholdSeparator label={`最低 ${requiredItemCount} 個門檻；下面的項目也會全部帶入下一階段`} />}
						</div>
					))}
			</div>

			<div className="grid gap-3 rounded-md border bg-background p-3" aria-label="建立第一階段改善項目">
				<div className="grid gap-3 sm:grid-cols-2">
					<KeywordDropSlot
						label="海報元件"
						selectedOption={selectedComponent}
						isActive={!!selectedComponent}
						onClear={() => {
							setForm(current => ({ ...current, componentId: "", actionId: "", detail: "" }));
							setError(null);
						}}
					/>
					<KeywordDropSlot
						label="改善動作"
						selectedOption={selectedAction}
						isActive={!!selectedAction}
						onClear={() => {
							setForm(current => ({ ...current, actionId: "", detail: "" }));
							setError(null);
						}}
					/>
				</div>
				<div className="flex flex-col gap-2 sm:flex-row sm:items-center">
					<div className="min-w-0 flex-1 rounded-md bg-muted px-3 py-2 text-sm leading-6 text-foreground">
						<span className="break-words">{previewStatement || "尚未建立改善項目"}</span>
					</div>
					<div className="flex shrink-0 gap-2">
						{editingItemId !== null && (
							<Button type="button" variant="outline" size="icon" className="h-10 w-10" title="取消編輯" aria-label="取消編輯" onClick={resetForm}>
								<X className="h-4 w-4" />
							</Button>
						)}
						{editingItem && (
							<Button
								type="button"
								variant="destructive"
								className="h-10 gap-2 px-3"
								title={getPrivatePhaseTaskItemActionLabel("刪除", editingItem, Math.max(0, editingItem.priority - 1))}
								aria-label={getPrivatePhaseTaskItemActionLabel("刪除", editingItem, Math.max(0, editingItem.priority - 1))}
								disabled={!canDeleteEditingItem}
								onClick={() => void deleteTaskItem(editingItem.id)}
							>
								<Trash2 className="h-4 w-4" />
								刪除
							</Button>
						)}
						<Button type="button" className="h-10 gap-2 px-3" disabled={!canSave} onClick={() => void saveTaskItem()}>
							{editingItemId !== null ? <Check className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
							{isSaving ? "儲存中" : editingItemId !== null ? "更新" : "新增"}
						</Button>
					</div>
				</div>
				<div className="grid gap-3 rounded-md bg-muted/40 p-3" aria-label="可選項目">
					<div className="text-xs font-semibold text-muted-foreground">可選項目</div>
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
						{selectedComponent ? (
							<div className="flex flex-wrap gap-2">
								{availableActions.map(action => (
									<KeywordChip key={action.id} kind="action" option={action} isSelected={action.id === form.actionId} onSelect={() => selectKeyword("action", action.id)} />
								))}
								{availableActions.length === 0 && <div className="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">此元件目前沒有可用動作</div>}
							</div>
						) : (
							<div className="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">先選擇海報元件</div>
						)}
						{selectedActionRequiresDetail && selectedActionUsesLibraryNumber && (
							<label className="grid max-w-56 gap-1.5">
								<span className="text-xs font-medium text-muted-foreground">{selectedAction?.detail_input?.label_zh || "Library 編號"}</span>
								<input
									value={form.detail}
									inputMode="numeric"
									pattern="[0-9]*"
									className="h-10 rounded-md border bg-background px-3 py-2 text-sm leading-6 text-foreground shadow-sm outline-none transition focus-visible:border-primary focus-visible:ring-1 focus-visible:ring-ring"
									placeholder={selectedAction?.detail_input?.placeholder_zh || "例如：7"}
									onChange={event => {
										setForm(current => ({ ...current, detail: event.target.value }));
										setError(null);
									}}
								/>
								{(isLibraryNumberInvalid || normalizedDetail.length > 0) && (
									<span className={cn("text-xs text-muted-foreground", isLibraryNumberInvalid && "text-destructive")}>{isLibraryNumberInvalid ? "請輸入正整數" : `編號 ${normalizedDetail}`}</span>
								)}
							</label>
						)}
						{selectedActionRequiresDetail && !selectedActionUsesLibraryNumber && (
							<label className="grid gap-1.5">
								<span className="text-xs font-medium text-muted-foreground">自訂動作內容</span>
								<textarea
									value={form.detail}
									maxLength={280}
									className="min-h-20 resize-y rounded-md border bg-background px-3 py-2 text-sm leading-6 text-foreground shadow-sm outline-none transition focus-visible:border-primary focus-visible:ring-1 focus-visible:ring-ring"
									placeholder="例如：改成更有活動邀請感的語氣"
									onChange={event => {
										setForm(current => ({ ...current, detail: event.target.value }));
										setError(null);
									}}
								/>
								{normalizedDetail.length > 0 && <span className="text-xs text-muted-foreground">{form.detail.length} / 280</span>}
							</label>
						)}
					</div>
				</div>
				{error && <p className="text-xs text-destructive">{error}</p>}
			</div>
		</section>
	);
}
