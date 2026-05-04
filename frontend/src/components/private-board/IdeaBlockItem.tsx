import { Check, ChevronDown, ChevronRight, CircleDashed, Pencil, X } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "../../lib/utils";
import type { IdeaBlock } from "../../types";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/Tabs";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../ui/Tooltip";

interface IdeaBlockItemProps {
	block: IdeaBlock;
	isHighlighted?: boolean;
	onToggle: (id: string) => void;
	onSave: (id: string, values: { summary: string; aiSummary: string; transcript: string }) => Promise<void> | void;
}

export function IdeaBlockItem({ block, isHighlighted = false, onToggle, onSave }: IdeaBlockItemProps) {
	const [detailTab, setDetailTab] = useState("ai");
	const [isEditing, setIsEditing] = useState(false);
	const [draftSummary, setDraftSummary] = useState(block.summary);
	const [draftAiSummary, setDraftAiSummary] = useState(block.aiSummary || "");
	const [draftTranscript, setDraftTranscript] = useState(block.transcript || "");
	const [isSaving, setIsSaving] = useState(false);
	const [saveError, setSaveError] = useState<string | null>(null);
	const isGenerating = block.status === "generating";
	const Chevron = block.expanded ? ChevronDown : ChevronRight;
	const canSave = draftSummary.trim().length > 0 && !isSaving;

	useEffect(() => {
		if (isEditing) {
			return;
		}

		setDraftSummary(block.summary);
		setDraftAiSummary(block.aiSummary || "");
		setDraftTranscript(block.transcript || "");
	}, [block.aiSummary, block.summary, block.transcript, isEditing]);

	const startEditing = () => {
		setDraftSummary(block.summary);
		setDraftAiSummary(block.aiSummary || "");
		setDraftTranscript(block.transcript || "");
		setSaveError(null);
		setIsEditing(true);
		setDetailTab("ai");
		if (!block.expanded) {
			onToggle(block.id);
		}
	};

	const cancelEditing = () => {
		setDraftSummary(block.summary);
		setDraftAiSummary(block.aiSummary || "");
		setDraftTranscript(block.transcript || "");
		setSaveError(null);
		setIsEditing(false);
	};

	const saveDraft = async () => {
		if (!canSave) {
			return;
		}

		setIsSaving(true);
		setSaveError(null);
		try {
			await onSave(block.id, {
				summary: draftSummary.trim(),
				aiSummary: draftAiSummary.trim(),
				transcript: draftTranscript.trim()
			});
			setIsEditing(false);
		} catch (error) {
			setSaveError(error instanceof Error ? error.message : "Failed to save idea block");
		} finally {
			setIsSaving(false);
		}
	};

	const row = (
		<div
			role="button"
			tabIndex={isGenerating ? -1 : 0}
			className={cn(
				"flex min-h-11 w-full items-center gap-2 rounded-lg border bg-background px-3 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
				block.hasCue && "border-primary bg-accent",
				isHighlighted && "ring-2 ring-primary",
				isGenerating && "animate-pulse text-muted-foreground"
			)}
			onClick={() => {
				if (!isGenerating) {
					onToggle(block.id);
				}
			}}
			onKeyDown={event => {
				if (isGenerating || (event.key !== "Enter" && event.key !== " ")) {
					return;
				}
				event.preventDefault();
				onToggle(block.id);
			}}
		>
			{isGenerating ? <CircleDashed className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" /> : <Chevron className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
			<span className="min-w-0 flex-1 truncate">{isGenerating ? "正在生成..." : block.summary}</span>
			{!isGenerating && (
				<Button
					aria-label="Edit idea block"
					size="icon"
					variant="ghost"
					onClick={event => {
						event.stopPropagation();
						startEditing();
					}}
				>
					<Pencil className="h-4 w-4" />
				</Button>
			)}
		</div>
	);

	return (
		<div className="grid gap-2">
			{block.hasCue && block.cueText ? (
				<TooltipProvider>
					<Tooltip>
						<TooltipTrigger asChild>{row}</TooltipTrigger>
						<TooltipContent>{block.cueText}</TooltipContent>
					</Tooltip>
				</TooltipProvider>
			) : (
				row
			)}

			{block.expanded && !isGenerating && (
				<div className="ml-7 rounded-lg border bg-background p-3">
					<Tabs value={detailTab} onValueChange={setDetailTab}>
						<TabsList>
							<TabsTrigger value="ai">AI 統整</TabsTrigger>
							{isEditing && <TabsTrigger value="content">標題</TabsTrigger>}
							<TabsTrigger value="transcript">逐字稿</TabsTrigger>
							{block.hasCue && <Badge variant="secondary">Similarity</Badge>}
						</TabsList>
						<TabsContent className="text-sm leading-6" value="ai">
							{isEditing ? (
								<textarea
									className="min-h-28 w-full resize-y rounded-md border bg-background px-3 py-2 text-sm leading-6 outline-none transition-colors focus:border-ring focus:ring-1 focus:ring-ring"
									value={draftAiSummary}
									onChange={event => setDraftAiSummary(event.target.value)}
								/>
							) : (
								block.aiSummary || "-"
							)}
						</TabsContent>
						<TabsContent className="grid gap-2 text-sm leading-6" value="content">
							{isEditing ? (
								<>
									<textarea
										className="min-h-20 w-full resize-y rounded-md border bg-background px-3 py-2 text-sm leading-6 outline-none transition-colors focus:border-ring focus:ring-1 focus:ring-ring"
										maxLength={10}
										value={draftSummary}
										onChange={event => setDraftSummary(event.target.value)}
									/>
									<p className="text-xs text-muted-foreground">{draftSummary.length}/10</p>
								</>
							) : (
								block.summary || "-"
							)}
						</TabsContent>
						<TabsContent className="text-sm leading-6" value="transcript">
							{isEditing ? (
								<textarea
									className="min-h-28 w-full resize-y rounded-md border bg-background px-3 py-2 text-sm leading-6 outline-none transition-colors focus:border-ring focus:ring-1 focus:ring-ring"
									value={draftTranscript}
									onChange={event => setDraftTranscript(event.target.value)}
								/>
							) : (
								block.transcript || "-"
							)}
						</TabsContent>
					</Tabs>
					{isEditing && (
						<div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t pt-3">
							{saveError ? <p className="text-xs text-destructive">{saveError}</p> : <p className="text-xs text-muted-foreground">AI 統整、內容、逐字稿都會一起儲存。</p>}
							<div className="flex items-center gap-2">
								<Button size="sm" variant="ghost" onClick={cancelEditing} disabled={isSaving}>
									<X className="mr-1 h-4 w-4" />
									取消
								</Button>
								<Button size="sm" onClick={saveDraft} disabled={!canSave}>
									<Check className="mr-1 h-4 w-4" />
									{isSaving ? "儲存中" : "儲存"}
								</Button>
							</div>
						</div>
					)}
				</div>
			)}
		</div>
	);
}
