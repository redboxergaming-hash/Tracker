let scannerControls = null;
let scannerReader = null;
let handlingResult = false;

export async function startBarcodeScanner(videoElement, onDetected, onError) {
  if (scannerControls) return;

  try {
    const zxing = await import('https://cdn.jsdelivr.net/npm/@zxing/browser@0.1.5/+esm');
    scannerReader = new zxing.BrowserMultiFormatReader();

    scannerControls = await scannerReader.decodeFromVideoDevice(undefined, videoElement, (result, error) => {
      if (result && !handlingResult) {
        handlingResult = true;
        Promise.resolve(onDetected(result.getText())).finally(() => {
          setTimeout(() => {
            handlingResult = false;
          }, 800);
        });
      }

      if (error && error.name !== 'NotFoundException' && typeof onError === 'function') {
        onError(error);
      }
    });
  } catch (error) {
    if (typeof onError === 'function') onError(error);
    throw error;
  }
}

export function stopBarcodeScanner() {
  if (scannerControls) {
    scannerControls.stop();
    scannerControls = null;
  }
  if (scannerReader) {
    scannerReader.reset();
    scannerReader = null;
  }
  handlingResult = false;
}
