import qrcode from 'qrcode-generator';

export const QR_QUIET_ZONE = 4;

export interface QrMatrix {
  size: number;
  path: string;
}

export function qrMatrix(text: string): QrMatrix {
  const code = qrcode(0, 'M');
  code.addData(text);
  code.make();
  const count = code.getModuleCount();
  const cells: string[] = [];
  for (let row = 0; row < count; row += 1) {
    for (let column = 0; column < count; column += 1) {
      if (code.isDark(row, column)) {
        cells.push(`M${column + QR_QUIET_ZONE} ${row + QR_QUIET_ZONE}h1v1h-1z`);
      }
    }
  }
  return { size: count + QR_QUIET_ZONE * 2, path: cells.join('') };
}
