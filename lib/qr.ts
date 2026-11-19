import QRCode from 'qrcode';

/** A QR code as an SVG string, black on white with a quiet border. */
export function qrSvg(text: string): Promise<string> {
  return QRCode.toString(text, { type: 'svg', errorCorrectionLevel: 'M', margin: 3 });
}
