/* Admin — image upload to the public `media` bucket.
 *
 * Photos straight off a phone are often 4–12 MB and 4000px wide. They are
 * scaled to at most 2000px and re-encoded as JPEG in the browser first, so
 * uploads are quick on a phone connection and pages stay light.
 */
import { sb, slugify } from '../core.js';

const MAX_EDGE = 2000;

async function shrink(file) {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) {
    throw new Error('Please choose a JPEG, PNG or WebP image.');
  }
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return file;                           // let the server decide
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  if (scale === 1 && file.size < 1.5 * 1024 * 1024) return file;

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.85));
  return blob ? new File([blob], file.name.replace(/\.\w+$/, '.jpg'), { type: 'image/jpeg' }) : file;
}

/** Upload an image and return its public URL. */
export async function uploadImage(file, folder) {
  const ready = await shrink(file);
  const ext = ready.type === 'image/png' ? 'png' : ready.type === 'image/webp' ? 'webp' : 'jpg';
  const base = slugify(file.name.replace(/\.\w+$/, '')) || 'image';
  const path = `${folder}/${Date.now()}-${base}.${ext}`;

  const { error } = await sb.storage.from('media').upload(path, ready, {
    cacheControl: '31536000',
    contentType: ready.type,
    upsert: false,
  });
  if (error) throw new Error(`Upload failed: ${error.message}`);
  return sb.storage.from('media').getPublicUrl(path).data.publicUrl;
}
