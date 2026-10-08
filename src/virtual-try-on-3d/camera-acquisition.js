// Camera negotiation only. Pose, physical scale and the tracking clock remain
// independent of CSS viewport size and the device's display orientation.
const safeRead = (object, method) => {
  try { return object?.[method]?.() ?? {}; } catch { return {}; }
};
const aborted = () => Object.assign(new Error("Camera request superseded"), { name: "AbortError" });
export const stopStream = (stream) => { for (const track of stream?.getTracks?.() ?? []) track.stop(); };

export function mobileCameraEnvironment({ userAgent = "", mobile = null, coarsePointer = false } = {}) {
  if (/Android|iPhone|iPad|iPod|Mobile/i.test(userAgent)) return true;
  if (typeof mobile === "boolean") return mobile;
  // iPadOS can report Macintosh, including on tablets wider than 780px.
  return /Macintosh/i.test(userAgent) && coarsePointer;
}

export function cameraConstraints(facingMode, mobile, supported = {}, minimal = false) {
  if (!mobile) return { audio: false, video: { facingMode: { ideal: facingMode },
    aspectRatio: { ideal: 16 / 9 }, height: { ideal: 720 }, width: { ideal: 1280 }, frameRate: { ideal: 60, max: 60 } } };
  return { audio: false, video: { facingMode: { ideal: facingMode },
    ...(!minimal ? { frameRate: { ideal: 30 } } : {}),
    ...(!minimal && supported.resizeMode ? { resizeMode: { ideal: "none" } } : {}) } };
}

export function cameraTrackSnapshot(stream, supported = {}) {
  const track = stream?.getVideoTracks?.()[0];
  const settings = safeRead(track, "getSettings"), capabilities = safeRead(track, "getCapabilities");
  return { settings, capabilities, appliedConstraints: safeRead(track, "getConstraints"), supportedConstraints: supported,
    capabilitiesAvailable: typeof track?.getCapabilities === "function",
    actualFacingMode: settings.facingMode ?? null, trackState: track?.readyState ?? null,
    zoom: { current: settings.zoom ?? null, min: capabilities.zoom?.min ?? null,
      max: capabilities.zoom?.max ?? null, step: capabilities.zoom?.step ?? null } };
}

/** Bounded retries and per-request cancellation prevent streams from an old
 * camera session leaking into the newly selected camera. Permission errors
 * are never retried. Only mobile can change negotiated capture properties. */
export async function acquireCamera(mediaDevices, { facingMode = "user", mobile = false,
  isCurrent = () => true, onDiagnostics = () => {} } = {}) {
  const supported = safeRead(mediaDevices, "getSupportedConstraints");
  const diagnostics = { profile: mobile ? "mobile-flexible" : "desktop-approved", requestedFacingMode: facingMode,
    supportedConstraints: supported, attempts: [], adjustments: [], synthetic: mediaDevices.synthetic === true };
  let stream = null;
  const publish = () => { onDiagnostics({ ...diagnostics }); };
  const check = () => { if (!isCurrent()) { stopStream(stream); throw aborted(); } };
  const request = async (constraints) => {
    check();
    const attempt = { requested: constraints }; diagnostics.attempts.push(attempt); publish();
    try {
      stream = await mediaDevices.getUserMedia(constraints); check();
      attempt.received = cameraTrackSnapshot(stream, supported).settings; publish();
      return stream;
    } catch (error) { attempt.error = { name: error.name, message: error.message }; publish(); throw error; }
  };
  try {
    try { await request(cameraConstraints(facingMode, mobile, supported)); }
    catch (error) {
      if (!mobile || !["OverconstrainedError", "ConstraintNotSatisfiedError"].includes(error.name)) throw error;
      await request(cameraConstraints(facingMode, true, supported, true));
    }
    let snapshot = cameraTrackSnapshot(stream, supported);
    if (mobile && snapshot.actualFacingMode && snapshot.actualFacingMode !== facingMode && supported.facingMode) {
      // A reported mismatch proves the ideal was ignored. Release the old
      // camera before requesting an exact facing mode (one camera on iOS).
      stopStream(stream); stream = null;
      const exact = cameraConstraints(facingMode, true, supported, true);
      exact.video.facingMode = { exact: facingMode };
      try { await request(exact); }
      catch (error) {
        if (!["OverconstrainedError", "ConstraintNotSatisfiedError", "NotFoundError"].includes(error.name)) throw error;
        await request(cameraConstraints(facingMode, true, supported, true));
      }
      snapshot = cameraTrackSnapshot(stream, supported);
    }
    const track = stream.getVideoTracks()[0];
    const adjust = async (property, constraints) => {
      check(); const entry = { property, requested: constraints, before: safeRead(track, "getSettings") };
      diagnostics.adjustments.push(entry);
      try { await track.applyConstraints(constraints); check(); entry.after = safeRead(track, "getSettings"); }
      catch (error) { if (error.name === "AbortError") throw error; entry.error = { name: error.name, message: error.message }; }
      publish();
    };
    if (mobile && supported.resizeMode && snapshot.settings.resizeMode === "crop-and-scale"
      && snapshot.capabilities.resizeMode?.includes("none") && track.applyConstraints) {
      await adjust("resizeMode", { resizeMode: { exact: "none" } });
    }
    snapshot = cameraTrackSnapshot(stream, supported);
    const { current, min, max } = snapshot.zoom;
    if (mobile && supported.zoom && track.applyConstraints && [current, min, max].every(Number.isFinite)
      && min > 0 && max >= min && current > min && current <= max) {
      // Remove a reported zoom only with a known current setting and range.
      // Never assume a zoom factor or request a new increase.
      await adjust("zoom", { advanced: [{ zoom: min }] });
    }
    check();
    Object.assign(diagnostics, cameraTrackSnapshot(stream, supported));
    diagnostics.requestedConstraints = diagnostics.attempts.at(-1).requested;
    diagnostics.facingModeMismatch = Boolean(diagnostics.actualFacingMode && diagnostics.actualFacingMode !== facingMode);
    diagnostics.browserReportsCrop = diagnostics.settings.resizeMode === "crop-and-scale";
    publish(); return { stream, diagnostics };
  } catch (error) { stopStream(stream); diagnostics.error = { name: error.name, message: error.message }; publish(); throw error; }
}
