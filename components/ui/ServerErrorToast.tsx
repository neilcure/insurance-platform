"use client";

import { useEffect } from "react";
import { toast } from "sonner";

export function ServerErrorToast({ message }: { message: string }) {
	useEffect(() => {
		if (message && message.trim().length > 0) {
			toast.error(message);
		}
	}, [message]);
	return null;
}

