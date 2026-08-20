import PublicFooter from "@/components/navigation/public-footer";
import PublicHeader from "@/components/navigation/public-header";

import CartExperience from "./cart-experience";
import "./cart.css";
import "./checkout-stitch.css";

export const metadata = { title: "Carrito | Óptica Stylo" };

export default function CartPage() { return <><PublicHeader /><CartExperience /><PublicFooter /></>; }
