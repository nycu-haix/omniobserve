import type { MicMode } from "../types";

export function getNextMicModeAfterPublicActivation(currentMode: MicMode): MicMode {
	return currentMode === "public" ? "private" : "public";
}
