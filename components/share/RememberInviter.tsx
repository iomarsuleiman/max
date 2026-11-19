"use client";

import { useEffect } from "react";

export const INVITER_KEY = "max:invited-by";

/** Remembers whose invite link brought this visitor here, until their account is set up. */
export function RememberInviter({ member }: { member: number }) {
  useEffect(() => {
    try {
      localStorage.setItem(INVITER_KEY, String(member));
    } catch {
      // Storage can be unavailable; the invite just won't carry a note.
    }
  }, [member]);
  return null;
}
