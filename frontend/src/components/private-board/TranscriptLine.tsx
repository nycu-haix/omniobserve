import { CornerDownRight, Loader2 } from "lucide-react";
import { formatParticipantDisplayName } from "../../lib/participantDefaults";
import type { TranscriptIdeaBlockStatus } from "../../lib/transcriptIdeaBlockDisplay";
import { cn } from "../../lib/utils";
import type { TranscriptLine as TranscriptLineType } from "../../types";
import { Button } from "../ui/Button";

interface TranscriptLineProps {
	line: TranscriptLineType;
	onJumpToBlock?: (blockId: string) => void;
	ideaBlockStatus?: TranscriptIdeaBlockStatus;
	ideaBlockTargetId?: string | null;
}

export function TranscriptLine({ line, onJumpToBlock, ideaBlockStatus = "raw", ideaBlockTargetId = null }: TranscriptLineProps) {
	const isPrivate = line.source === "private";
	const isOwn = !!line.isOwn;
	const isOwnPublic = line.source === "public" && line.isOwn;
	const alignRight = isPrivate && isOwn;
	const speakerName = formatParticipantDisplayName(line.userId, line.displayName);
	const canJumpToIdeaBlock = isPrivate && ideaBlockStatus === "linked" && !!ideaBlockTargetId && !!onJumpToBlock;
	const isPendingIdeaBlock = isPrivate && ideaBlockStatus === "pending";

	return (
		<div className={cn("flex min-w-0 items-start gap-3 border-b py-2 text-sm leading-6", alignRight ? "justify-end" : "justify-start")}>
			<div className={cn("flex w-full min-w-0 flex-col gap-1", alignRight ? "items-end" : "items-start")}>
				<div
					className={cn(
						"min-w-0 max-w-[75%] whitespace-normal text-left break-words",
						isPrivate && isOwn && "rounded-md bg-muted px-3 py-1",
						isOwnPublic && "rounded-md border border-primary/70 px-3 py-1"
					)}
				>
					<div className="flex min-w-0 flex-col items-start gap-1">
						{line.source === "public" && speakerName && <span className="text-xs font-semibold text-muted-foreground">{speakerName}</span>}
						<span>{line.text}</span>
						{line.time && <span className="whitespace-nowrap text-xs text-muted-foreground">{line.time}</span>}
					</div>
				</div>
				{canJumpToIdeaBlock && (
					<Button className={cn("shrink-0", alignRight ? "self-end" : "self-start")} variant="ghost" size="sm" onClick={() => onJumpToBlock(ideaBlockTargetId)}>
						<CornerDownRight className="h-4 w-4" />
						跳至想法
					</Button>
				)}
				{isPendingIdeaBlock && (
					<span className={cn("inline-flex shrink-0 items-center gap-1 rounded-full border bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground", alignRight ? "self-end" : "self-start")}>
						<Loader2 className="h-3 w-3 animate-spin" />
						正在整理想法
					</span>
				)}
			</div>
		</div>
	);
}
