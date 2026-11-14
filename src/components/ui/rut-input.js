"use client";

import { useState } from "react";
import { normalizeChileanRut } from "@/utils/chilean-rut";

function formatRut(value) {
  const normalized = normalizeChileanRut(value);
  if (!normalized) return value;
  const [body, digit] = normalized.split("-");
  const grouped = body.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${grouped}-${digit}`;
}

export default function RutInput({ defaultValue, value, onChange, onBlur, ...props }) {
  const [editing, setEditing] = useState(false);
  const controlled = value !== undefined;

  return (
    <input
      autoCapitalize="characters"
      placeholder="12.345.678-5"
      spellCheck={false}
      {...props}
      defaultValue={formatRut(defaultValue)}
      value={editing ? value : formatRut(value)}
      onChange={(event) => {
        if (controlled) setEditing(true);
        onChange?.(event);
      }}
      onBlur={(event) => {
        // Mantener el texto de búsqueda original al mostrar su formato de RUT.
        if (controlled) setEditing(false);
        else event.currentTarget.value = formatRut(event.currentTarget.value);
        onBlur?.(event);
      }}
    />
  );
}
