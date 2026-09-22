const XNNPACK_INITIALIZATION_NOTICE =
// Utilidades compartidas para mediapipe-console.
  "INFO: Created TensorFlow Lite XNNPACK delegate for CPU.";

// Centralizar la lógica de console argument text para mantener consistente el comportamiento de la aplicación
function consoleArgumentText(argument) {
  if (argument instanceof Error) return argument.message;
  return String(argument);
}

// Determinar si is known media pipe console notice cumple la condición requerida por la aplicación
export function isKnownMediaPipeConsoleNotice(argumentsList) {
  return argumentsList
    .map(consoleArgumentText)
    .join(" ")
    .includes(XNNPACK_INITIALIZATION_NOTICE);
}

// Centralizar la lógica de with media pipe console filter para mantener consistente el comportamiento de la aplicación
export async function withMediaPipeConsoleFilter(callback) {
  const originalConsoleError = console.error;
  // Centralizar la lógica de filtered console error para mantener consistente el comportamiento de la aplicación
  const filteredConsoleError = (...argumentsList) => {
    if (isKnownMediaPipeConsoleNotice(argumentsList)) return;
    originalConsoleError.apply(console, argumentsList);
  };

  console.error = filteredConsoleError;
  try {
    return await callback();
  } finally {
    if (console.error === filteredConsoleError) {
      console.error = originalConsoleError;
    }
  }
}
