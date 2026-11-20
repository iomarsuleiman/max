import type { ProfileCard } from "@/lib/domain/profileCard";
import { profileCardBackSvg, profileCardSvg } from "@/lib/domain/profileCardImage";
export { profileCardBackSvg, profileCardSvg };

/** Both sides of the card as one PNG, rasterized locally. Card text never leaves the browser. */
export async function profileCardPng(card: ProfileCard, note: { text: string; from: string }, invite?: string | null): Promise<Blob> {
  // Both sides, side by side: the artwork and the handwritten note on the back.
  const front = profileCardSvg(card, "png-front");
  const back = profileCardBackSvg(card, note, "png-back", invite);
  const gap = 32;
  const width = front.width * 2 + gap;
  const height = front.height;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><g>${front.svg}</g><g transform="translate(${front.width + gap} 0)">${back}</g></svg>`;
  const svgUrl = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
  try {
    const image = new Image();
    image.src = svgUrl;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = width * 3;
    canvas.height = height * 3;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Your browser couldn't create the card image. Try another browser.");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((value) => (value ? resolve(value) : reject(new Error("Couldn't export your card. Try again."))), "image/png"),
    );
    return blob;
  } finally {
    URL.revokeObjectURL(svgUrl);
  }
}

export const CARD_FILE_NAME = "max-workspace-card.png";

/** Downloads both sides of the card, side by side. */
export async function downloadProfileCardPng(card: ProfileCard, note: { text: string; from: string }, invite?: string | null): Promise<void> {
  const url = URL.createObjectURL(await profileCardPng(card, note, invite));
  const link = document.createElement("a");
  link.href = url;
  link.download = CARD_FILE_NAME;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Shares the card image with the system share sheet where the browser can, with your invite link.
 * Returns false when it can't share files, so the caller can fall back to copying the link.
 */
export async function shareProfileCard(card: ProfileCard, note: { text: string; from: string }, url: string): Promise<boolean> {
  const file = new File([await profileCardPng(card, note, url)], CARD_FILE_NAME, { type: "image/png" });
  const data: ShareData = { files: [file], title: "My Max card", text: `Join me on Max: ${url}` };
  if (typeof navigator.canShare !== "function" || !navigator.canShare(data)) return false;
  try {
    await navigator.share(data);
  } catch (err) {
    if ((err as DOMException).name !== "AbortError") throw err;
  }
  return true;
}
