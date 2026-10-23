// Usar únicamente recursos persistidos del directorio de productos; conservar la versión para caché.
export function isCloudinaryProductUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "res.cloudinary.com" && !url.search && !url.hash
      && !url.username && !url.password && /^\/[a-z0-9_-]+\/image\/upload\/(?:v\d+\/)?opticastylo\/productos\/[a-z0-9_./-]+$/i.test(url.pathname);
  } catch { return false; }
}

export function cloudinaryProductLoader({ src, width }) {
  if (!isCloudinaryProductUrl(src) || !Number.isInteger(width) || width < 1 || width > 3840) throw new Error("La imagen del producto no tiene una URL de Cloudinary válida.");
  // limit no recorta ni amplía el original; contain y el espacio reservado se resuelven con CSS.
  return src.replace("/image/upload/", `/image/upload/c_limit,w_${width},f_auto,q_auto/`);
}
