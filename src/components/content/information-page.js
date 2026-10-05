import PublicFooter from "@/components/navigation/public-footer";
import PublicHeader from "@/components/navigation/public-header";

export default function InformationPage({ children, eyebrow, intro, title }) {
  return <><PublicHeader /><main className="information-page"><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p className="information-intro">{intro}</p><div className="information-content">{children}</div></main><PublicFooter /></>;
}
