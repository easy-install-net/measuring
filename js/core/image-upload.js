import { doc, setDoc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { db } from "../config/firebase-init.js";

const MEDIA_COLLECTION = "measuring_media";

export function compressSitePhoto(file, maxWidth = 1400, quality = 0.78) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxWidth / img.width);
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export async function uploadMediaToCloud(projectId, pageId, file) {
  const compressedDataUrl = await compressSitePhoto(file);
  const mediaId = `${projectId}_${pageId}_${Date.now()}`;
  const mediaRef = doc(db, MEDIA_COLLECTION, mediaId);

  await setDoc(mediaRef, {
    projectId,
    pageId,
    imageData: compressedDataUrl,
    createdAt: Date.now()
  });

  return { mediaId, imageData: compressedDataUrl };
}

export async function fetchMediaFromCloud(mediaId) {
  const snap = await getDoc(doc(db, MEDIA_COLLECTION, mediaId));
  return snap.exists() ? snap.data().imageData : null;
}
