import { cn } from "../../lib/utils";

export function ShortcutKey({ label, className }: { label: string; className?: string }) {
	return (
		<kbd
			className={cn(
				"inline-flex h-5 min-w-5 translate-y-px items-center justify-center rounded border border-current bg-background/20 px-1.5 font-mono text-[11px] font-semibold leading-none opacity-80",
				className
			)}
			aria-hidden="true"
		>
			{label}
		</kbd>
	);
}
