import { CornerDownRight } from "lucide-react";
import type { TranscriptLine as TranscriptLineType } from "../../types";
import { Button } from "../ui/Button";

interface TranscriptLineProps {
	line: TranscriptLineType;
	onJumpToBlock?: (blockId: string) => void;
}

export function TranscriptLine({ line, onJumpToBlock }: TranscriptLineProps) {
	return (
		<div className="flex items-start justify-between gap-2 border-b py-2 text-sm leading-6">
			<span className="min-w-0">{line.text}</span>
			{line.linkedBlockId && (
				<Button className="shrink-0" variant="ghost" size="sm" onClick={() => onJumpToBlock?.(line.linkedBlockId as string)}>
					<CornerDownRight className="h-4 w-4" />
					跳至想法
				</Button>
			)}
		</div>
	);
}
