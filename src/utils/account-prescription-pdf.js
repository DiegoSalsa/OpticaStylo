import { PDFDocument, StandardFonts } from "pdf-lib";

export async function createAccountPrescriptionPdf(prescription, account) {
  const doc = await PDFDocument.create();
  doc.setTitle("Copia de receta clínica — Óptica Stylo");
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const available = new Set(regular.getCharacterSet());
  const page = doc.addPage([595, 842]);
  const margin = 52;
  const width = page.getWidth() - 2 * margin;
  let y = 770;

  function line(value, size = 12, font = regular) {
    const text = [...String(value).normalize("NFC").replace(/\s+/g, " ")]
      .map((char) => available.has(char.codePointAt(0)) ? char : "?").join("");
    const rows = [];
    let row = "";
    for (const char of text) {
      if (font.widthOfTextAtSize(row + char, size) > width) {
        rows.push(row);
        row = "";
      }
      row += char;
    }
    if (row) rows.push(row);
    for (const part of rows) {
      page.drawText(part, { x: margin, y, size, font });
      y -= size + 8;
    }
  }

  const value = (number) => number == null ? "—" : String(number);
  const eye = ({ sphere, cylinder, axis, addition }) =>
    "Esfera " + value(sphere) + "   Cilindro " + value(cylinder) + "   Eje " + value(axis) + "   Adición " + value(addition);

  line("Óptica Stylo", 24, bold);
  line("Copia de receta clínica", 18, bold);
  y -= 16;
  line("Paciente: " + [account.firstNames, account.lastNames].filter(Boolean).join(" "));
  line("RUT: " + account.rut);
  line("Fecha de emisión: " + new Intl.DateTimeFormat("es-CL", { dateStyle: "long", timeZone: "America/Santiago" }).format(prescription.issuedAt));
  if (prescription.professional) line("Profesional: " + [prescription.professional.firstName, prescription.professional.lastName].join(" "));
  y -= 16;
  line("Ojo derecho (OD)", 13, bold);
  line(eye(prescription.rightEye));
  line("Ojo izquierdo (OI)", 13, bold);
  line(eye(prescription.leftEye));
  line("Distancia pupilar: " + value(prescription.pupillaryDistance));
  return doc.save();
}
