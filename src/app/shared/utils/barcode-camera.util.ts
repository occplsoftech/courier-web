/**
 * Reads barcodes / QR codes from the device camera with the browser's BarcodeDetector (Chrome, Edge, Android).
 * Calls `onCode` for each new value read; returns a stop function. `onMessage` gets status text for the user.
 */
export function startBarcodeCamera(video: HTMLVideoElement, onCode: (value: string) => void, onMessage: (text: string) => void): () => void {
  let stopped = false;
  let stream: MediaStream | null = null;
  const stop = () => { stopped = true; stream?.getTracks().forEach((t) => t.stop()); stream = null; };
  const Detector = (window as unknown as { BarcodeDetector?: new (o: unknown) => { detect(v: unknown): Promise<{ rawValue: string }[]> } }).BarcodeDetector;
  if (!Detector || !navigator.mediaDevices?.getUserMedia) {
    onMessage('This browser cannot read barcodes with the camera. Use Chrome or Edge, a barcode gun, or type it.');
    return stop;
  }
  onMessage('Starting the camera…');
  navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false }).then((s) => {
    if (stopped) { s.getTracks().forEach((t) => t.stop()); return; }
    stream = s;
    video.srcObject = s;
    return video.play().then(() => {
      const det = new Detector({ formats: ['code_128', 'code_39', 'qr_code', 'ean_13', 'codabar', 'itf', 'data_matrix'] });
      onMessage('Point the camera at the barcode or QR code.');
      let last = '';
      const loop = () => {
        if (stopped) return;
        det.detect(video).then((codes) => {
          const v = codes[0]?.rawValue?.trim();
          if (v && v !== last) { last = v; onCode(v); }
          setTimeout(loop, 300);
        }).catch(() => setTimeout(loop, 500));
      };
      loop();
    });
  }).catch((e: DOMException) => onMessage(e?.name === 'NotAllowedError'
    ? 'Camera permission was refused. Allow the camera for this site, or type it.' : 'Could not start the camera.'));
  return stop;
}
