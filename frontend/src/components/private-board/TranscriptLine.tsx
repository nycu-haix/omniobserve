import { CornerDownRight } from "lucide-react";
import { getDefaultParticipantName } from "../../lib/participantDefaults";
import { cn } from "../../lib/utils";
import type { TranscriptLine as TranscriptLineType } from "../../types";
import { Button } from "../ui/Button";

interface TranscriptLineProps {
	line: TranscriptLineType;
	onJumpToBlock?: (blockId: string) => void;
}

export function TranscriptLine({ line, onJumpToBlock }: TranscriptLineProps) {
	const isPrivate = line.source === "private";
	const isOwn = !!line.isOwn;
	const isOwnPublic = line.source === "public" && line.isOwn;
	const speakerName = line.displayName || (line.userId ? getDefaultParticipantName(line.userId) : undefined);

	return (
		<div className={cn("flex min-w-0 items-start gap-3 border-b py-2 text-sm leading-6", isOwn ? "justify-end" : "justify-start")}>
			<div className={cn("flex w-full min-w-0 flex-col gap-1", isOwn ? "items-end" : "items-start")}>
				<div
					className={cn(
						"max-w-[75%] whitespace-normal text-left [overflow-wrap:normal] [word-break:normal]",
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
				{line.source === "private" && line.linkedBlockId && (
					<Button className={cn("shrink-0", isOwn ? "self-end" : "self-start")} variant="ghost" size="sm" onClick={() => onJumpToBlock?.(line.linkedBlockId as string)}>
						<CornerDownRight className="h-4 w-4" />
						跳至想法
					</Button>
				)}
			</div>
		</div>
	);
}
