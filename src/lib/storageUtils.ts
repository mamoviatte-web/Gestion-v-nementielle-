/**
 * storageUtils — chargement robuste d'images pour le PDF.
 * Passe par un fetch → base64 (évite le « canvas tainted » CORS) et régénère
 * une URL signée pour les objets Supabase Storage (publics ou privés).
 */

import type jsPDF from 'jspdf';
import { supabase } from '@/lib/supabase';

/** Résout l'URL réellement téléchargeable (URL signée si objet Supabase). */
async function resolveUrl(url: string): Promise<string> {
  // .../storage/v1/object/(public|sign|authenticated)/<bucket>/<path>[?...]
  const m = url.match(/\/storage\/v1\/object\/(?:public|sign|authenticated)\/([^/]+)\/([^?]+)/);
  if (!m) return url;
  const [, bucket, path] = m;
  try {
    const { data } = await supabase.storage.from(bucket).createSignedUrl(decodeURIComponent(path), 120);
    return data?.signedUrl ?? url;
  } catch {
    return url;
  }
}

/** Télécharge une image et renvoie un dataURL base64 (null si échec). */
export async function imageToBase64(url: string): Promise<string | null> {
  if (!url) return null;
  try {
    const fetchUrl = await resolveUrl(url);
    const res = await fetch(fetchUrl);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    return await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result as string);
      r.onerror = () => reject(new Error('FileReader'));
      r.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

export interface PdfImage {
  data: string;
  format: 'JPEG' | 'PNG';
  w: number;
  h: number;
}

/** Base64 + dimensions naturelles (via un Image sur le dataURL, sans canvas). */
export async function imageForPdf(url: string): Promise<PdfImage | null> {
  const data = await imageToBase64(url);
  if (!data) return null;
  const format: 'JPEG' | 'PNG' = /^data:image\/png/i.test(data) ? 'PNG' : 'JPEG';
  try {
    const dims = await new Promise<{ w: number; h: number }>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve({ w: img.naturalWidth || 1, h: img.naturalHeight || 1 });
      img.onerror = () => reject(new Error('img'));
      img.src = data;
    });
    return { data, format, ...dims };
  } catch {
    return { data, format, w: 1, h: 1 };
  }
}

/** Dessine une image dans le PDF (aspect conservé) ou un placeholder gris. */
export async function addImageToPDF(
  doc: jsPDF,
  url: string,
  x: number,
  y: number,
  w: number,
  h: number,
  label?: string,
): Promise<void> {
  const img = await imageForPdf(url);
  if (img) {
    const ratio = Math.min(w / img.w, h / img.h);
    const iw = img.w * ratio;
    const ih = img.h * ratio;
    doc.addImage(img.data, img.format, x + (w - iw) / 2, y + (h - ih) / 2, iw, ih, undefined, 'FAST');
  } else {
    doc.setFillColor(240, 238, 234);
    doc.rect(x, y, w, h, 'F');
    doc.setFontSize(9);
    doc.setTextColor(180, 178, 170);
    doc.text('Photo', x + w / 2, y + h / 2 - 2, { align: 'center' });
    doc.text('non disponible', x + w / 2, y + h / 2 + 4, { align: 'center' });
  }
  if (label) {
    doc.setFontSize(8);
    doc.setTextColor(120, 120, 120);
    doc.text(label, x + w / 2, y + h + 4, { align: 'center' });
  }
}
