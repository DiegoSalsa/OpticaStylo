import "./globals.css";

export const metadata = {
  description: "Tienda, reservas y atención visual de Óptica Stylo.",
  title: {
    default: "Óptica Stylo",
    template: "%s | Óptica Stylo",
  },
};

export default function RootLayout({ children }) {
  return (
    <html lang="es-CL">
      <body>{children}</body>
    </html>
  );
}
