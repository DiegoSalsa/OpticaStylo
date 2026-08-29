import { Suspense } from "react";

import PublicFooter from "@/components/navigation/public-footer";
import PublicHeader from "@/components/navigation/public-header";

import AccountExperience from "./account-experience";
import "./account.css";

export const metadata = { title: "Mi cuenta | Óptica Stylo" };

export default function AccountPage() {
  return (
    <>
      <PublicHeader />
      <Suspense fallback={<main className="account-page"><div className="account-loading" aria-label="Preparando tu cuenta" /></main>}>
        <AccountExperience />
      </Suspense>
      <PublicFooter />
    </>
  );
}
