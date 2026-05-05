import { CornerDownRight } from "lucide-react";
import { cn } from "../../lib/utils";
import type { TranscriptLine as TranscriptLineType } from "../../types";
import { Button } from "../ui/Button";

interface TranscriptLineProps {
	line: TranscriptLineType;
	onJumpToBlock?: (blockId: string) => void;
}

export function TranscriptLine({ line, onJumpToBlock }: TranscriptLineProps) {
	const isPrivate = line.source === "private";

	return (
		<div className={cn("flex min-w-0 items-start gap-3 border-b py-2 text-sm leading-6", isPrivate ? "justify-end" : "justify-start")}>
			<div className={cn("flex w-full min-w-0 flex-col gap-1", isPrivate ? "items-end" : "items-start")}>
				<div className={cn("max-w-[75%] whitespace-normal text-left [overflow-wrap:normal] [word-break:normal]", isPrivate && "rounded-md bg-muted px-3 py-1")}>
					<div className="flex min-w-0 flex-col items-start gap-1">
						<span>{line.text}</span>
						{line.time && <span className="whitespace-nowrap text-xs text-muted-foreground">{line.time}</span>}
					</div>
				</div>
				{line.linkedBlockId && (
					<Button className={cn("shrink-0", isPrivate ? "self-end" : "self-start")} variant="ghost" size="sm" onClick={() => onJumpToBlock?.(line.linkedBlockId as string)}>
						<CornerDownRight className="h-4 w-4" />
						跳至想法
					</Button>
				)}
			</div>
		</div>
	);
}
