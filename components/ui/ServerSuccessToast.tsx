"use client";

import { useEffect, useRef } from "react";
import { toast } from "sonner";

export function ServerSuccessToast({ message }: { message: string }) {
	const firedRef = useRef(false);
	useEffect(() => {
		if (message && message.trim().length > 0 && !firedRef.current) {
			firedRef.current = true;
			toast.success(message);
		}
	}, [message]);
	return null;
}

