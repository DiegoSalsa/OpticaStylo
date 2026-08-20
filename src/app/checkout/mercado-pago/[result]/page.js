import { notFound } from "next/navigation";
import PublicFooter from "@/components/navigation/public-footer";
import PublicHeader from "@/components/navigation/public-header";
import CheckoutResult from "./result-experience";
import "./result.css";

const RESULTS = new Set(["failure", "pending", "success"]);
export const metadata = { title: "Estado del pago" };
export default async function CheckoutResultPage({ params }) {
  const { result } = await params;
  if (!RESULTS.has(result)) notFound();
  return <><PublicHeader /><CheckoutResult providerResult={result} /><PublicFooter /></>;
}
