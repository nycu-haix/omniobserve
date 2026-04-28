import { ChevronDown, ChevronRight, CircleDashed, Pencil } from "lucide-react";
import { useState } from "react";
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
}

export function IdeaBlockItem({ block, isHighlighted = false, onToggle }: IdeaBlockItemProps) {
	const [detailTab, setDetailTab] = useState("ai");
	const isGenerating = block.status === "generating";
	const Chevron = block.expanded ? ChevronDown : ChevronRight;

	const row = (
		<div
			className={cn(
				"flex min-h-11 w-full items-center gap-2 rounded-lg border bg-background px-3 py-2 text-left transition-colors",
				block.hasCue && "border-primary bg-accent",
				isHighlighted && "ring-2 ring-primary",
				isGenerating && "animate-pulse text-muted-foreground"
			)}
		>
			{isGenerating ? <CircleDashed className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" /> : <Chevron className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
			<span className="min-w-0 flex-1 truncate">{isGenerating ? "正在生成..." : block.summary}</span>
			{!isGenerating && (
				<Button aria-label="Edit idea block" size="icon" variant="ghost" onClick={event => event.stopPropagation()}>
					<Pencil className="h-4 w-4" />
				</Button>
			)}
		</div>
	);

	const trigger = (
		<button type="button" className="w-full" disabled={isGenerating} onClick={() => onToggle(block.id)}>
			{row}
		</button>
	);

	return (
		<div className="grid gap-2">
			{block.hasCue && block.cueText ? (
				<TooltipProvider>
					<Tooltip>
						<TooltipTrigger asChild>{trigger}</TooltipTrigger>
						<TooltipContent>{block.cueText}</TooltipContent>
					</Tooltip>
				</TooltipProvider>
			) : (
				trigger
			)}

			{block.expanded && !isGenerating && (
				<div className="ml-7 rounded-lg border bg-background p-3">
					<Tabs value={detailTab} onValueChange={setDetailTab}>
						<TabsList>
							<TabsTrigger value="ai">AI 統整</TabsTrigger>
							<TabsTrigger value="transcript">逐字稿</TabsTrigger>
							{block.hasCue && <Badge variant="secondary">Similarity</Badge>}
						</TabsList>
						<TabsContent className="text-sm leading-6" value="ai">
							{block.aiSummary || "-"}
						</TabsContent>
						<TabsContent className="text-sm leading-6" value="transcript">
							{block.transcript || "-"}
						</TabsContent>
					</Tabs>
				</div>
			)}
		</div>
	);
}
