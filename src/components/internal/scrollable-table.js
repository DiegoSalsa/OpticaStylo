"use client";

import { useEffect, useId, useRef, useState } from "react";
import "./scrollable-table.css";

export default function ScrollableTable({ children, label }) {
  const container = useRef(null);
  const hintId = useId();
  const [overflow, setOverflow] = useState(false);

  useEffect(() => {
    const viewport = container.current;
    const table = viewport.querySelector("table");
    const measure = () => setOverflow(viewport.scrollWidth > viewport.clientWidth);
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    if (table) observer.observe(table);
    measure();
    return () => observer.disconnect();
  }, []);

  return <>
    {overflow && <p className="scroll-table-hint" id={hintId}>Desplaza la tabla para ver todas las columnas. Con el teclado, usa las flechas izquierda y derecha.</p>}
    <div
      aria-describedby={overflow ? hintId : undefined}
      aria-label={overflow ? label : undefined}
      className="scroll-table"
      data-scroll-table=""
      ref={container}
      role={overflow ? "region" : undefined}
      tabIndex={overflow ? 0 : undefined}
    >
      {children}
    </div>
  </>;
}
