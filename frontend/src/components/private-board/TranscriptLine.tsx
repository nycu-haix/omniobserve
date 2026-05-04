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
		<div className={cn("flex items-start gap-2 border-b py-2 text-sm leading-6", isPrivate ? "justify-end text-right" : "justify-between")}>
			<span className={cn("min-w-0 max-w-[82%]", isPrivate && "rounded-md bg-muted px-3 py-1")}>
				{line.text}
				{line.time && <span className="ml-2 whitespace-nowrap text-xs text-muted-foreground">{line.time}</span>}
			</span>
			{line.linkedBlockId && (
				<Button className="shrink-0" variant="ghost" size="sm" onClick={() => onJumpToBlock?.(line.linkedBlockId as string)}>
					<CornerDownRight className="h-4 w-4" />
					跳至想法
				</Button>
			)}
		</div>
	);
}
