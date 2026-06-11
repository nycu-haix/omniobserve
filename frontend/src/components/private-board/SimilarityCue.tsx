import { Eye, Lightbulb, UserRound, X } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import type { SimilarityCueData, SimilarityPairCueData } from "../../types";
import { Button } from "../ui/Button";

interface SimilarityCueProps {
	cues: SimilarityCueData[];
	onJump: (cue: SimilarityPairCueData) => void;
	onDismiss: (cue: SimilarityCueData, status: "dismissed" | "ignored") => void;
	onShareReason: (cue: SimilarityCueData) => void;
	topContent?: ReactNode;
}

const CUE_AUTO_DISMISS_MS = 5000;
const DIFFERENT_REASON_CUE_AUTO_DISMISS_MS = 12000;
const SUMMARY_CUE_AUTO_DISMISS_MS = 8000;

function getCueAutoDismissMs(cue: SimilarityCueData): number {
	if (cue.kind === "phase-transition-summary") {
		return SUMMARY_CUE_AUTO_DISMISS_MS;
	}
	return cue.isSameReason === false ? DIFFERENT_REASON_CUE_AUTO_DISMISS_MS : CUE_AUTO_DISMISS_MS;
}

export function SimilarityCue({ cues, onJump, onDismiss, onShareReason, topContent }: SimilarityCueProps) {
	const onDismissRef = useRef(onDismiss);

	useEffect(() => {
		onDismissRef.current = onDismiss;
	}, [onDismiss]);

	useEffect(() => {
		if (cues.length === 0) {
			return;
		}

		const timers = cues.map(cue => window.setTimeout(() => onDismissRef.current(cue, "ignored"), getCueAutoDismissMs(cue)));
		return () => timers.forEach(timer => window.clearTimeout(timer));
	}, [cues]);

	if (cues.length === 0 && !topContent) {
		return null;
	}

	return (
		<div className="fixed bottom-20 right-4 z-50 flex w-[min(360px,calc(100vw-2rem))] flex-col gap-2">
			{topContent}
			{cues.map(cue => {
				if (cue.kind === "phase-transition-summary") {
					return (
						<div className="animate-in slide-in-from-right-4 fade-in-0 rounded-lg border bg-background p-3 shadow-lg" key={cue.id}>
							<div className="mb-3 flex items-start gap-2 text-sm">
								<Lightbulb className="mt-0.5 h-4 w-4 shrink-0" />
								<div className="grid gap-2">
									<span>相似想法摘要</span>
									<div className="grid gap-1 text-muted-foreground">
										<span>Same reason：{cue.sameReasonCount} 個</span>
										<span>Different reason：{cue.differentReasonCount} 個</span>
									</div>
								</div>
							</div>
							<div className="flex justify-end">
								<Button aria-label="Dismiss similarity cue summary" size="icon" variant="ghost" onClick={() => onDismiss(cue, "dismissed")}>
									<X className="h-4 w-4" />
								</Button>
							</div>
						</div>
					);
				}

				const isDifferentReason = cue.isSameReason === false;
				const message = isDifferentReason ? "有人和你有相似的想法但原因略有不同。" : "有人和你想法一樣，要不要試著發表？";
				return (
					<div className="animate-in slide-in-from-right-4 fade-in-0 rounded-lg border bg-background p-3 shadow-lg" key={cue.id}>
						<div className="mb-3 flex items-start gap-2 text-sm">
							<Lightbulb className="mt-0.5 h-4 w-4 shrink-0" />
							<div className="grid gap-1">
								<span>{message}</span>
								{isDifferentReason && <span className="text-muted-foreground">AI：你想不想讓別人知道你的理由？</span>}
							</div>
						</div>
						<div className="flex flex-wrap justify-end gap-2">
							<Button className="gap-1.5" size="sm" title="分享給相似想法對象" onClick={() => onShareReason(cue)}>
								<UserRound className="h-3.5 w-3.5" />
								分享我的理由
							</Button>
							<Button className="gap-1.5" size="sm" variant={isDifferentReason ? "outline" : "default"} onClick={() => onJump(cue)}>
								<Eye className="h-3.5 w-3.5" />
								查看想法
							</Button>
							<Button aria-label="Dismiss similarity cue" size="icon" variant="ghost" onClick={() => onDismiss(cue, "dismissed")}>
								<X className="h-4 w-4" />
							</Button>
						</div>
					</div>
				);
			})}
		</div>
	);
}
