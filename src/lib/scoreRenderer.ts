/**
 * scoreRenderer — rendu des scores sans caractère Unicode spécial (★ ☆),
 * qui s'affichent mal dans jsPDF (glyphes absents → « &&&&& »).
 * On dessine des cercles : HTML pour l'aperçu, vecteur pour le PDF.
 */

const FILLED = '#C9A646'; // or
const EMPTY = '#E8E4DA'; // gris pierre

/** Cercles HTML (aperçu / navigateur). */
export function renderScoreCircles(score: number | null, max = 5): string {
  return Array.from({ length: max }, (_, i) => {
    const filled = i < (score ?? 0);
    return `<span style="display:inline-block;width:11px;height:11px;border-radius:50%;margin-right:3px;vertical-align:middle;background-color:${filled ? FILLED : EMPTY};"></span>`;
  }).join('');
}

/** Dessine les cercles dans un doc jsPDF à partir de (x,y) en mm. */
export function drawScoreCircles(
  doc: { setFillColor: (r: number, g: number, b: number) => void; circle: (x: number, y: number, r: number, style: string) => void },
  score: number | null,
  x: number,
  y: number,
  max = 5,
): void {
  for (let i = 0; i < max; i++) {
    const filled = i < (score ?? 0);
    doc.setFillColor(filled ? 201 : 232, filled ? 166 : 228, filled ? 70 : 218);
    doc.circle(x + i * 6, y, 1.9, 'F');
  }
}

/** Texte sécurisé : « 4/5 », jamais « ★★★★☆ ». */
export function formatScoreText(score: number | null, max = 5): string {
  if (score == null) return 'Non évalué';
  return `${score}/${max}`;
}
