import Image from "next/image";

export default function BrandLogo({ compact = false, priority = false }) {
  return (
    <span className={compact ? "brand-logo brand-logo--compact" : "brand-logo"}>
      <Image
        alt="Óptica Stylo"
        className="brand-logo__source"
        decoding="async"
        fetchPriority={priority ? "high" : "auto"}
        height={310}
        priority={priority}
        src="/brand/optica-stylo.svg"
        width={690}
      />
    </span>
  );
}
