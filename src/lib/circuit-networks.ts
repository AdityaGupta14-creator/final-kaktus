export type CircuitWireEndpoint = {
  from: string;
  to: string;
  net?: string;
};

type ComponentTypeLookup = (componentId: string) => string | undefined;

export function splitCircuitEndpoint(endpoint: string) {
  const separator = endpoint.indexOf(':');
  return separator < 0
    ? { componentId: endpoint, pin: '' }
    : { componentId: endpoint.slice(0, separator), pin: endpoint.slice(separator + 1).toUpperCase() };
}

export function isPowerDistributionEndpoint(endpoint: string, getComponentType: ComponentTypeLookup) {
  const { componentId, pin } = splitCircuitEndpoint(endpoint);
  const identity = `${componentId} ${getComponentType(componentId) || ''}`.toLowerCase();
  const isPowerDistributionPart = /power|supply|ground|gnd|vcc|vdd|vplus|vminus|battery|lipo|cell|terminal|rail/.test(identity);
  const isDistributionPin = /^(?:OUT(?:PUT)?\d*|LOAD\d*|COM\d*|INPUT\d*|POWER|PWR|SUPPLY|TERMINAL|VPLUS|VMINUS|SERVO_VPLUS|SERVO_GND|POSITIVE|NEGATIVE|POS|NEG|\+|-|V\+|V-)(?:\.\d+)?$/.test(pin);
  return isPowerDistributionPart && isDistributionPin;
}

export function canShareCircuitEndpoint(endpoint: string, getComponentType: ComponentTypeLookup) {
  const { pin } = splitCircuitEndpoint(endpoint);
  if (/^(?:GND|GROUND|VCC\d*|VDD\d*|VIN|VBUS|VSYS|3V3|3\.3V|5V|12V)(?:\.\d+)?$/.test(pin)) return true;
  if (/^(?:SDA|SCL|SCK|MOSI|MISO|SDI|SDO)$/.test(pin)) return true;
  return isPowerDistributionEndpoint(endpoint, getComponentType);
}

export function circuitWirePairKey(from: string, to: string) {
  return [from.toLowerCase(), to.toLowerCase()].sort().join('|');
}

export function breadboardLaneKey(wire: CircuitWireEndpoint, getComponentType: ComponentTypeLookup) {
  for (const endpoint of [wire.from, wire.to]) {
    if (canShareCircuitEndpoint(endpoint, getComponentType)) return `pin:${endpoint.toLowerCase()}`;
  }
  const net = wire.net?.trim().toLowerCase();
  if (net) return `net:${net}`;
  return `wire:${circuitWirePairKey(wire.from, wire.to)}`;
}
