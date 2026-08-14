import "./globals.css";

export const metadata = {
  description: "Plataforma comercial y clínica de Óptica Stylo.",
  title: {
    default: "Óptica Stylo",
    template: "%s | Óptica Stylo",
  },
};

export default function RootLayout({ children }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
