export function isRecent(input?: string | number | Date, windowDays = 7): boolean {
	if (!input) return false;
	const date = input instanceof Date ? input : new Date(input);
	if (Number.isNaN(date.getTime())) return false;
	const now = Date.now();
	const windowMs = windowDays * 24 * 60 * 60 * 1000;
	return now - date.getTime() <= windowMs;
}

