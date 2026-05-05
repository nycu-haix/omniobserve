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
		<div className={cn("flex min-w-0 items-start gap-3 border-b py-2 text-sm leading-6", isPrivate ? "justify-end text-right" : "justify-start text-left")}>
			<div className="flex flex-col gap-1">
				<span className={cn("min-w-0 max-w-[75%] whitespace-pre-wrap break-words", isPrivate && "ml-auto rounded-md bg-muted px-3 py-1")}>
					<span className="break-words">{line.text}</span>
					{line.time && <span className="ml-2 whitespace-nowrap text-xs text-muted-foreground">{line.time}</span>}
				</span>
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
