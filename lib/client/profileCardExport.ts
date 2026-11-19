import type { ProfileCard } from "@/lib/domain/profileCard";
import { profileCardBackSvg, profileCardSvg } from "@/lib/domain/profileCardImage";
export { profileCardBackSvg, profileCardSvg };

/** Rasterize locally. Card text never leaves the browser. */
export async function downloadProfileCardPng(card: ProfileCard): Promise<void> {
  // Both sides, side by side: the artwork and, on the back, the handwritten number and the code.
  const front = profileCardSvg(card, "png-front");
  const back = profileCardBackSvg(card, "png-back", front.height);
  const gap = 32;
  const width = front.width * 2 + gap;
  const height = front.height;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><g>${front.svg}</g><g transform="translate(${front.width + gap} 0)">${back}</g></svg>`;
  const svgUrl = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
  let pngUrl: string | null = null;
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
    pngUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = pngUrl;
    link.download = "max-workspace-card.png";
    link.click();
  } finally {
    URL.revokeObjectURL(svgUrl);
    if (pngUrl) {
      const url = pngUrl;
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  }
}
