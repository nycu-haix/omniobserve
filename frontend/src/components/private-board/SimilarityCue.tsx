import { Lightbulb, X } from "lucide-react";
import type { SimilarityCueData } from "../../types";
import { Button } from "../ui/Button";

interface SimilarityCueProps {
	cues: SimilarityCueData[];
	onJump: (blockId: string) => void;
	onDismiss: (cueId: string) => void;
}

export function SimilarityCue({ cues, onJump, onDismiss }: SimilarityCueProps) {
	if (cues.length === 0) {
		return null;
	}

	return (
		<div className="fixed bottom-20 right-4 z-50 flex w-[min(360px,calc(100vw-2rem))] flex-col gap-2">
			{cues.map(cue => (
				<div className="animate-in slide-in-from-right-4 fade-in-0 rounded-lg border bg-background p-3 shadow-lg" key={cue.id}>
					<div className="mb-3 flex items-start gap-2 text-sm">
						<Lightbulb className="mt-0.5 h-4 w-4 shrink-0" />
						<span>有人也覺得「{cue.blockSummary}」</span>
					</div>
					<div className="flex justify-end gap-2">
						<Button size="sm" onClick={() => onJump(cue.blockId)}>
							跳至想法
						</Button>
						<Button aria-label="Dismiss similarity cue" size="icon" variant="ghost" onClick={() => onDismiss(cue.id)}>
							<X className="h-4 w-4" />
						</Button>
					</div>
				</div>
			))}
		</div>
	);
}
