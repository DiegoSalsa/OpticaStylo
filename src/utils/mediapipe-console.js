const XNNPACK_INITIALIZATION_NOTICE =
  "INFO: Created TensorFlow Lite XNNPACK delegate for CPU.";

function consoleArgumentText(argument) {
  if (argument instanceof Error) return argument.message;
  return String(argument);
}

export function isKnownMediaPipeConsoleNotice(argumentsList) {
  return argumentsList
    .map(consoleArgumentText)
    .join(" ")
    .includes(XNNPACK_INITIALIZATION_NOTICE);
}

export async function withMediaPipeConsoleFilter(callback) {
  const originalConsoleError = console.error;
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
