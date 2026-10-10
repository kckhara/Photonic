import type { Photo, VideoClip } from "@/lib/types";

/** One line in the on-screen score readout. Points are null when the line is a note, not a penalty. */
export type ScoreRow = {
  label: string;
  points: number | null;
};

/**
 * What the player draws in the corner of the current picture.
 * Photos show the stock score (lower is less like stock).
 * Clips have no stock score, so the lines say how that clip was picked.
 */
export type ScoreCaption = {
  heading: string;
  word: string;
  rows: ScoreRow[];
  note: string;
};

/** Caption for the photo on screen. `keyword` is the lyric word it was searched with. */
export function photoScoreCaption(photo: Photo, keyword: string): ScoreCaption {
  const word = keyword.trim();

  if (photo.stockScore == null) {
    return {
      heading: "Photo",
      word,
      rows: [{ label: "Score was not saved with this photo", points: null }],
      note: "",
    };
  }

  const reasons = photo.stockReasons ?? [];

  return {
    heading: String(photo.stockScore),
    word,
    rows:
      reasons.length === 0
        ? [{ label: "No stock points", points: null }]
        : reasons.map(reasonRow),
    note: "Lower means less like a stock photo.",
  };
}

/** Caption for the clip on screen. Clips are chosen, not stock-scored. */
export function videoScoreCaption(clip: VideoClip, keyword: string): ScoreCaption {
  const rows: ScoreRow[] = [
    {
      label: clip.preferredAccount
        ? "Preferred account, so it plays first"
        : "First unused landscape clip for this word",
      points: null,
    },
  ];

  if (clip.width > 0) {
    rows.push({ label: `Landscape, ${clip.width}px wide`, points: null });
  }

  return {
    heading: "Clip",
    word: keyword.trim(),
    rows,
    note: "Clips are picked for the word, not scored like photos.",
  };
}

function reasonRow(reason: string): ScoreRow {
  const pointsMatch = /\(\+(\d+)\)\s*$/.exec(reason);
  const points = pointsMatch ? Number(pointsMatch[1]) : null;
  const body = reason.replace(/\s*\(\+\d+\)\s*$/, "").trim();
  return { label: viewerReason(body), points };
}

/** Turn a stored stock reason into a line a viewer can read. */
function viewerReason(body: string): string {
  const bright = /^very bright, brightness ([\d.]+)$/i.exec(body);
  if (bright) return `Very bright, ${bright[1]}`;

  const saturated = /^very saturated, saturation ([\d.]+)$/i.exec(body);
  if (saturated) return `Very saturated, ${saturated[1]}`;

  const description = /^description: (.+)$/i.exec(body);
  if (description) return `“${description[1]}” in the description`;

  const url = /^url: (.+)$/i.exec(body);
  if (url) return `“${url[1]}” in the address`;

  const frequent =
    /^most frequent photographer, (\d+) cached photos$/i.exec(body);
  if (frequent) {
    const count = Number(frequent[1]);
    return count === 1
      ? "Photographer appears in 1 cached photo"
      : `Photographer appears in ${count} cached photos`;
  }

  return body;
}
