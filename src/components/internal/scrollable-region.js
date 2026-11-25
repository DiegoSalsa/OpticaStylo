"use client";

import { useEffect, useId, useRef, useState } from "react";
import "./scrollable-region.css";

export default function ScrollableRegion({ children, className, hint, label, ...attributes }) {
  const container = useRef(null);
  const hintId = useId();
  const [overflow, setOverflow] = useState(false);

  useEffect(() => {
    const viewport = container.current;
    const content = viewport.firstElementChild;
    const measure = () => setOverflow(viewport.scrollWidth > viewport.clientWidth);
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    if (content) observer.observe(content);
    measure();
    return () => observer.disconnect();
  }, []);

  return <>
    {overflow && <p className="scroll-region-hint" id={hintId}>{hint} Con el teclado, usa las flechas izquierda y derecha.</p>}
    <div
      {...attributes}
      aria-describedby={overflow ? hintId : undefined}
      aria-label={overflow ? label : undefined}
      className={className ? `scroll-region ${className}` : "scroll-region"}
      ref={container}
      role={overflow ? "region" : undefined}
      tabIndex={overflow ? 0 : undefined}
    >
      {children}
    </div>
  </>;
}
