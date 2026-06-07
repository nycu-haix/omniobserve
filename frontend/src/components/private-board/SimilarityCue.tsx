import { Lightbulb, X } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import type { SimilarityCueData } from "../../types";
import { Button } from "../ui/Button";

interface SimilarityCueProps {
	cues: SimilarityCueData[];
	onJump: (blockId: string) => void;
	onDismiss: (cueId: string) => void;
	topContent?: ReactNode;
}

const CUE_AUTO_DISMISS_MS = 5000;

export function SimilarityCue({ cues, onJump, onDismiss, topContent }: SimilarityCueProps) {
	const onDismissRef = useRef(onDismiss);

	useEffect(() => {
		onDismissRef.current = onDismiss;
	}, [onDismiss]);

	useEffect(() => {
		if (cues.length === 0) {
			return;
		}

		const timers = cues.map(cue => window.setTimeout(() => onDismissRef.current(cue.id), CUE_AUTO_DISMISS_MS));
		return () => timers.forEach(timer => window.clearTimeout(timer));
	}, [cues]);

	if (cues.length === 0) {
		return null;
	}

	return (
		<div className="fixed bottom-20 right-4 z-50 flex w-[min(360px,calc(100vw-2rem))] flex-col gap-2">
			{topContent}
			{cues.map(cue => {
				const message = (cue.isSameReason ?? true) ? "有人和你想法一樣，要不要試著發表？" : "有人和你有相似的想法但原因略有不同，要不要分享交流？";
				return (
					<div className="animate-in slide-in-from-right-4 fade-in-0 rounded-lg border bg-background p-3 shadow-lg" key={cue.id}>
						<div className="mb-3 flex items-start gap-2 text-sm">
							<Lightbulb className="mt-0.5 h-4 w-4 shrink-0" />
							<span>{message}</span>
						</div>
						<div className="flex justify-end gap-2">
							<Button size="sm" onClick={() => onJump(cue.blockId)}>
								查看想法
							</Button>
							<Button aria-label="Dismiss similarity cue" size="icon" variant="ghost" onClick={() => onDismiss(cue.id)}>
								<X className="h-4 w-4" />
							</Button>
						</div>
					</div>
				);
			})}
		</div>
	);
}
