"use client";

import { motion, useReducedMotion } from "motion/react";

// Los SVG y sus interacciones se adaptaron de la colección Its Hover con licencia MIT:
// https://github.com/itshover/itshover
const transition = { duration: 0.32, ease: "easeOut" };
const pulse = { rest: { scale: 1 }, hover: { scale: [1, 1.08, 1], transition } };
const draw = { rest: { pathLength: 1, opacity: 1 }, hover: { pathLength: [1, 0.2, 1], opacity: [1, 0.45, 1], transition } };
const nudgeRight = { rest: { x: 0 }, hover: { x: [0, 4, 0], transition: { duration: 0.45, ease: "easeInOut" } } };
const nudgeLeft = { rest: { x: 0 }, hover: { x: [0, -3, 0], transition: { duration: 0.35, ease: "easeInOut" } } };

function Canvas({ animated, children, className, label, size, strokeWidth, viewBox = "0 0 24 24" }) {
  const motionProps = animated ? { animate: "rest", initial: "rest", whileHover: "hover" } : {};

  return (
    <motion.svg
      aria-hidden={label ? undefined : "true"}
      aria-label={label}
      className={`icon${className ? ` ${className}` : ""}`}
      fill="none"
      focusable="false"
      height={size}
      role={label ? "img" : undefined}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={strokeWidth}
      viewBox={viewBox}
      width={size}
      {...motionProps}
    >
      {children}
    </motion.svg>
  );
}

function Glyph({ animated, name, ...props }) {
  switch (name) {
    case "account":
      return <Canvas animated={animated} {...props}><motion.g style={{ transformOrigin: "50% 50%" }} variants={{ rest: { scale: 1, y: 0 }, hover: { scale: 1.05, y: -1, transition } }}><path d="M8 7a4 4 0 1 0 8 0a4 4 0 0 0 -8 0" /><path d="M6 21v-2a4 4 0 0 1 4 -4h4a4 4 0 0 1 4 4v2" /></motion.g></Canvas>;
    case "arrow":
      return <Canvas animated={animated} {...props}><motion.g variants={nudgeRight}><path d="M5 12l14 0" /><path d="M15 16l4 -4" /><path d="M15 8l4 4" /></motion.g></Canvas>;
    case "calendar":
      return <Canvas animated={animated} {...props}><path d="M3 12a9 9 0 1 0 18 0a9 9 0 0 0 -18 0" /><motion.path d="M12 7v5l3 3" style={{ transformOrigin: "12px 12px" }} variants={{ rest: { rotate: 0 }, hover: { rotate: 360, transition: { duration: 0.85, ease: "easeInOut" } } }} /></Canvas>;
    case "cart":
      return <Canvas animated={animated} {...props}><motion.g variants={{ rest: { x: 0 }, hover: { x: [0, 4, 0], transition } }}><path d="M17 17h-11v-14h-2" /><path d="M6 5l14 1l-1 7h-13" /></motion.g><motion.path d="M6 19m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0" style={{ transformOrigin: "6px 19px" }} variants={{ rest: { rotate: 0 }, hover: { rotate: 360, transition } }} /><motion.path d="M17 19m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0" style={{ transformOrigin: "17px 19px" }} variants={{ rest: { rotate: 0 }, hover: { rotate: 360, transition } }} /></Canvas>;
    case "check":
      return <Canvas animated={animated} {...props}><motion.path d="M5 12l5 5l10 -10" variants={{ rest: { pathLength: 1 }, hover: { pathLength: [1, 0, 1], transition: { duration: 0.42, ease: "easeInOut" } } }} /></Canvas>;
    case "chevron":
      return <Canvas animated={animated} {...props}><motion.path d="M9 6l6 6l-6 6" variants={nudgeRight} /></Canvas>;
    case "eye":
      return <Canvas animated={animated} {...props}><motion.path d="M10 12a2 2 0 1 0 4 0a2 2 0 0 0 -4 0" style={{ transformOrigin: "12px 12px" }} variants={{ rest: { scale: 1 }, hover: { scale: 0.7, transition: { duration: 0.15 } } }} /><motion.path d="M21 12c-2.4 4 -5.4 6 -9 6c-3.6 0 -6.6 -2 -9 -6c2.4 -4 5.4 -6 9 -6c3.6 0 6.6 2 9 6" style={{ transformOrigin: "12px 12px" }} variants={{ rest: { scaleY: 1 }, hover: { scaleY: 0.9, transition: { duration: 0.15 } } }} /></Canvas>;
    case "file":
    case "receipt":
      return <Canvas animated={animated} {...props}><path d="M17 21h-10a2 2 0 0 1 -2 -2v-14a2 2 0 0 1 2 -2h7l5 5v11a2 2 0 0 1 -2 2z" /><motion.path d="M14 3v4a1 1 0 0 0 1 1h4" variants={draw} /><motion.path d="M9 17h6M9 13h6" variants={draw} /></Canvas>;
    case "home":
      return <Canvas animated={animated} {...props}><motion.path d="M5 12l-2 0l9 -9l9 9l-2 0" variants={{ rest: { y: 0, opacity: 1 }, hover: { y: [-2, 0], opacity: [0.6, 1], transition } }} /><motion.path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2 -2v-7" style={{ transformOrigin: "12px 16px" }} variants={{ rest: { scale: 1 }, hover: { scale: [0.95, 1], transition } }} /><motion.path d="M9 21v-6a2 2 0 0 1 2 -2h2a2 2 0 0 1 2 2v6" style={{ transformOrigin: "12px 21px" }} variants={{ rest: { scaleY: 1 }, hover: { scaleY: [0, 1], transition } }} /></Canvas>;
    case "logout":
      return <Canvas animated={animated} {...props}><motion.path d="M14 8v-2a2 2 0 0 0 -2 -2h-7a2 2 0 0 0 -2 2v12a2 2 0 0 0 2 2h7a2 2 0 0 0 2 -2v-2" variants={nudgeLeft} /><motion.g variants={nudgeRight}><path d="M9 12h12" /><path d="M18 15l3 -3l-3 -3" /></motion.g></Canvas>;
    case "menu":
      return <Canvas animated={animated} {...props}><motion.path d="M5 12m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0" style={{ transformOrigin: "5px 12px" }} variants={{ rest: { x: 0, scale: 1 }, hover: { x: [-2, 0], scale: [1, 1.2, 1], transition } }} /><motion.path d="M12 12m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0" style={{ transformOrigin: "12px 12px" }} variants={{ rest: { scale: 1 }, hover: { scale: [1, 1.3, 1], transition: { ...transition, delay: 0.08 } } }} /><motion.path d="M19 12m-1 0a1 1 0 1 0 2 0a1 1 0 0 0 -2 0" style={{ transformOrigin: "19px 12px" }} variants={{ rest: { x: 0, scale: 1 }, hover: { x: [2, 0], scale: [1, 1.2, 1], transition: { ...transition, delay: 0.16 } } }} /></Canvas>;
    case "package":
      return <Canvas animated={animated} {...props}><motion.path d="M12.75 4.25h-6m6 0c2.828 0 4.243 0 5.121.879.879.878.879 2.293.879 5.121v2.5c0 2.828 0 4.243-.879 5.121-.878.879-2.293.879-5.121.879h-6c-2.828 0-4.243 0-5.121-.879C.75 16.993.75 15.578.75 12.75v-2.5c0-2.828 0-4.243.879-5.121.878-.879 2.293-.879 5.121-.879" variants={{ rest: { skewX: 0 }, hover: { skewX: 15, transition } }} /><motion.g variants={{ rest: { x: 0, scale: 1 }, hover: { x: -1, scale: 0.9, transition } }}><path d="M18.75 8.25a4 4 0 0 1-4-4" /><path d="m7 9.75-.75.75.75.75.75-.75z" /><path d="M.75 14.75a4 4 0 0 1 4 4m-4-10.5a4 4 0 0 0 4-4m14 10.5a4 4 0 0 0-4 4" /></motion.g><motion.path d="M12.75 4.25h-6v-.5c0-1.414 0-2.121.44-2.56C7.628.75 8.335.75 9.75.75s2.121 0 2.56.44c.44.438.44 1.145.44 2.56zm0 0c2.828 0 4.243 0 5.121.879.879.878.879 2.293.879 5.121v2.5c0 2.828 0 4.243-.879 5.121-.878.879-2.293.879-5.121.879" variants={nudgeRight} /></Canvas>;
    case "search":
      return <Canvas animated={animated} {...props} viewBox="0 0 32 32"><motion.g style={{ transformOrigin: "13px 13px" }} variants={{ rest: { x: 0, y: 0, rotate: 0 }, hover: { x: [0, 1, 0, -1, 0], y: [0, -1, -2, -1, 0], rotate: [0, -5, 5, -5, 0], transition: { duration: 0.8, ease: "easeInOut" } } }}><path d="m21.393,18.565l7.021,7.021c.781.781.781,2.047,0,2.828h0c-.781.781-2.047.781-2.828,0l-7.021-7.021" /><circle cx="13" cy="13" r="10" strokeLinecap="square" /></motion.g></Canvas>;
    case "shield":
      return <Canvas animated={animated} {...props}><motion.path d="M11.46 20.846a12 12 0 0 1 -7.96 -14.846a12 12 0 0 0 8.5 -3a12 12 0 0 0 8.5 3a12 12 0 0 1 -.09 7.06" style={{ transformOrigin: "12px 12px" }} variants={pulse} /><motion.path d="M15 19l2 2l4 -4" variants={{ rest: { pathLength: 1, opacity: 1 }, hover: { pathLength: [0, 1], opacity: [0, 1], transition } }} /></Canvas>;
    case "sparkle":
      return <Canvas animated={animated} {...props}><motion.path d="M16 18a2 2 0 0 1 2 2a2 2 0 0 1 2 -2a2 2 0 0 1 -2 -2a2 2 0 0 1 -2 2z" style={{ transformOrigin: "18px 18px" }} variants={{ rest: { rotate: 0, scale: 1, opacity: 1 }, hover: { rotate: 90, scale: [1, 1.15, 0.9], opacity: [1, 0.7, 1], transition } }} /><motion.path d="M16 6a2 2 0 0 1 2 2a2 2 0 0 1 2 -2a2 2 0 0 1 -2 -2a2 2 0 0 1 -2 2z" style={{ transformOrigin: "18px 6px" }} variants={{ rest: { rotate: 0, scale: 1, opacity: 1 }, hover: { rotate: -90, scale: [1, 0.8, 1.1], opacity: [1, 0.6, 1], transition } }} /><motion.path d="M9 18a6 6 0 0 1 6 -6a6 6 0 0 1 -6 -6a6 6 0 0 1 -6 6a6 6 0 0 1 6 6z" style={{ transformOrigin: "9px 12px" }} variants={{ rest: { rotate: 0, scale: 1 }, hover: { rotate: 180, scale: [1, 1.2, 1], transition: { duration: 0.6, ease: "easeInOut" } } }} /></Canvas>;
    case "users":
      return <Canvas animated={animated} {...props}><motion.g variants={{ rest: { y: 0, scale: 1 }, hover: { y: -2, scale: 1.05, transition } }}><path d="M9 7m-4 0a4 4 0 1 0 8 0a4 4 0 1 0 -8 0" /><path d="M3 21v-2a4 4 0 0 1 4 -4h4a4 4 0 0 1 4 4v2" /></motion.g><motion.g variants={{ rest: { x: 0, opacity: 1 }, hover: { x: 1, opacity: 0.8, transition } }}><path d="M16 3.13a4 4 0 0 1 0 7.75" /><path d="M21 21v-2a4 4 0 0 0 -3 -3.85" /></motion.g></Canvas>;
    case "chart":
      return <Canvas animated={animated} {...props}><motion.path d="M3 13a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v6a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1z" style={{ transformOrigin: "6px 20px" }} variants={{ rest: { scaleY: 1 }, hover: { scaleY: [0, 1], transition } }} /><motion.path d="M9 5a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v14a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1z" style={{ transformOrigin: "12px 20px" }} variants={{ rest: { scaleY: 1 }, hover: { scaleY: [0, 1], transition: { ...transition, delay: 0.08 } } }} /><motion.path d="M15 9a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v10a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1z" style={{ transformOrigin: "18px 20px" }} variants={{ rest: { scaleY: 1 }, hover: { scaleY: [0, 1], transition: { ...transition, delay: 0.16 } } }} /><motion.path d="M4 20h14" style={{ transformOrigin: "11px 20px" }} variants={{ rest: { scaleX: 1 }, hover: { scaleX: [1, 1.05, 1], transition } }} /></Canvas>;
    case "plus":
      return <Canvas animated={animated} {...props}><motion.g style={{ transformOrigin: "12px 12px" }} variants={{ rest: { scale: 1, y: 0 }, hover: { scale: 1.05, y: -1, transition } }}><path d="M8 7a4 4 0 1 0 8 0a4 4 0 0 0 -8 0" /><path d="M6 21v-2a4 4 0 0 1 4 -4h4" /></motion.g><motion.g style={{ transformOrigin: "19px 19px" }} variants={{ rest: { scale: 1, rotate: 0 }, hover: { scale: 1.15, rotate: 90, transition } }}><path d="M16 19h6" /><path d="M19 16v6" /></motion.g></Canvas>;
    case "settings":
      return <Canvas animated={animated} {...props} viewBox="0 0 32 32"><motion.g style={{ transformOrigin: "16px 16px" }} variants={{ rest: { rotate: 0 }, hover: { rotate: 360, transition: { duration: 0.9, ease: "easeInOut" } } }}><motion.circle cx="16" cy="16" r="5" variants={pulse} /><path d="m30,17.5v-3l-3.388-1.355c-.25-.933-.617-1.815-1.089-2.633l1.436-3.351-2.121-2.121-3.351,1.436c-.817-.472-1.7-.838-2.633-1.089l-1.355-3.388h-3l-1.355,3.388c-.933.25-1.815.617-2.633,1.089l-3.351-1.436-2.121,2.121 1.436,3.351c-.472.817-.838,1.7-1.089,2.633l-3.388,1.355v3l3.388,1.355c.25.933.617,1.815,1.089,2.633l-1.436,3.351 2.121,2.121 3.351-1.436c.817.472 1.7.838 2.633,1.089l1.355,3.388h3l1.355-3.388c.933-.25 1.815-.617 2.633-1.089l3.351,1.436 2.121-2.121-1.436-3.351c.472-.817.838-1.7 1.089-2.633l3.388-1.355Z" /></motion.g></Canvas>;
    case "clock":
      return <Canvas animated={animated} {...props}><path d="M3 12a9 9 0 1 0 18 0a9 9 0 0 0 -18 0" /><motion.path d="M12 7v5l3 3" style={{ transformOrigin: "12px 12px" }} variants={{ rest: { rotate: 0 }, hover: { rotate: 360, transition: { duration: 0.85, ease: "easeInOut" } } }} /></Canvas>;
    default:
      return <Glyph animated={animated} name="sparkle" {...props} />;
  }
}

export default function Icon({ className, label, name, size = 20, strokeWidth = 2 }) {
  const reducedMotion = useReducedMotion();

  return <Glyph animated={!reducedMotion} className={className} label={label} name={name} size={size} strokeWidth={strokeWidth} />;
}
