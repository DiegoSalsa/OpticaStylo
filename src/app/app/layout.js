import InternalShell from "@/components/internal/internal-shell";
import "./internal.css";
import "./stitch-internal.css";

export default function ApplicationLayout({ children }) {
  return <InternalShell>{children}</InternalShell>;
}
