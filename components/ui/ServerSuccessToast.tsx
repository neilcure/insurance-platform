"use client";

import { useEffect } from "react";
import { toast } from "sonner";

export function ServerSuccessToast({ message }: { message: string }) {
	useEffect(() => {
		if (message && message.trim().length > 0) {
			toast.success(message);
		}
	}, [message]);
	return null;
}

