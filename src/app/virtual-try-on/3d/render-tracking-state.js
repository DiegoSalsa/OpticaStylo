"use client";

import { addAfterEffect, useFrame } from "@react-three/fiber";
import { useEffect } from "react";

/** Publica la pose del mismo ciclo de WebGL para validar interfaz y captura.
 * Sólo escribe referencias; no solicita un render React por fotograma. */
export default function RenderTrackingState({ poseRef, poseFilterRef, renderedPoseRef, debugMetricsRef, onVisibility, pendingCaptureRef }) {
  useEffect(() => addAfterEffect(() => {
    const capture = pendingCaptureRef.current;
    pendingCaptureRef.current = null;
    capture?.();
  }), [pendingCaptureRef]);
  useFrame(() => {
    const pose = poseFilterRef.current ? poseFilterRef.current.sample(performance.now()) : poseRef.current;
    if (pose) {
      renderedPoseRef.current ??= {};
      renderedPoseRef.current.timestamp = pose.timestamp;
    } else renderedPoseRef.current = null;
    debugMetricsRef.current.modelVisible = Boolean(pose);
    onVisibility(Boolean(pose));
  });
  return null;
}
