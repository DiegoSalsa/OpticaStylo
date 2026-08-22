import PublicFooter from "@/components/navigation/public-footer";
import PublicHeader from "@/components/navigation/public-header";

import Glasses3DOverlay from "./glasses-3d-overlay";
import styles from "./virtual-try-on-3d.module.css";

export const metadata = {
  description: "Pruébate un marco óptico 3D en tiempo real y de forma privada.",
  title: "Probador virtual 3D | Óptica Stylo",
};

export default function VirtualTryOn3DPage() {
  return <>
    <PublicHeader />
    <main className={styles.page}>
      <Glasses3DOverlay />
    </main>
    <PublicFooter />
  </>;
}
