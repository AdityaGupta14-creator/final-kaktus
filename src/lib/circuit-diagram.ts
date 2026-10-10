import { breadboardLaneKey } from './circuit-networks';

type CircuitPart = {
  id: string;
  type?: string;
  value?: string;
  model?: string;
  label?: string;
  x?: number;
  y?: number;
  rotate?: number;
  custom?: { description?: string };
};

type CircuitConnection = { from: string; to: string; color?: string };
type Point = { x: number; y: number };
type BoardLayout = {
  required: boolean;
  count: number;
  x: number;
  y: number;
  wireSlots: Record<string, number>;
  savedPositions?: Record<number, Point>;
};

const escapeXml = (value: unknown) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&apos;');

function componentSize(part: CircuitPart) {
  const type = (part.type || '').toLowerCase();
  if (/arduino|esp32|raspberry|controller/.test(type)) return { width: 190, height: 125 };
  if (/breadboard/.test(type)) return { width: 190, height: 90 };
  if (/pca9685|driver_board/.test(type)) return { width: 145, height: 92 };
  if (/l298n|motor_driver/.test(type)) return { width: 180, height: 135 };
  if (/servo|sg90|mg996/.test(type)) return { width: 105, height: 88 };
  if (/motor/.test(type)) return { width: 112, height: 90 };
  if (/battery|9v/.test(type)) return { width: 88, height: 125 };
  if (/sensor|ultrasonic|hc-sr04/.test(type)) return { width: 118, height: 88 };
  return { width: 145, height: 100 };
}

function componentTitle(part: CircuitPart) {
  return part.label || part.value || part.model || part.custom?.description || part.type || 'Component';
}

function renderPart(part: CircuitPart, position: Point) {
  const type = (part.type || '').toLowerCase();
  const { width, height } = componentSize(part);
  const label = escapeXml(String(componentTitle(part)).replace(/[_-]+/g, ' '));
  const id = escapeXml(part.id);
  const x = position.x;
  const y = position.y;
  let icon = '';

  if (/arduino|esp32|raspberry|controller/.test(type)) {
    icon = `<rect x="8" y="8" width="${width - 16}" height="${height - 16}" rx="10" fill="#0969a8" stroke="#53b8ec" stroke-width="3"/><rect x="${width - 23}" y="26" width="15" height="40" rx="2" fill="#c5cdd2"/><rect x="18" y="22" width="${width - 42}" height="${height - 44}" rx="5" fill="#123d5a" stroke="#1e8ac0" stroke-width="2"/><text x="${width / 2}" y="${height / 2 - 4}" text-anchor="middle" class="part-title">${label}</text><text x="${width / 2}" y="${height / 2 + 17}" text-anchor="middle" class="part-id">${id}</text>`;
  } else if (/pca9685|driver_board/.test(type)) {
    icon = `<rect x="5" y="7" width="${width - 10}" height="${height - 14}" rx="8" fill="#123d89" stroke="#4b8ded" stroke-width="3"/><rect x="${width * .3}" y="${height * .27}" width="${width * .4}" height="${height * .43}" rx="4" fill="#171b20" stroke="#758393" stroke-width="2"/><text x="${width / 2}" y="${height / 2 + 5}" text-anchor="middle" class="part-title">PCA9685</text><text x="${width / 2}" y="${height - 16}" text-anchor="middle" class="part-id">${id}</text>${Array.from({ length: 8 }, (_, i) => `<circle cx="${19 + i * 15}" cy="10" r="3" fill="#f2cf5b"/>`).join('')}`;
  } else if (/servo|sg90|mg996/.test(type)) {
    icon = `<rect x="20" y="25" width="${width - 40}" height="${height - 35}" rx="8" fill="#0875ae" stroke="#55bde8" stroke-width="3"/><rect x="13" y="43" width="${width - 26}" height="16" rx="4" fill="#1598d0"/><circle cx="${width / 2}" cy="25" r="15" fill="#e9edf0" stroke="#69737a" stroke-width="3"/><circle cx="${width / 2}" cy="25" r="5" fill="#313a42"/><text x="${width / 2}" y="${height - 9}" text-anchor="middle" class="part-id">${id}</text>`;
  } else if (/motor/.test(type)) {
    icon = `<circle cx="${width / 2}" cy="${height / 2 - 4}" r="29" fill="#b7c0c6" stroke="#eef2f4" stroke-width="4"/><circle cx="${width / 2}" cy="${height / 2 - 4}" r="15" fill="#444c53"/><path d="M ${width / 2} ${height / 2 - 4} L ${width / 2 + 21} ${height / 2 - 18}" stroke="#e04b43" stroke-width="5"/><text x="${width / 2}" y="${height - 6}" text-anchor="middle" class="part-id">${id}</text>`;
  } else if (/battery|9v/.test(type)) {
    icon = `<rect x="25" y="13" width="${width - 50}" height="${height - 25}" rx="12" fill="#343c42" stroke="#aab3b9" stroke-width="3"/><rect x="${width / 2 - 15}" y="6" width="30" height="9" rx="3" fill="#adb5ba"/><text x="${width / 2}" y="${height / 2}" text-anchor="middle" class="part-title">${label}</text><text x="${width / 2}" y="${height - 13}" text-anchor="middle" class="part-id">${id}</text><text x="${width / 2}" y="31" text-anchor="middle" fill="#fb6262" font-size="16" font-weight="700">+</text>`;
  } else {
    const shortLabel = label.length > 21 ? `${label.slice(0, 19)}…` : label;
    icon = `<rect x="6" y="9" width="${width - 12}" height="${height - 18}" rx="9" fill="#102b40" stroke="#318fc0" stroke-width="3"/><rect x="6" y="9" width="${width - 12}" height="22" rx="8" fill="#1c5a7c"/><text x="${width / 2}" y="25" text-anchor="middle" class="part-id">${id}</text><text x="${width / 2}" y="${height / 2 + 7}" text-anchor="middle" class="part-title">${shortLabel}</text>`;
  }

  const rotate = Number(part.rotate) || 0;
  return `<g transform="translate(${x} ${y})${rotate ? ` rotate(${rotate} ${width / 2} ${height / 2})` : ''}">${icon}</g>`;
}

function connectionPoint(part: CircuitPart, pin: string, position: Point): Point {
  const { width, height } = componentSize(part);
  const normalizedPin = pin.toUpperCase();
  let hash = 0;
  for (const char of normalizedPin) hash += char.charCodeAt(0);
  const isPower = /GND|VCC|VDD|VIN|3V3|5V|BAT|GROUND/.test(normalizedPin);
  const isOutput = /OUT|TX|SDA|SCL|PWM|SIG/.test(normalizedPin);
  const side = isPower ? 3 : isOutput ? 1 : hash % 2 === 0 ? 1 : 3;
  const vertical = 30 + (hash % 5) * ((height - 60) / 4);
  const horizontal = 28 + (hash % 5) * ((width - 56) / 4);
  const point = side === 1
    ? { x: position.x + width, y: position.y + vertical }
    : { x: position.x, y: position.y + vertical };
  return point;
}

function wireCurve(start: Point, end: Point, index: number) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const bend = Math.min(Math.hypot(dx, dy) * 0.16, 100) + (index % 3) * 9;
  if (Math.abs(dx) >= Math.abs(dy)) {
    const direction = dx >= 0 ? 1 : -1;
    return `M ${start.x} ${start.y} C ${start.x + direction * bend} ${start.y}, ${end.x - direction * bend} ${end.y}, ${end.x} ${end.y}`;
  }
  const direction = dy >= 0 ? 1 : -1;
  return `M ${start.x} ${start.y} C ${start.x} ${start.y + direction * bend}, ${end.x} ${end.y - direction * bend}, ${end.x} ${end.y}`;
}

function renderBreadboard(x: number, y: number, number: number, count: number) {
  const columns = Array.from({ length: 30 }, (_, index) => index);
  const rails = [39, 54, 285, 300];
  const powerRails = rails.map((railY, index) => `<line x1="82" y1="${railY}" x2="721" y2="${railY}" stroke="${index % 2 === 0 ? '#d64545' : '#3779b8'}" stroke-width="2" opacity=".75"/>${columns.map(column => `<circle cx="${88 + column * 21}" cy="${railY}" r="4" fill="#27323a" stroke="#acb6b5" stroke-width="2"/>`).join('')}`).join('');
  const terminalHoles = columns.map(column => {
    const cx = 88 + column * 21;
    const rowHoles = [0, 1, 2, 3, 4].flatMap(row => [84 + row * 17, 192 + row * 17]);
    return rowHoles.map(cy => `<circle cx="${cx}" cy="${cy}" r="4.3" fill="#27323a" stroke="#bac1bd" stroke-width="2"/>`).join('');
  }).join('');
  return `<g transform="translate(${x} ${y})"><rect x="0" y="7" width="780" height="330" rx="18" fill="#000" opacity=".25"/><rect width="780" height="330" rx="18" fill="#e9ece7" stroke="#b4bcb8" stroke-width="3"/><rect x="12" y="12" width="756" height="306" rx="12" fill="none" stroke="#fff" stroke-width="2" opacity=".75"/><text x="390" y="22" text-anchor="middle" fill="#505c60" font-size="14" font-weight="700" letter-spacing="2">400-POINT BREADBOARD${count > 1 ? ` · ${number}/${count}` : ''}</text>${powerRails}<rect x="20" y="70" width="740" height="94" rx="5" fill="#dfe4df" stroke="#b7c0bb" stroke-width="2"/><rect x="20" y="178" width="740" height="94" rx="5" fill="#dfe4df" stroke="#b7c0bb" stroke-width="2"/><rect x="20" y="164" width="740" height="14" fill="#c2c9c4"/>${columns.map((_, index) => `<text x="${88 + index * 21}" y="68" text-anchor="middle" fill="#626d70" font-size="10">${index + 1}</text><text x="${88 + index * 21}" y="286" text-anchor="middle" fill="#626d70" font-size="10">${index + 1}</text>`).join('')}${terminalHoles}${'ABCDE'.split('').map((row, index) => `<text x="35" y="${87 + index * 17}" text-anchor="middle" fill="#505c60" font-size="10" font-weight="700">${row}</text><text x="35" y="${195 + index * 17}" text-anchor="middle" fill="#505c60" font-size="10" font-weight="700">${'FGHIJ'[index]}</text>`).join('')}</g>`;
}

export function buildFinalCircuitSvg(parts: CircuitPart[], connections: CircuitConnection[], board: BoardLayout) {
  const positions = new Map<string, Point>();
  const sizeById = new Map(parts.map(part => [part.id, componentSize(part)]));
  const explicitPositions = parts.filter(part => Number.isFinite(Number(part.x)) && Number.isFinite(Number(part.y)));
  const hasMissingPositions = explicitPositions.length !== parts.length;
  const gridColumns = Math.max(1, Math.ceil(Math.sqrt(parts.length)));
  const fallbackBaseX = explicitPositions.length ? Math.max(...explicitPositions.map(part => Number(part.x) || 0)) + 240 : 150;
  const fallbackBaseY = explicitPositions.length ? Math.min(...explicitPositions.map(part => Number(part.y) || 0)) : 150;

  parts.forEach((part, index) => {
    const missing = !Number.isFinite(Number(part.x)) || !Number.isFinite(Number(part.y));
    positions.set(part.id, missing
      ? { x: fallbackBaseX + (index % gridColumns) * 230, y: fallbackBaseY + Math.floor(index / gridColumns) * 170 }
      : { x: Number(part.x), y: Number(part.y) });
  });

  const boardPositions = Array.from({ length: board.count }, (_, index) => board.savedPositions?.[index] || { x: board.x + index * 810, y: board.y });
  const componentsMarkup = parts.map(part => renderPart(part, positions.get(part.id) || { x: 0, y: 0 })).join('');
  const boardMarkup = board.required ? boardPositions.map((position, index) => renderBreadboard(position.x, position.y, index + 1, board.count)).join('') : '';
  const wiresMarkup = connections.map((connection, index) => {
    const [fromId, ...fromPinParts] = (connection.from || '').split(':');
    const [toId, ...toPinParts] = (connection.to || '').split(':');
    const fromPin = fromPinParts.join(':') || '?';
    const toPin = toPinParts.join(':') || '?';
    const fromPart = parts.find(part => part.id === fromId);
    const toPart = parts.find(part => part.id === toId);
    if (!fromPart || !toPart) return '';
    const from = connectionPoint(fromPart, fromPin, positions.get(fromId) || { x: 0, y: 0 });
    const to = connectionPoint(toPart, toPin, positions.get(toId) || { x: 0, y: 0 });
    const wireColor = connection.color && /^(#[\da-f]{3,8}|[a-z]{3,20})$/i.test(connection.color) ? connection.color : '#36c96f';
    const wireKey = breadboardLaneKey(connection, id => parts.find(part => part.id === id)?.type);
    const slot = board.wireSlots[wireKey] ?? index;
    const pathMarkup = board.required
      ? (() => {
        const slotInBoard = slot % 60;
        const boardIndex = Math.floor(slot / 60);
        const boardPosition = boardPositions[boardIndex] || boardPositions[0];
        const column = slotInBoard % 30;
        const lowerRows = slotInBoard >= 30;
        const boardX = boardPosition.x + 88 + column * 21;
        const firstY = boardPosition.y + (lowerRows ? 192 : 84);
        const first = { x: boardX, y: firstY };
        const last = { x: boardX, y: firstY + 68 };
        return `${wireCurve(from, first, index)} ${wireCurve(last, to, index + 1)}<line x1="${first.x}" y1="${first.y}" x2="${last.x}" y2="${last.y}" stroke="${wireColor}" stroke-width="4" opacity=".9"/>`;
      })()
      : wireCurve(from, to, index);
    const endpoints = `<circle cx="${from.x}" cy="${from.y}" r="5" fill="${wireColor}" stroke="#101214" stroke-width="2"/><circle cx="${to.x}" cy="${to.y}" r="5" fill="${wireColor}" stroke="#101214" stroke-width="2"/>`;
    const labels = `<text x="${from.x + 8}" y="${from.y - 7}" class="pin-label">${escapeXml(fromPin)}</text><text x="${to.x + 8}" y="${to.y - 7}" class="pin-label">${escapeXml(toPin)}</text>`;
    return `<g><path d="${pathMarkup}" fill="none" stroke="#050607" stroke-width="7" stroke-linecap="round" opacity=".7"/><path d="${pathMarkup}" fill="none" stroke="${wireColor}" stroke-width="3.5" stroke-linecap="round"/>${endpoints}${labels}</g>`;
  }).join('');

  const bounds = [
    ...parts.map(part => {
      const position = positions.get(part.id) || { x: 0, y: 0 };
      const size = sizeById.get(part.id) || { width: 140, height: 90 };
      return { x: position.x, y: position.y, right: position.x + size.width, bottom: position.y + size.height };
    }),
    ...boardPositions.map(position => ({ x: position.x, y: position.y, right: position.x + 780, bottom: position.y + 337 })),
  ];
  if (!bounds.length) bounds.push({ x: 0, y: 0, right: 640, bottom: 360 });
  const left = Math.min(...bounds.map(item => item.x)) - 50;
  const top = Math.min(...bounds.map(item => item.y)) - 50;
  const right = Math.max(...bounds.map(item => item.right)) + 50;
  const bottom = Math.max(...bounds.map(item => item.bottom)) + 50;
  const width = Math.max(right - left, 640);
  const height = Math.max(bottom - top, 360);
  const fallbackLayoutNote = hasMissingPositions
    ? '<text x="20" y="30" fill="#a7b2bd" font-size="15">Some unpositioned parts were arranged automatically for this export.</text>'
    : '';
  const emptyCircuitNote = parts.length === 0
    ? `<text x="${left + width / 2}" y="${top + height / 2}" text-anchor="middle" fill="#e5e7eb" font-size="22" font-family="Arial,sans-serif">No final circuit components were provided for this project.</text>`
    : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.min(width, 2400)}" height="${Math.min(height, 1800)}" viewBox="${left} ${top} ${width} ${height}"><defs><pattern id="grid" width="24" height="24" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1.2" fill="#87919a" opacity=".18"/></pattern></defs><style>.part-title{fill:#f4f7fa;font:700 15px Arial,sans-serif}.part-id{fill:#c7d9e6;font:12px Arial,monospace}.pin-label{fill:#fff;font:700 12px Arial,monospace;paint-order:stroke;stroke:#111820;stroke-width:4px;stroke-linejoin:round}</style><rect x="${left}" y="${top}" width="${width}" height="${height}" fill="#1e1e1e"/><rect x="${left}" y="${top}" width="${width}" height="${height}" fill="url(#grid)"/>${boardMarkup}${wiresMarkup}${componentsMarkup}${fallbackLayoutNote}${emptyCircuitNote}</svg>`;
}

export async function svgToPngDataUrl(svgMarkup: string) {
  const svgBlob = new Blob([svgMarkup], { type: 'image/svg+xml;charset=utf-8' });
  const objectUrl = URL.createObjectURL(svgBlob);
  try {
    const image = new Image();
    image.decoding = 'async';
    image.src = objectUrl;
    await image.decode();
    const scale = Math.min(2, 3200 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('The circuit diagram image could not be prepared.');
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return { dataUrl: canvas.toDataURL('image/png'), width: canvas.width, height: canvas.height };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
