"use client";

import Image from "next/image";
import { useState } from "react";
import { cloudinaryProductLoader, isCloudinaryProductUrl } from "@/utils/cloudinary-product-image";

export default function CloudinaryProductImage({ image, children = null, ...props }) {
  const [failedUrl, setFailedUrl] = useState(null);
  if (!isCloudinaryProductUrl(image?.url) || image.url === failedUrl) return children;
  return <Image {...props} alt={image.alt} fill loader={cloudinaryProductLoader} onError={() => setFailedUrl(image.url)} src={image.url} />;
}
