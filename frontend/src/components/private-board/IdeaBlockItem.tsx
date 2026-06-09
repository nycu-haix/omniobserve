import { Check, ChevronDown, ChevronRight, CircleDashed, CornerDownLeft, Pencil, Send, Trash2, X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent } from "react";
import { DEFAULT_SESSION_PHASE, isGroupPhase, type SessionPhase } from "../../lib/sessionPhase";
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
	onShareToChat?: (block: IdeaBlock) => void;
	canJumpToTranscript?: boolean;
	canShareToChat?: boolean;
	currentPhase?: SessionPhase;
}

export function IdeaBlockItem({
	block,
	isHighlighted = false,
	onToggle,
	onSave,
	onDelete,
	onJumpToTranscript,
	onShareToChat,
	canJumpToTranscript = false,
	canShareToChat = false,
	currentPhase = DEFAULT_SESSION_PHASE
}: IdeaBlockItemProps) {
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
	const itemRootRef = useRef<HTMLDivElement | null>(null);
	const aiSummaryTextareaRef = useRef<HTMLTextAreaElement | null>(null);

	const isGenerating = block.status === "generating";
	const isDeleted = !!block.isDeleted;
	const canToggle = !isGenerating && !isEditingTitle && !isDeleted;
	const Chevron = block.expanded ? ChevronDown : ChevronRight;
	const aiSummaryChanged = draftAiSummary.trim() !== savedAiSummary.trim();
	const canSaveAiSummary = draftAiSummary.trim().length > 0 && aiSummaryChanged && !isSaving && !isDeleted;
	const titleChanged = draftTitle.trim() !== savedTitle.trim();
	const titleTooLong = draftTitle.trim().length > 20;
	const canSaveTitle = draftTitle.trim().length > 0 && titleChanged && !titleTooLong && !isSaving && !isDeleted;
	const rowLabel = block.isDraft ? draftAiSummary.trim() || block.summary : savedTitle;
	const hasLinkedTranscript = canJumpToTranscript && (!!block.transcriptLineId || (block.sourceTranscriptIds?.length ?? 0) > 0);
	const canShareCurrentBlock = !!onShareToChat && canShareToChat && !isGenerating && !isDeleted && !!(block.aiSummary?.trim() || block.summary.trim());
	const shouldShowCue = block.hasCue && isGroupPhase(currentPhase);
	const shouldShowPublicContext = !!block.publicContextRelevant && !isDeleted && !isGenerating;
	const hasSameSimilarityReason = block.similarityHasSameReason ?? block.similarityIsSameReason === true;
	const hasDifferentSimilarityReason = block.similarityHasDifferentReason ?? block.similarityIsSameReason === false;
	const hasMixedSimilarityReasons = hasSameSimilarityReason && hasDifferentSimilarityReason;
	const similarityReasonTag =
		!hasSameSimilarityReason && !hasDifferentSimilarityReason
			? null
			: {
					label: hasMixedSimilarityReasons ? "same + different" : hasSameSimilarityReason ? "same reason" : "different reason",
					className: hasMixedSimilarityReasons
						? "border-neutral-900/30 bg-[#ffeace] text-neutral-900"
						: hasSameSimilarityReason
							? "border-green-700/30 bg-green-100 text-green-900"
							: "border-yellow-700/30 bg-yellow-100 text-yellow-900"
				};
	const similarityReasonTitleColor =
		shouldShowCue && (hasSameSimilarityReason || hasDifferentSimilarityReason)
			? hasMixedSimilarityReasons
				? "bg-[#ffeace]"
				: hasSameSimilarityReason
					? "bg-[rgb(205,255,186)]"
					: "bg-[rgb(255,249,184)]"
			: null;
	const sharedReasons = block.sharedReasons ?? [];

	useEffect(() => {
		const timer = window.setTimeout(() => {
			setDraftTitle(block.summary);
			setSavedTitle(block.summary);
			setDraftAiSummary(block.aiSummary || "");
			setSavedAiSummary(block.aiSummary || "");
			setDraftTranscript(block.transcript || "");
			setSaveError(null);
			setIsEditingTitle(false);
			setShowDeleteConfirm(false);
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

	useEffect(() => {
		if (!showDeleteConfirm) {
			return;
		}

		const closeDeleteConfirmOnOutsidePointer = (event: PointerEvent) => {
			const target = event.target;
			if (target instanceof Node && itemRootRef.current?.contains(target)) {
				return;
			}
			setShowDeleteConfirm(false);
		};

		const closeDeleteConfirmOnEscape = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				setShowDeleteConfirm(false);
			}
		};

		document.addEventListener("pointerdown", closeDeleteConfirmOnOutsidePointer);
		document.addEventListener("keydown", closeDeleteConfirmOnEscape);
		return () => {
			document.removeEventListener("pointerdown", closeDeleteConfirmOnOutsidePointer);
			document.removeEventListener("keydown", closeDeleteConfirmOnEscape);
		};
	}, [showDeleteConfirm]);

	const cancelAiSummaryEditing = () => {
		setDraftAiSummary(savedAiSummary);
		setSaveError(null);
	};

	const startTitleEditing = (event: MouseEvent<HTMLButtonElement>) => {
		event.stopPropagation();
		if (isDeleted) {
			return;
		}
		setDraftTitle(savedTitle);
		setSaveError(null);
		setShowDeleteConfirm(false);
		setIsEditingTitle(true);
	};

	const cancelTitleEditing = () => {
		setDraftTitle(savedTitle);
		setSaveError(null);
		setIsEditingTitle(false);
	};

	const deleteBlock = (event: MouseEvent<HTMLButtonElement>) => {
		event.stopPropagation();
		if (isDeleted) {
			return;
		}
		setShowDeleteConfirm(true);
	};

	const shareBlockToChat = (event: MouseEvent<HTMLButtonElement>) => {
		event.stopPropagation();
		if (!canShareCurrentBlock) {
			return;
		}
		setShowDeleteConfirm(false);
		onShareToChat?.(block);
	};

	const confirmDelete = async () => {
		if (!onDelete || isDeleting || isDeleted) {
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
		const nextSummary = nextAiSummary.slice(0, 20) || "Idea";
		if (!nextAiSummary || isSaving || isDeleted) {
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
		if (!nextTitle || nextTitle.length > 20 || isSaving || isDeleted) {
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
			ref={itemRootRef}
			role={canToggle ? "button" : undefined}
			tabIndex={canToggle ? 0 : undefined}
			className={cn(
				"relative grid min-h-11 w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 rounded-lg border bg-background px-3 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
				shouldShowCue && "border-primary bg-accent",
				shouldShowPublicContext && "border-neutral-900/70 pt-5",
				similarityReasonTitleColor,
				isDeleted && "border-muted bg-muted/35 text-muted-foreground/60",
				isHighlighted && "ring-2 ring-primary",
				isGenerating && "animate-pulse text-muted-foreground"
			)}
			onClick={() => {
				if (canToggle) {
					onToggle(block.id);
				}
			}}
			onKeyDown={event => {
				if (!canToggle || (event.key !== "Enter" && event.key !== " ")) {
					return;
				}
				event.preventDefault();
				onToggle(block.id);
			}}
		>
			{block.isUnread && !isDeleted && <span className="absolute right-1.5 top-1.5 h-2.5 w-2.5 rounded-full bg-destructive ring-2 ring-background" aria-label="Unread idea block" />}
			{shouldShowPublicContext && (
				<span
					className="pointer-events-none absolute left-3 top-1.5 z-10 rounded-sm border border-neutral-900/70 bg-background px-1.5 py-0.5 text-[10px] font-semibold leading-none text-neutral-900 shadow-sm"
					aria-label="現在公開討論相關"
					title="現在公開討論相關"
				>
					NOW
				</span>
			)}
			{isGenerating ? (
				<CircleDashed className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
			) : isDeleted ? (
				<span className="h-4 w-4 shrink-0" aria-hidden="true" />
			) : (
				<Chevron className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
			)}
			{isEditingTitle ? (
				<input
					className={cn(
						"min-w-0 max-w-full justify-self-stretch rounded-md border bg-background px-2 py-1 text-sm leading-6 outline-none transition-colors focus:border-ring focus:ring-1 focus:ring-ring",
						titleTooLong && "border-destructive focus:border-destructive"
					)}
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
								size="icon"
								variant="ghost"
								onClick={event => {
									event.stopPropagation();
									cancelTitleEditing();
								}}
								disabled={isSaving}
							>
								<X className="h-4 w-4" />
							</Button>
							<Button
								aria-label="Save title edit"
								size="icon"
								onClick={event => {
									event.stopPropagation();
									void saveTitle();
								}}
								disabled={!canSaveTitle}
							>
								<Check className="h-4 w-4" />
							</Button>
						</>
					) : (
						<>
							{shouldShowCue && similarityReasonTag && (
								<Badge className={cn("shrink-0 whitespace-nowrap", similarityReasonTag.className)} variant="outline">
									{similarityReasonTag.label}
								</Badge>
							)}
							{showDeleteConfirm ? (
								<>
									<Button
										aria-label="Confirm delete idea block"
										size="icon"
										variant="destructive"
										onClick={event => {
											event.stopPropagation();
											void confirmDelete();
										}}
										disabled={isDeleting}
									>
										<Check className="h-4 w-4" />
									</Button>
									<Button
										aria-label="Cancel delete idea block"
										size="icon"
										variant="ghost"
										onClick={event => {
											event.stopPropagation();
											setShowDeleteConfirm(false);
										}}
									>
										<X className="h-4 w-4" />
									</Button>
								</>
							) : (
								<>
									{!isDeleted && (
										<Button aria-label="Share idea block to public chat" title="送到聊天室" size="icon" variant="ghost" onClick={shareBlockToChat} disabled={!canShareCurrentBlock}>
											<Send className="h-4 w-4" />
										</Button>
									)}
									{!isDeleted && !block.isDraft && (
										<Button aria-label="Edit idea block title" size="icon" variant="ghost" onClick={startTitleEditing} disabled={isSaving}>
											<Pencil className="h-4 w-4" />
										</Button>
									)}
									{!isDeleted && (
										<Button aria-label="Delete idea block" size="icon" variant="ghost" onClick={deleteBlock} disabled={isDeleting}>
											<Trash2 className="h-4 w-4" />
										</Button>
									)}
								</>
							)}
						</>
					)}

					{hasLinkedTranscript && (
						<Button
							aria-label="Jump to transcript"
							className="w-fit gap-2"
							variant="ghost"
							size="sm"
							onClick={event => {
								event.stopPropagation();
								onJumpToTranscript?.(block);
							}}
						>
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

			{isEditingTitle && (saveError || titleTooLong) && <p className="ml-7 text-xs font-semibold text-destructive">{saveError || "⚠️ 超過20個字，請將標題刪減至20字以下"}</p>}

			{block.expanded && !isGenerating && !isDeleted && (
				<div className="ml-7 mr-7 grid gap-2 overflow-hidden rounded-lg px-1 py-1">
					{shouldShowCue && (
						<div className="flex flex-wrap gap-1.5">
							<Badge className="w-fit" variant="secondary">
								Similarity
							</Badge>
							{similarityReasonTag && (
								<Badge className={cn("w-fit", similarityReasonTag.className)} variant="outline">
									{similarityReasonTag.label}
								</Badge>
							)}
						</div>
					)}

					{sharedReasons.length > 0 && (
						<div className="grid gap-2 rounded-md border border-yellow-700/30 bg-yellow-50 px-3 py-2 text-sm">
							<div className="flex flex-wrap items-center gap-2">
								<Badge className="w-fit border-yellow-700/30 bg-yellow-100 text-yellow-900" variant="outline">
									匿名分享的不同理由
								</Badge>
							</div>
							{sharedReasons.map(reason => (
								<div className="grid gap-1 border-t border-yellow-700/20 pt-2 first:border-t-0 first:pt-0" key={reason.id}>
									<div className="flex flex-wrap items-center gap-2 text-xs text-yellow-900">
										<span className="font-semibold text-yellow-900/70">相似想法</span>
										<span>{reason.title}</span>
									</div>
									<p className="whitespace-pre-wrap break-words leading-5 text-yellow-950">{reason.summary}</p>
								</div>
							))}
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
