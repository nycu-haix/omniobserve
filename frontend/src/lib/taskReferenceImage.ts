const TASK_REFERENCE_IMAGE_RETRY_PARAM = "_retry";
const RELATIVE_URL_BASE = "https://omniobserve.local";

export function buildTaskReferenceImageSrc(referenceImageSrc: string, retryToken: number): string {
	if (!referenceImageSrc || retryToken <= 0) {
		return referenceImageSrc;
	}

	const resolvedUrl = new URL(referenceImageSrc, RELATIVE_URL_BASE);
	resolvedUrl.searchParams.set(TASK_REFERENCE_IMAGE_RETRY_PARAM, String(retryToken));

	if (referenceImageSrc.startsWith("http://") || referenceImageSrc.startsWith("https://")) {
		return resolvedUrl.toString();
	}

	return `${resolvedUrl.pathname}${resolvedUrl.search}${resolvedUrl.hash}`;
}
