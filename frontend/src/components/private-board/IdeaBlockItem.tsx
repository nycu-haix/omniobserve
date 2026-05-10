import { Check, ChevronDown, ChevronRight, CircleDashed, CornerDownLeft, Pencil, Trash2, X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent } from "react";
import { cn } from "../../lib/utils";
import type { IdeaBlock } from "../../types";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../ui/Tooltip";

interface IdeaBlockItemProps {
	block: IdeaBlock;
	isHighlighted?: boolean;
	onToggle: (id: string) => void;
	onSave: (id: string, values: { summary: string; aiSummary: string; transcript: string; updateTitle?: boolean }) => Promise<void> | void;
	onDelete?: (id: string) => Promise<void> | void;
	onJumpToTranscript?: (block: IdeaBlock) => void;
	canJumpToTranscript?: boolean;
	currentPhase?: string;
}

export function IdeaBlockItem({ block, isHighlighted = false, onToggle, onSave, onDelete, onJumpToTranscript, canJumpToTranscript = false, currentPhase = "private" }: IdeaBlockItemProps) {
	const [draftTitle, setDraftTitle] = useState(block.summary);
	const [savedTitle, setSavedTitle] = useState(block.summary);
	const [draftAiSummary, setDraftAiSummary] = useState(block.aiSummary || "");
	const [draftTranscript, setDraftTranscript] = useState(block.transcript || "");
	const [savedAiSummary, setSavedAiSummary] = useState(block.aiSummary || "");
	const [isSaving, setIsSaving] = useState(false);
	const [saveError, setSaveError] = useState<string | null>(null);
	const [isDeleting, setIsDeleting] = useState(false);
	const [isEditingTitle, setIsEditingTitle] = useState(false);
	const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
	const aiSummaryTextareaRef = useRef<HTMLTextAreaElement | null>(null);

	const isGenerating = block.status === "generating";
	const Chevron = block.expanded ? ChevronDown : ChevronRight;
	const aiSummaryChanged = draftAiSummary.trim() !== savedAiSummary.trim();
	const canSaveAiSummary = draftAiSummary.trim().length > 0 && aiSummaryChanged && !isSaving;
	const titleChanged = draftTitle.trim() !== savedTitle.trim();
	const titleTooLong = draftTitle.trim().length > 10;
	const canSaveTitle = draftTitle.trim().length > 0 && titleChanged && !titleTooLong && !isSaving;
	const rowLabel = block.isDraft ? draftAiSummary.trim() || block.summary : savedTitle;
	const hasLinkedTranscript = canJumpToTranscript && (!!block.transcriptLineId || (block.sourceTranscriptIds?.length ?? 0) > 0);
	const shouldShowCue = block.hasCue && currentPhase === "group";
	const similarityReasonLabel = block.similarityIsSameReason == null ? null : block.similarityIsSameReason ? "Same reason" : "Different reason";

	useEffect(() => {
		const timer = window.setTimeout(() => {
			setDraftTitle(block.summary);
			setSavedTitle(block.summary);
			setDraftAiSummary(block.aiSummary || "");
			setSavedAiSummary(block.aiSummary || "");
			setDraftTranscript(block.transcript || "");
			setSaveError(null);
			setIsEditingTitle(false);
		}, 0);

		return () => window.clearTimeout(timer);
	}, [block.aiSummary, block.summary, block.transcript, block.id]);

	useLayoutEffect(() => {
		const textarea = aiSummaryTextareaRef.current;
		if (!textarea || !block.expanded || isGenerating) {
			return;
		}

		textarea.style.height = "auto";
		textarea.style.height = `${textarea.scrollHeight}px`;
	}, [block.expanded, draftAiSummary, isGenerating]);

	const cancelAiSummaryEditing = () => {
		setDraftAiSummary(savedAiSummary);
		setSaveError(null);
	};

	const startTitleEditing = (event: MouseEvent<HTMLButtonElement>) => {
		event.stopPropagation();
		setDraftTitle(savedTitle);
		setSaveError(null);
		setIsEditingTitle(true);
	};

	const cancelTitleEditing = () => {
		setDraftTitle(savedTitle);
		setSaveError(null);
		setIsEditingTitle(false);
	};

	const deleteBlock = (event: MouseEvent<HTMLButtonElement>) => {
		event.stopPropagation();
		setShowDeleteConfirm(true);
	};

	const confirmDelete = async () => {
		if (!onDelete || isDeleting) {
			return;
		}

		setIsDeleting(true);
		setShowDeleteConfirm(false);
		setSaveError(null);
		try {
			await onDelete(block.id);
		} catch (error) {
			setSaveError(error instanceof Error ? error.message : "Failed to delete idea block");
		} finally {
			setIsDeleting(false);
		}
	};

	const saveDraft = async () => {
		const nextAiSummary = draftAiSummary.trim();
		const nextSummary = nextAiSummary.slice(0, 10) || "Idea";
		if (!nextAiSummary || isSaving) {
			return;
		}

		setIsSaving(true);
		setSaveError(null);
		try {
			await onSave(block.id, {
				summary: block.isDraft ? nextSummary : savedTitle,
				aiSummary: nextAiSummary,
				transcript: draftTranscript.trim()
			});
			setDraftAiSummary(nextAiSummary);
			setSavedAiSummary(nextAiSummary);
		} catch (error) {
			setSaveError(error instanceof Error ? error.message : "Failed to save idea block");
		} finally {
			setIsSaving(false);
		}
	};

	const saveTitle = async () => {
		const nextTitle = draftTitle.trim();
		if (!nextTitle || nextTitle.length > 10 || isSaving) {
			return;
		}

		setIsSaving(true);
		setSaveError(null);
		try {
			await onSave(block.id, {
				summary: nextTitle,
				aiSummary: draftAiSummary.trim() || savedAiSummary,
				transcript: draftTranscript.trim(),
				updateTitle: true
			});
			setDraftTitle(nextTitle);
			setSavedTitle(nextTitle);
			setIsEditingTitle(false);
		} catch (error) {
			setSaveError(error instanceof Error ? error.message : "Failed to save idea block title");
		} finally {
			setIsSaving(false);
		}
	};

	const row = (
		<div
			role="button"
			tabIndex={isGenerating || isEditingTitle ? -1 : 0}
			className={cn(
				"grid min-h-11 w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 rounded-lg border bg-background px-3 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
				shouldShowCue && "border-primary bg-accent",
				block.isDeleted && "border-muted bg-muted/35 text-muted-foreground/60",
				isHighlighted && "ring-2 ring-primary",
				isGenerating && "animate-pulse text-muted-foreground"
			)}
			onClick={() => {
				if (!isGenerating && !isEditingTitle) {
					onToggle(block.id);
				}
			}}
			onKeyDown={event => {
				if (isGenerating || isEditingTitle || (event.key !== "Enter" && event.key !== " ")) {
					return;
				}
				event.preventDefault();
				onToggle(block.id);
			}}
		>
			{isGenerating ? (
				<CircleDashed className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
			) : (
				<Chevron className={cn("h-4 w-4 shrink-0 text-muted-foreground", block.isDeleted && "opacity-45")} aria-hidden="true" />
			)}
			{isEditingTitle ? (
				<input
					className={cn(
						"min-w-12 max-w-full justify-self-start rounded-md border bg-background px-2 py-1 text-sm leading-6 outline-none transition-colors focus:border-ring focus:ring-1 focus:ring-ring",
						titleTooLong && "border-destructive focus:border-destructive"
					)}
					style={{ width: `${Math.max(4, Math.min(draftTitle.length + 1, 24))}ch` }}
					value={draftTitle}
					onClick={event => event.stopPropagation()}
					onChange={event => setDraftTitle(event.target.value)}
					onKeyDown={event => {
						event.stopPropagation();
						if (event.key === "Enter") {
							event.preventDefault();
							void saveTitle();
						}
						if (event.key === "Escape") {
							event.preventDefault();
							cancelTitleEditing();
						}
					}}
					autoFocus
				/>
			) : (
				<span className="block w-fit min-w-0 max-w-full justify-self-start whitespace-pre-wrap break-words text-sm leading-6">{isGenerating ? "正在生成..." : rowLabel}</span>
			)}
			{!isGenerating && (
				<div className="relative flex flex-shrink-0 items-center gap-2">
					{isEditingTitle ? (
						<>
							<Button
								aria-label="Cancel title edit"
								className="h-7 w-7"
								size="icon"
								variant="ghost"
								onClick={event => {
									event.stopPropagation();
									cancelTitleEditing();
								}}
								disabled={isSaving}
							>
								<X className="h-3.5 w-3.5" />
							</Button>
							<Button
								aria-label="Save title edit"
								className="h-7 w-7"
								size="icon"
								onClick={event => {
									event.stopPropagation();
									void saveTitle();
								}}
								disabled={!canSaveTitle}
							>
								<Check className="h-3.5 w-3.5" />
							</Button>
						</>
					) : (
						<>
							{!block.isDraft && (
								<Button
									aria-label="Edit idea block title"
									className={cn(block.isDeleted && "opacity-45")}
									size="icon"
									variant="ghost"
									onClick={startTitleEditing}
									disabled={isSaving || block.isDeleted}
								>
									<Pencil className="h-4 w-4" />
								</Button>
							)}
							<Button aria-label="Delete idea block" className={cn(block.isDeleted && "opacity-45")} size="icon" variant="ghost" onClick={deleteBlock} disabled={isDeleting || block.isDeleted}>
								<Trash2 className="h-4 w-4" />
							</Button>
						</>
					)}
					{showDeleteConfirm && (
						<div className="absolute right-0 top-full z-50 mt-1 rounded-md border bg-popover p-1 shadow-lg ring-1 ring-black/5" onClick={event => event.stopPropagation()}>
							<div className="flex items-center gap-1">
								<Button aria-label="Confirm delete idea block" className="h-7 w-7" size="icon" variant="destructive" onClick={() => void confirmDelete()} disabled={isDeleting}>
									<Check className="h-3.5 w-3.5" />
								</Button>
								<Button aria-label="Cancel delete idea block" className="h-7 w-7" size="icon" variant="ghost" onClick={() => setShowDeleteConfirm(false)}>
									<X className="h-3.5 w-3.5" />
								</Button>
							</div>
						</div>
					)}

					{hasLinkedTranscript && (
						<Button className="w-fit gap-2" variant="ghost" size="sm" onClick={() => onJumpToTranscript?.(block)}>
							<CornerDownLeft className="h-4 w-4" />
						</Button>
					)}
				</div>
			)}
		</div>
	);

	return (
		<div className="grid gap-2">
			{shouldShowCue && block.cueText ? (
				<TooltipProvider>
					<Tooltip>
						<TooltipTrigger asChild>{row}</TooltipTrigger>
						<TooltipContent>{block.cueText}</TooltipContent>
					</Tooltip>
				</TooltipProvider>
			) : (
				row
			)}

			{isEditingTitle && (saveError || titleTooLong) && <p className="ml-7 text-xs font-semibold text-destructive">{saveError || "⚠️ 超過10個字，請將標題刪減至10字以下"}</p>}

			{block.expanded && !isGenerating && (
				<div className={cn("ml-7 mr-7 grid gap-2 overflow-hidden rounded-lg px-1 py-1", block.isDeleted && "text-muted-foreground/60")}>
					{shouldShowCue && (
						<div className="flex flex-wrap gap-1.5">
							<Badge className="w-fit" variant="secondary">
								Similarity
							</Badge>
							{similarityReasonLabel && (
								<Badge className="w-fit" variant={block.similarityIsSameReason ? "default" : "outline"}>
									{similarityReasonLabel}
								</Badge>
							)}
						</div>
					)}

					<textarea
						ref={aiSummaryTextareaRef}
						rows={1}
						className="min-h-11 w-full resize-none overflow-hidden rounded-md border bg-background px-2.5 py-1.5 text-sm leading-5 outline-none transition-colors focus:border-ring focus:ring-1 focus:ring-ring"
						value={draftAiSummary}
						onChange={event => setDraftAiSummary(event.target.value)}
					/>

					{(aiSummaryChanged || (saveError && !isEditingTitle)) && (
						<div className="flex flex-wrap items-center justify-between gap-2 border-t pt-2">
							{saveError && !isEditingTitle ? <p className="text-xs text-destructive">{saveError}</p> : <p className="text-xs text-muted-foreground">內容已修改</p>}
							<div className="flex items-center gap-2">
								<Button aria-label="Cancel AI summary edit" className="h-7 w-7" size="icon" variant="ghost" onClick={cancelAiSummaryEditing} disabled={isSaving}>
									<X className="h-3.5 w-3.5" />
								</Button>
								<Button aria-label="Save AI summary" className="h-7 w-7" size="icon" onClick={() => void saveDraft()} disabled={!canSaveAiSummary}>
									<Check className="h-3.5 w-3.5" />
								</Button>
							</div>
						</div>
					)}
				</div>
			)}
		</div>
	);
}
