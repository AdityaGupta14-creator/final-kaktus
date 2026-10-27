import { reviewGeneratedCode } from './code-quality.ts';

export type AgentAction = 'NEW_PROJECT' | 'UPDATE_CURRENT' | 'NEW_TAB' | 'MERGE_TAB';

export interface AgentPin {
  name: string;
  kind?: 'power_in' | 'power_out' | 'ground' | 'digital' | 'analog' | 'pwm' | 'i2c' | 'uart' | 'passive';
  voltage?: number;
  maxCurrentMa?: number;
}

export interface AgentComponent {
  id: string;
  type: string;
  x: number;
  y: number;
  label?: string;
  value?: string;
  rotation?: number;
  pins?: AgentPin[];
  custom?: {
    description?: string;
    pins?: AgentPin[];
    visual?: 'board' | 'chip' | 'sensor' | 'actuator' | 'module';
  };
  [key: string]: unknown;
}

export interface AgentWire {
  from: string;
  to: string;
  color?: string;
  net?: string;
  signal?: string;
}

export interface AgentStep {
  insert_after_step?: number;
  replace_step?: number;
  phase?: string;
  instruction: string;
  detail?: string;
  verify?: string;
  code?: string;
  code_language?: string;
  add_components?: AgentComponent[];
  add_wiring?: AgentWire[];
  remove_components?: string[];
  remove_wiring?: string[];
  [key: string]: unknown;
}

function validateElectricalTestWording(step: Record<string, unknown>, path: string): string[] {
  const text = [step.instruction, step.detail, step.verify]
    .filter((value): value is string => typeof value === 'string')
    .join('\n');
  if (!/\b(?:measure|meter|multimeter|continuity|resistance|ohms?|ohmmeter)\b/i.test(text)) return [];

  const clauses = text.split(/[\n;.!?]+/).map(clause => clause.trim()).filter(Boolean);
  const activeClauses = clauses.filter(clause => !/\b(?:do not|don't|never|avoid)\b/i.test(clause));
  const resistanceLimit = /(?:[<>]=?\s*\d+(?:\.\d+)?\s*(?:k\s*)?(?:ohms?|Ω)|\b(?:greater|less)\s+than\s+\d+(?:\.\d+)?\s*(?:k\s*)?(?:ohms?|Ω)|\b(?:typically|usually|for example|e\.g\.?)\s+[<>]?\s*\d+(?:\.\d+)?\s*(?:k\s*)?(?:ohms?|Ω))/i;
  const errors: string[] = [];

  if (activeClauses.some(clause => resistanceLimit.test(clause))) {
    errors.push(`${path} uses a generic numeric resistance threshold in a test. Use a justified part-specific limit or a meter-lead/netlist criterion; do not invent an ohm value.`);
  }

  const batteryTerminals = /(?:battery(?:_pack)?|BAT\+|BAT-|battery\s+terminals?)/i;
  if (activeClauses.some(clause => /\b(?:measure|read|test|check|probe)\b/i.test(clause)
    && /\b(?:resistance|ohms?|ohmmeter|continuity)\b/i.test(clause)
    && batteryTerminals.test(clause))) {
    errors.push(`${path} must not use an ohmmeter or continuity mode across a battery or its terminals. Remove the battery from the circuit first.`);
  }

  const railToGroundPair = /(?:\b(?:Vs|VIN|5V|3V3)\b.{0,80}\bGND\b|\bGND\b.{0,80}\b(?:Vs|VIN|5V|3V3)\b)/i;
  if (activeClauses.some(clause => /\b(?:measure|read|test|check)\b/i.test(clause)
    && /\b(?:resistance|ohms?|ohmmeter|continuity)\b/i.test(clause)
    && railToGroundPair.test(clause))) {
    errors.push(`${path} declares a rail-to-ground resistance test on a populated circuit. Verify the exact topology or isolate the relevant nodes; do not infer a short from a generic rail resistance reading.`);
  }

  return errors;
}

export interface AgentPlan {
  action?: AgentAction;
  project_name?: string;
  target_tab?: string;
  description?: string;
  blueprint_svg?: string;
  constraints?: string[];
  assumptions?: string[];
  risks?: string[];
  steps: AgentStep[];
}

export interface ProjectPlan {
  title: string;
  summary: string;
  assumptions: string[];
  subsystems: Array<{
    name: string;
    purpose: string;
    dependencies: string[];
    deliverables: string[];
    acceptance: string[];
  }>;
  billOfMaterials: Array<{ item: string; quantity: string; specification: string; rationale: string }>;
  calculations: Array<{ name: string; equation: string; values: string; result: string; caveat?: string }>;
  risks: string[];
  verification: string[];
}

export interface ResearchSource {
  title: string;
  uri: string;
}

export interface PlanBuildAction {
  id: string;
  plan: ProjectPlan;
  phaseIndex: number;
  completedPhaseIndices?: number[];
  targetTabId: string;
  startApproach?: 'recommended' | 'canvas-first' | 'hardware-first';
}

export function parseProjectPlan(input: unknown): ProjectPlan | null {
  if (!isRecord(input)) return null;
  if (!Array.isArray(input.subsystems) || input.subsystems.length < 2 || input.subsystems.length > 24) return null;
  const text = (value: unknown): string => {
    if (typeof value === 'string') return value.slice(0, 1200);
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    if (Array.isArray(value)) return value.slice(0, 40).map(text).filter(Boolean).join(', ');
    if (isRecord(value)) return Object.entries(value).slice(0, 40).map(([key, item]) => `${key}: ${text(item)}`).filter(Boolean).join('\n').slice(0, 1200);
    return '';
  };
  const list = (value: unknown) => (Array.isArray(value) ? value : typeof value === 'string' ? [value] : [])
    .slice(0, 40).map(text).filter(Boolean);
  const subsystems = input.subsystems.filter(isRecord).map(item => ({
    name: text(item.name),
    purpose: text(item.purpose),
    dependencies: list(item.dependencies),
    deliverables: list(item.deliverables),
    acceptance: list(item.acceptance),
  })).filter(item => item.name && item.purpose);
  if (subsystems.length < 2) return null;
  const rawBillOfMaterials = input.billOfMaterials ?? input.bill_of_materials;
  const billOfMaterials = (Array.isArray(rawBillOfMaterials) ? rawBillOfMaterials : [])
    .filter(isRecord).slice(0, 80).map(item => ({
      item: text(item.item), quantity: text(item.quantity), specification: text(item.specification), rationale: text(item.rationale),
    })).filter(item => item.item);
  const calculations = (Array.isArray(input.calculations) ? input.calculations : [])
    .filter(isRecord).slice(0, 40).map(item => ({
      name: text(item.name), equation: text(item.equation), values: text(item.values), result: text(item.result), caveat: text(item.caveat),
    })).filter(item => item.name);
  const risks = (Array.isArray(input.risks) ? input.risks : []).slice(0, 40).map(risk => {
    if (!isRecord(risk)) return text(risk);
    const title = text(risk.risk ?? risk.name);
    const mitigation = text(risk.mitigation ?? risk.response);
    return [title, mitigation].filter(Boolean).join(' - ');
  }).filter(Boolean);
  const title = text(input.title ?? input.project_name ?? input.projectName) || 'Implementation plan';
  const summary = text(input.summary ?? input.description) || `A phased plan with ${subsystems.length} subsystems.`;
  return {
    title: title.slice(0, 160), summary: summary.slice(0, 3000),
    assumptions: list(input.assumptions), subsystems, billOfMaterials, calculations,
    risks, verification: list(input.verification),
  };
}

export interface ExtractedProjectPlanResponse {
  plan: ProjectPlan | null;
  cleanText: string;
}

function findJsonObject(text: string, from = 0, requiredKey?: string): { start: number; end: number; value: unknown } | null {
  // Fast path: check if text even contains opening brace and required key
  if (requiredKey && !text.includes(`"${requiredKey}"`)) {
    return null;
  }

  let candidatesChecked = 0;
  const maxCandidates = 15;

  for (let start = text.indexOf('{', from); start !== -1; start = text.indexOf('{', start + 1)) {
    candidatesChecked++;
    if (candidatesChecked > maxCandidates) break;

    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = start; index < text.length; index += 1) {
      const char = text[index];
      if (inString) {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === '"') inString = false;
        continue;
      }
      if (char === '"') inString = true;
      else if (char === '{') depth += 1;
      else if (char === '}') {
        depth -= 1;
        if (depth === 0) {
          const slice = text.slice(start, index + 1);
          if (!requiredKey || slice.includes(`"${requiredKey}"`)) {
            try {
              return { start, end: index + 1, value: JSON.parse(slice) };
            } catch {
              break;
            }
          }
          break;
        }
      }
    }
  }
  return null;
}

export function extractProjectPlanResponse(text: string): ExtractedProjectPlanResponse {
  const taggedPlan = parseProjectPlan(extractTaggedJson(text, 'implementation_plan'));
  if (taggedPlan) {
    const tagStart = text.search(/<implementation_plan>/i);
    const preamble = tagStart >= 0 ? text.slice(0, tagStart) : text;
    return { plan: taggedPlan, cleanText: cleanAgentText(preamble) };
  }

  // Fast path: check markdown json code block first
  const fencedMatch = /```(?:json)?\s*(\{[\s\S]*?"subsystems"[\s\S]*?\})\s*```/i.exec(text);
  if (fencedMatch) {
    try {
      const parsed = JSON.parse(fencedMatch[1]);
      const plan = parseProjectPlan(parsed);
      if (plan) {
        const preamble = text.slice(0, fencedMatch.index).trim();
        return { plan, cleanText: cleanAgentText(preamble) };
      }
    } catch {}
  }

  let candidate = findJsonObject(text, 0, 'subsystems');
  while (candidate) {
    const plan = parseProjectPlan(candidate.value);
    if (plan) {
      const preamble = text.slice(0, candidate.start)
        .replace(/(?:^|\n)\s*```(?:json)?\s*$/i, '')
        .trim();
      return { plan, cleanText: cleanAgentText(preamble) };
    }
    candidate = findJsonObject(text, candidate.start + 1, 'subsystems');
  }

  return { plan: null, cleanText: cleanAgentText(text) };
}

export function recoverPersistedProjectPlans<T extends {
  role: string;
  content: string;
  cleanText?: string;
  implementationPlan?: ProjectPlan;
}>(messages: T[]): T[] {
  return messages.map(message => {
    if (message.role !== 'assistant' || message.implementationPlan) return message;
    const extracted = extractProjectPlanResponse(message.content);
    if (!extracted.plan) return message;
    return {
      ...message,
      cleanText: extracted.cleanText || message.cleanText || '',
      implementationPlan: extracted.plan,
    };
  });
}

export interface ValidationResult {
  ok: boolean;
  value?: AgentPlan;
  errors: string[];
  warnings: string[];
}

export interface ExtractedTutorialResponse {
  plan: AgentPlan | null;
  cleanText: string;
  errors: string[];
  warnings: string[];
}

const MAX_STEPS = 128;
const MAX_COMPONENTS_PER_STEP = 64;
const MAX_WIRES_PER_STEP = 128;
const COMPONENT_ID = /^[a-zA-Z][a-zA-Z0-9_-]{0,47}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function endpoint(value: unknown): { componentId: string; pin: string } | null {
  if (typeof value !== 'string') return null;
  const separator = value.indexOf(':');
  if (separator < 1 || separator === value.length - 1) return null;
  return { componentId: value.slice(0, separator), pin: value.slice(separator + 1) };
}

function isGroundPin(pin: string): boolean {
  return /^(gnd|ground)(?:\.\d+)?$/i.test(pin);
}

function isPowerPin(pin: string): boolean {
  return /^(5v|3v3|3\.3v|vin|vcc|12v|24v|vbatt|battery\+?)$/i.test(pin);
}

function safeSvg(svg: unknown): boolean {
  if (typeof svg !== 'string' || svg.length > 250_000) return false;
  return !/<\s*script|javascript\s*:|on[a-z]+\s*=/i.test(svg);
}

function normalizeComponent(raw: unknown, path: string, errors: string[], warnings: string[]): AgentComponent | null {
  if (!isRecord(raw)) {
    errors.push(`${path} must be an object.`);
    return null;
  }

  const id = typeof raw.id === 'string' ? raw.id.trim() : '';
  const type = typeof raw.type === 'string' ? raw.type.trim().toLowerCase() : '';
  if (!COMPONENT_ID.test(id)) errors.push(`${path}.id must be a short stable identifier.`);
  if (!type || type.length > 80) errors.push(`${path}.type must be a non-empty component type.`);
  if (!isFiniteNumber(raw.x) || raw.x < 0 || raw.x > 2500) errors.push(`${path}.x must be between 0 and 2500.`);
  if (!isFiniteNumber(raw.y) || raw.y < 0 || raw.y > 2500) errors.push(`${path}.y must be between 0 and 2500.`);

  if (raw.pins !== undefined && (!Array.isArray(raw.pins) || raw.pins.length > 64)) {
    errors.push(`${path}.pins must be an array with at most 64 entries.`);
  }
  if (type.startsWith('custom_') || raw.custom) {
    warnings.push(`${path} is a custom component; verify its electrical model before powering real hardware.`);
  }

  if (errors.some(error => error.startsWith(path))) return null;
  return {
    ...raw,
    id,
    type,
    x: raw.x as number,
    y: raw.y as number,
  } as AgentComponent;
}

export function validateAgentPlan(input: unknown): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!isRecord(input)) return { ok: false, errors: ['Agent output must be a JSON object.'], warnings };
  if (!Array.isArray(input.steps)) return { ok: false, errors: ['Agent output must include a steps array.'], warnings };
  if (input.steps.length > MAX_STEPS) errors.push(`A plan may contain at most ${MAX_STEPS} steps.`);
  if (input.blueprint_svg !== undefined && !safeSvg(input.blueprint_svg)) {
    errors.push('blueprint_svg contains unsafe markup or is too large.');
  }

  const components = new Map<string, AgentComponent>();
  const wires = new Map<string, AgentWire>();
  const normalizedSteps: AgentStep[] = [];

  input.steps.slice(0, MAX_STEPS).forEach((rawStep, stepIndex) => {
    const path = `steps[${stepIndex}]`;
    if (!isRecord(rawStep)) {
      errors.push(`${path} must be an object.`);
      return;
    }
    const instruction = typeof rawStep.instruction === 'string' ? rawStep.instruction.trim() : '';
    if (!instruction) errors.push(`${path}.instruction is required.`);
    const detail = typeof rawStep.detail === 'string' ? rawStep.detail.trim() : '';
    const verify = typeof rawStep.verify === 'string' ? rawStep.verify.trim() : '';
    if (!detail) errors.push(`${path}.detail must explain the physical task, connections, or engineering reason.`);
    if (!verify) errors.push(`${path}.verify must provide an observable check or measurement.`);
    if (rawStep.code !== undefined && (typeof rawStep.code !== 'string' || !rawStep.code.trim())) {
      errors.push(`${path}.code must be a non-empty string when provided.`);
    }
    if (rawStep.code_language !== undefined && (typeof rawStep.code_language !== 'string' || !rawStep.code_language.trim())) {
      errors.push(`${path}.code_language must be a non-empty string when provided.`);
    }
    errors.push(...validateElectricalTestWording(rawStep, path));

    const rawComponents = rawStep.add_components ?? [];
    const rawWires = rawStep.add_wiring ?? [];
    if (!Array.isArray(rawComponents) || rawComponents.length > MAX_COMPONENTS_PER_STEP) {
      errors.push(`${path}.add_components must contain at most ${MAX_COMPONENTS_PER_STEP} items.`);
    }
    if (!Array.isArray(rawWires) || rawWires.length > MAX_WIRES_PER_STEP) {
      errors.push(`${path}.add_wiring must contain at most ${MAX_WIRES_PER_STEP} items.`);
    }

    for (const id of Array.isArray(rawStep.remove_components) ? rawStep.remove_components : []) {
      if (typeof id !== 'string') errors.push(`${path}.remove_components contains an invalid id.`);
      else components.delete(id);
    }
    for (const item of Array.isArray(rawStep.remove_wiring) ? rawStep.remove_wiring : []) {
      if (typeof item === 'string') {
        for (const [key, wire] of wires) {
          if (wire.from === item || wire.to === item) wires.delete(key);
        }
      } else if (item && typeof item === 'object' && item.from && item.to) {
        wires.delete(`${item.from}|${item.to}`);
      } else {
        errors.push(`${path}.remove_wiring contains an invalid endpoint.`);
      }
    }

    const addComponents: AgentComponent[] = [];
    if (Array.isArray(rawComponents)) {
      rawComponents.forEach((rawComponent, componentIndex) => {
        const component = normalizeComponent(rawComponent, `${path}.add_components[${componentIndex}]`, errors, warnings);
        if (component) {
          components.set(component.id, component);
          addComponents.push(component);
        }
      });
    }

    const addWiring: AgentWire[] = [];
    if (Array.isArray(rawWires)) {
      rawWires.forEach((rawWire, wireIndex) => {
        const wirePath = `${path}.add_wiring[${wireIndex}]`;
        if (!isRecord(rawWire)) {
          errors.push(`${wirePath} must be an object.`);
          return;
        }
        const from = endpoint(rawWire.from);
        const to = endpoint(rawWire.to);
        if (!from || !to) {
          errors.push(`${wirePath} must use from/to values like component:pin.`);
          return;
        }
        if (!components.has(from.componentId) || !components.has(to.componentId)) {
          // Changed to warning because in UPDATE_CURRENT or CROSS-TAB wiring, 
          // the component might exist in a previous step or another tab.
          warnings.push(`${wirePath} references a component not created in this payload (might be in another tab or previous step).`);
        }
        if (from.componentId === to.componentId && from.pin.toLowerCase() === to.pin.toLowerCase()) {
          errors.push(`${wirePath} connects a pin to itself.`);
          return;
        }
        if ((isPowerPin(from.pin) && isGroundPin(to.pin)) || (isGroundPin(from.pin) && isPowerPin(to.pin))) {
          errors.push(`${wirePath} is a direct power-to-ground short circuit.`);
          return;
        }
        const wire: AgentWire = { ...rawWire, from: rawWire.from as string, to: rawWire.to as string } as AgentWire;
        wires.set(`${wire.from}|${wire.to}`, wire);
        addWiring.push(wire);
      });
    }

    normalizedSteps.push({
      ...rawStep,
      instruction,
      detail,
      verify,
      add_components: addComponents,
      add_wiring: addWiring,
    } as AgentStep);
  });

  if (input.action && !['NEW_PROJECT', 'UPDATE_CURRENT', 'NEW_TAB', 'MERGE_TAB'].includes(String(input.action))) {
    errors.push('Unknown agent action.');
  }

  const plan: AgentPlan = {
    ...input,
    steps: normalizedSteps,
  } as AgentPlan;
  warnings.push(...reviewGeneratedCode(normalizedSteps).map(finding =>
    `Code review (step ${finding.stepNumber}): ${finding.message}`,
  ));
  return { ok: errors.length === 0, value: plan, errors, warnings };
}

export function extractTutorialResponse(text: string): ExtractedTutorialResponse {
  const tagged = extractTaggedJson(text, 'tutorial');
  const candidates: Array<{ value: unknown; start?: number; end?: number }> = [];
  if (tagged) candidates.push({ value: tagged });

  // Fast path: check markdown json code block first
  const fencedMatch = /```(?:json)?\s*(\{[\s\S]*?"steps"[\s\S]*?\})\s*```/i.exec(text);
  if (fencedMatch) {
    try {
      const parsed = JSON.parse(fencedMatch[1]);
      if (isRecord(parsed) && Array.isArray(parsed.steps)) {
        candidates.push({ value: parsed, start: fencedMatch.index, end: fencedMatch.index + fencedMatch[0].length });
      }
    } catch {}
  }

  let candidate = findJsonObject(text, 0, 'steps');
  while (candidate) {
    if (isRecord(candidate.value) && Array.isArray(candidate.value.steps)) {
      candidates.push(candidate);
    }
    candidate = findJsonObject(text, candidate.start + 1, 'steps');
  }

  let lastErrors = ['The response did not contain a tutorial JSON object with a steps array.'];
  let lastWarnings: string[] = [];
  for (const item of candidates) {
    const result = validateAgentPlan(item.value);
    if (result.ok && result.value?.steps.length) {
      let cleanText = cleanAgentText(text);
      if (item.start !== undefined && item.end !== undefined) {
        cleanText = cleanAgentText(`${text.slice(0, item.start)}${text.slice(item.end)}`)
          .replace(/```(?:json)?\s*```/gi, '')
          .trim();
      }
      return { plan: result.value, cleanText, errors: [], warnings: result.warnings };
    }
    lastErrors = result.errors.length ? result.errors : ['The tutorial has no build steps.'];
    lastWarnings = result.warnings;
  }

  return { plan: null, cleanText: cleanAgentText(text), errors: lastErrors, warnings: lastWarnings };
}

export function extractTaggedJson(text: string, tag: string): unknown | null {
  // Strategy 1: Content-based — <tag>{JSON}</tag>
  const contentPattern = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)(?:</${tag}>|$)`, 'i');
  const contentMatch = contentPattern.exec(text);
  if (contentMatch) {
    const inner = contentMatch[1].trim();
    if (inner.length > 2) {
      try {
        return JSON.parse(inner.replace(/,\s*([}\]])/g, '$1'));
      } catch { /* fall through to attribute strategy */ }
    }
  }

  // Strategy 2: Attribute-based — <tag action="..." steps='[...]'>
  const attrPattern = new RegExp(`<${tag}\\s+([^>]+?)\\s*/?>`, 'i');
  const attrMatch = attrPattern.exec(text);
  if (attrMatch) {
    try {
      const attrs = attrMatch[1];
      const obj: Record<string, unknown> = {};
      // Extract key="value" or key='value' pairs
      const kvRegex = /(\w+)\s*=\s*(?:"([^"]*?)"|'([^']*?)')/g;
      let kv;
      while ((kv = kvRegex.exec(attrs)) !== null) {
        const key = kv[1];
        const val = kv[2] ?? kv[3];
        // Try to parse JSON values (arrays, objects, numbers)
        try { obj[key] = JSON.parse(val); } catch { obj[key] = val; }
      }
      if (Object.keys(obj).length > 0) return obj;
    } catch { /* fall through */ }
  }

  return null;
}

export function cleanAgentText(text: string): string {
  return text
    .replace(/<work[\s>][\s\S]*?<\/work>/gi, '')
    .replace(/<tutorial[\s>][\s\S]*?(?:<\/tutorial>|$)/gi, '')
    .replace(/<pcb_design[\s>][\s\S]*?(?:<\/pcb_design>|$)/gi, '')
    .replace(/<cmd[\s>][\s\S]*?<\/cmd>/gi, '')
    .replace(/<nav\s+step="\d+"\s*\/>/gi, '')
    .replace(/<options[\s>][\s\S]*?<\/options>/gi, '')
    .replace(/<next_steps[\s>][\s\S]*?<\/next_steps>/gi, '')
    .replace(/<implementation_plan[\s>][\s\S]*?(?:<\/implementation_plan>|$)/gi, '')
    .trim();
}

// --- Interactive Options Protocol ---
export interface AgentOption {
  id: string;
  label: string;
  desc?: string;
}

export interface AgentOptionsBlock {
  title: string;
  mode: 'single' | 'multi';
  options: AgentOption[];
}

export function extractOptions(text: string): AgentOptionsBlock | null {
  const pattern = /<options\s+title="([^"]+)"(?:\s+mode="([^"]+)")?>([\s\S]*?)<\/options>/i;
  const match = pattern.exec(text);
  if (!match) return null;

  const title = match[1];
  const mode = (match[2] as 'single' | 'multi') || 'single';
  const optionsRaw = match[3];

  const options: AgentOption[] = [];
  const optionRegex = /<option\s+id="([^"]+)"\s+label="([^"]+)"(?:\s+desc="([^"]*)")?\s*\/>/gi;
  let optMatch;
  while ((optMatch = optionRegex.exec(optionsRaw)) !== null) {
    options.push({ id: optMatch[1], label: optMatch[2], desc: optMatch[3] });
  }

  return options.length > 0 ? { title, mode, options } : null;
}

// --- Next Steps Protocol ---
export interface AgentNextStepItem {
  label: string;
  action: string;
}

export interface AgentNextStepsBlock {
  completed: string;
  steps: AgentNextStepItem[];
}

export function extractNextSteps(text: string): AgentNextStepsBlock | null {
  const pattern = /<next_steps\s+completed="([^"]+)">([\s\S]*?)<\/next_steps>/i;
  const match = pattern.exec(text);
  if (!match) return null;

  const completed = match[1];
  const stepsRaw = match[2];

  const steps: AgentNextStepItem[] = [];
  const stepRegex = /<step\s+label="([^"]+)"\s+action="([^"]+)"\s*\/>/gi;
  let stepMatch;
  while ((stepMatch = stepRegex.exec(stepsRaw)) !== null) {
    steps.push({ label: stepMatch[1], action: stepMatch[2] });
  }

  return steps.length > 0 ? { completed, steps } : null;
}
