import type { AgentPlan } from './protocol';
import { canShareCircuitEndpoint, splitCircuitEndpoint } from '../circuit-networks';

const PROJECT_RESET_REQUEST = /\b(?:start|create|make|begin|open)\s+(?:a\s+)?new\s+project\b|\bnew\s+project\s+from\s+scratch\b|\bstart\s+over\b|\breset\s+(?:the\s+)?(?:current\s+)?project\b|\bfrom\s+scratch\b|\b(?:naya|nayi)\s+project\s+(?:shuru|start|banao)\b/i;
const EXPLICIT_TAB_REQUEST = /\b(?:new|separate|own)\s+(?:workspace\s+)?(?:tab|module|subsystem|phase)\b|\b(?:naya|alag)\s+(?:tab|module|subsystem)\b/i;
const EDIT_VERB = /\b(?:add|insert|include|remove|delete|edit|update|modify|change|fix|correct|replace|move|connect|wire|attach|extend|revise|append|adjust|test|testing|validate|verify|debug|check|jod(?:o|na)?|lagao|lagana|hatao|hatana|badlo|badalna|sudhar(?:o|na)?|theek|sahi|जोड़|लगाओ|हटाओ|बदलो|सुधार|ठीक|जाँच|जांच)\b/i;
const EDIT_TARGET = /\b(?:step|test|testing|verification|validation|wire|wiring|component|part|pin|circuit|connection|firmware|code|sketch|sensor|motor|module|board|tab|diagram|design|led|resistors?|capacitors?|diodes?|transistors?|mosfets?|servos?|batter(?:y|ies)|drivers?|switch(?:es)?|relays?|breadboards?|arduino|esp32|l298n|controller|gpio)\b|स्टेप|टेस्ट|वायर|कंपोनेंट|सर्किट/i;
const CODE_REQUEST = /\b(?:write|generate|create|update|change|fix|rewrite|implement|program)\b.{0,80}\b(?:code|firmware|sketch|program)\b|\b(?:code|firmware|sketch)\b.{0,60}\b(?:write|generate|create|update|change|fix|rewrite|implement|program|likh(?:o|na)?|bana(?:o|na)?|de|do)\b|(?:कोड|फर्मवेयर|स्केच).{0,40}(?:लिख|बना|दे|दो)/i;
const DIRECT_TEST_REQUEST = /\b(?:test|testing|validate|validation|verify|verification|debug|troubleshoot|check)\b.{0,45}\b(?:this|it|current|the|my)\b|\b(?:test|testing|check|verify|validate|debug)\s*(?:kar|karo|kare|karke|do|please)\b|\b(?:isko|isse|ise)\s*(?:test|check|verify|validate|debug)\b/i;

export function isCanvasMutationRequest(request: string): boolean {
  if (PROJECT_RESET_REQUEST.test(request)) return true;
  return /\b(?:build|make|design|wire|create|construct|assemble|implement|prototype|draw|diagram)\b/i.test(request)
    || CODE_REQUEST.test(request)
    || DIRECT_TEST_REQUEST.test(request)
    || (EDIT_VERB.test(request) && EDIT_TARGET.test(request));
}

export function insertStepsAfter<T extends { insert_after_step?: number; replace_step?: number }>(
  existingSteps: T[],
  incomingSteps: T[],
): { steps: T[]; firstInsertedIndex: number } {
  if (incomingSteps.length === 0) {
    return { steps: existingSteps, firstInsertedIndex: existingSteps.length };
  }

  const insertions = new Map<number, T[]>();
  const replacements = new Map<number, T>();
  for (const step of incomingSteps) {
    if (Number.isInteger(step.replace_step)) {
      const oneBasedStep = step.replace_step as number;
      if (oneBasedStep >= 1 && oneBasedStep <= existingSteps.length) {
        const replacement = { ...step };
        delete replacement.replace_step;
        replacements.set(oneBasedStep - 1, replacement as T);
      }
      continue;
    }

    const requestedBoundary = step.insert_after_step;
    const boundary = Number.isInteger(requestedBoundary)
      ? Math.max(0, Math.min(requestedBoundary as number, existingSteps.length))
      : existingSteps.length;
    const group = insertions.get(boundary) || [];
    group.push(step);
    insertions.set(boundary, group);
  }

  const merged: T[] = [];
  let firstInsertedIndex = replacements.size
    ? Math.min(...replacements.keys())
    : existingSteps.length;

  for (let boundary = 0; boundary <= existingSteps.length; boundary += 1) {
    const group = insertions.get(boundary);
    if (group?.length) {
      firstInsertedIndex = Math.min(firstInsertedIndex, merged.length);
      merged.push(...group);
    }
    if (boundary < existingSteps.length) {
      merged.push(replacements.get(boundary) || existingSteps[boundary]);
    }
  }

  return { steps: merged, firstInsertedIndex };
}

export interface WorkspaceMemoryTab {
  name: string;
  mergedFrom?: string[];
  components?: Array<{ id: string; type: string }>;
  wires?: Array<{ from: string; to: string; net?: string; stepIndex?: number }>;
}

interface MergeableCircuitStep {
  replace_step?: number;
  phase?: string;
  instruction?: string;
  detail?: string;
  verify?: string;
  code?: string;
  code_language?: string;
  add_components?: any[];
  add_wiring?: any[];
  remove_components?: string[];
  remove_wiring?: Array<string | { from: string; to: string }>;
}

function canonicalWireKey(from: string, to: string): string {
  return [from.trim().toLowerCase(), to.trim().toLowerCase()].sort().join('|');
}

function stepSignature(step: MergeableCircuitStep): string {
  const sorted = (items: any[] | undefined, key: (item: any) => string) =>
    [...(items || [])].sort((left, right) => key(left).localeCompare(key(right))).map(item => JSON.stringify(item));
  return JSON.stringify({
    phase: step.phase || '',
    instruction: step.instruction || '',
    detail: step.detail || '',
    verify: step.verify || '',
    code: step.code || '',
    code_language: step.code_language || '',
    add_components: sorted(step.add_components, item => `${item.id}:${item.type}:${item.x}:${item.y}`),
    add_wiring: sorted(step.add_wiring, item => canonicalWireKey(item.from, item.to)),
    remove_components: [...(step.remove_components || [])].sort(),
    remove_wiring: sorted(step.remove_wiring, item => typeof item === 'string' ? item : canonicalWireKey(item.from, item.to)),
  });
}

function rebuildActiveCircuitState(steps: MergeableCircuitStep[]) {
  const components = new Map<string, { id: string; type?: string; [key: string]: unknown }>();
  const wires = new Map<string, { from: string; to: string; [key: string]: unknown }>();
  for (const step of steps) {
    for (const id of step.remove_components || []) {
      components.delete(id);
      for (const [key, wire] of wires) {
        if (wire.from.startsWith(`${id}:`) || wire.to.startsWith(`${id}:`)) wires.delete(key);
      }
    }
    for (const removal of step.remove_wiring || []) {
      if (typeof removal === 'string') {
        for (const [key, wire] of wires) {
          if (wire.from === removal || wire.to === removal) wires.delete(key);
        }
      } else if (removal?.from && removal?.to) {
        wires.delete(canonicalWireKey(removal.from, removal.to));
      }
    }
    for (const component of step.add_components || []) components.set(component.id, component);
    for (const wire of step.add_wiring || []) wires.set(canonicalWireKey(wire.from, wire.to), wire);
  }
  return { components, wires };
}

export function mergeCircuitSteps<T extends MergeableCircuitStep>(baseSteps: T[], incomingSteps: T[]) {
  const steps = [...baseSteps];
  const knownSignatures = new Map(steps.map((step, index) => [stepSignature(step), index]));
  const sourceStepIndices: number[] = [];
  const active = rebuildActiveCircuitState(steps);
  const idRemap = new Map<string, string>();
  let firstInsertedIndex = steps.length;

  for (let sourceIndex = 0; sourceIndex < incomingSteps.length; sourceIndex += 1) {
    const original = incomingSteps[sourceIndex];
    const duplicateAt = knownSignatures.get(stepSignature(original));
    if (duplicateAt !== undefined) {
      sourceStepIndices[sourceIndex] = duplicateAt;
      continue;
    }

    const remapEndpoint = (endpoint: string) => {
      const separator = endpoint.indexOf(':');
      if (separator < 0) return endpoint;
      const id = endpoint.slice(0, separator);
      const replacement = idRemap.get(id);
      return replacement ? `${replacement}${endpoint.slice(separator)}` : endpoint;
    };
    const cloned = JSON.parse(JSON.stringify(original)) as T;
    cloned.add_components = (cloned.add_components || []).map(component => {
      const existing = active.components.get(component.id);
      if (existing && existing.type && component.type && existing.type !== component.type && !idRemap.has(component.id)) {
        let suffix = 2;
        let candidate = `${component.id}_merged${suffix}`.slice(0, 48);
        while (active.components.has(candidate)) {
          suffix += 1;
          candidate = `${component.id}_merged${suffix}`.slice(0, 48);
        }
        idRemap.set(component.id, candidate);
      }
      return { ...component, id: idRemap.get(component.id) || component.id };
    }).filter(component => {
      const existing = active.components.get(component.id);
      return !existing || (existing.type && component.type && existing.type !== component.type);
    });
    cloned.remove_components = (cloned.remove_components || []).map(id => idRemap.get(id) || id);
    cloned.add_wiring = (cloned.add_wiring || []).map(wire => ({
      ...wire,
      from: remapEndpoint(wire.from),
      to: remapEndpoint(wire.to),
    })).filter(wire => !active.wires.has(canonicalWireKey(wire.from, wire.to)));
    cloned.remove_wiring = (cloned.remove_wiring || []).map(removal => typeof removal === 'string'
      ? remapEndpoint(removal)
      : { from: remapEndpoint(removal.from), to: remapEndpoint(removal.to) });

    firstInsertedIndex = Math.min(firstInsertedIndex, steps.length);
    sourceStepIndices[sourceIndex] = steps.length;
    steps.push(cloned);
    knownSignatures.set(stepSignature(cloned), steps.length - 1);
    const rebuilt = rebuildActiveCircuitState(steps);
    active.components.clear();
    active.wires.clear();
    for (const [id, component] of rebuilt.components) active.components.set(id, component);
    for (const [key, wire] of rebuilt.wires) active.wires.set(key, wire);
  }

  return { steps, firstInsertedIndex, sourceStepIndices };
}

export function buildChatProjectMemory(tabs: WorkspaceMemoryTab[]): string {
  const circuitTabs = tabs.filter(tab => tab.components?.length || tab.wires?.length);
  if (!circuitTabs.length) return '';
  const lineages = circuitTabs
    .filter(tab => tab.mergedFrom?.length)
    .map(tab => `${tab.name} includes ${tab.mergedFrom!.join(', ')}`);
  const connectionCount = circuitTabs.reduce((total, tab) => total + (tab.wires?.length || 0), 0);
  return [
    'Persisted project memory for this chat:',
    `Circuit tabs in this chat: ${circuitTabs.map(tab => tab.name).join(', ')}.`,
    ...(lineages.length ? [`Merged tab history: ${lineages.join('; ')}.`] : []),
    `The workspace contains ${connectionCount} active connection${connectionCount === 1 ? '' : 's'}; treat their pin-to-net assignments above as reserved across tabs. Give unrelated signals free pins; only supply, ground, or explicitly shared bus nets may fan out.`,
    'If later steps use a breadboard, show that same board from the first wiring step and keep its hole mapping stable.',
  ].join('\n');
}

export function findSignalPinReuseConflicts(
  tabs: WorkspaceMemoryTab[],
  incomingSteps: Array<Pick<MergeableCircuitStep, 'add_components' | 'add_wiring' | 'remove_components' | 'remove_wiring' | 'replace_step'>>,
  targetTabName: string,
): string[] {
  const componentTypes = new Map<string, string>();
  const wires = new Map<string, { from: string; to: string; net?: string; stepIndex?: number; tabName: string }>();
  for (const tab of tabs) {
    for (const component of tab.components || []) componentTypes.set(component.id, component.type);
    for (const wire of tab.wires || []) wires.set(canonicalWireKey(wire.from, wire.to), { ...wire, tabName: tab.name });
  }

  const pinParts = (endpoint: string) => {
    const parts = splitCircuitEndpoint(endpoint);
    return { id: parts.componentId, pin: parts.pin };
  };
  const mayFanOut = (endpoint: string) => canShareCircuitEndpoint(endpoint, id => componentTypes.get(id));
  const conflicts = new Map<string, { endpoint: string; peers: Set<string> }>();

  for (const step of incomingSteps) {
    if (Number.isInteger(step.replace_step)) {
      for (const [key, wire] of wires) {
        if (wire.tabName.toLowerCase() === targetTabName.toLowerCase() && wire.stepIndex === (step.replace_step as number) - 1) wires.delete(key);
      }
    }
    for (const component of step.add_components || []) componentTypes.set(component.id, component.type || '');
    for (const id of step.remove_components || []) {
      for (const [key, wire] of wires) {
        if (wire.tabName.toLowerCase() === targetTabName.toLowerCase() && (wire.from.startsWith(`${id}:`) || wire.to.startsWith(`${id}:`))) wires.delete(key);
      }
      componentTypes.delete(id);
    }
    for (const removal of step.remove_wiring || []) {
      for (const [key, wire] of wires) {
        if (wire.tabName.toLowerCase() !== targetTabName.toLowerCase()) continue;
        if (typeof removal === 'string'
          ? wire.from === removal || wire.to === removal
          : canonicalWireKey(wire.from, wire.to) === canonicalWireKey(removal.from, removal.to)) wires.delete(key);
      }
    }
    for (const wire of step.add_wiring || []) {
      const key = canonicalWireKey(wire.from, wire.to);
      if (wires.has(key)) continue;
      for (const [endpoint, peer] of [[wire.from, wire.to], [wire.to, wire.from]]) {
        if (mayFanOut(endpoint)) continue;
        const normalizedEndpoint = endpoint.toLowerCase();
        const existing = Array.from(wires.values()).filter(item => item.from.toLowerCase() === normalizedEndpoint || item.to.toLowerCase() === normalizedEndpoint);
        const conflicting = existing.filter(item => {
          const oldPeer = item.from.toLowerCase() === normalizedEndpoint ? item.to : item.from;
          return oldPeer.toLowerCase() !== peer.toLowerCase() && !(wire.net && item.net && wire.net.trim().toLowerCase() === item.net.trim().toLowerCase());
        });
        if (conflicting.length) {
          const conflict = conflicts.get(normalizedEndpoint) || { endpoint, peers: new Set<string>() };
          conflicting.forEach(item => conflict.peers.add(item.from.toLowerCase() === normalizedEndpoint ? item.to : item.from));
          conflicts.set(normalizedEndpoint, conflict);
        }
      }
      wires.set(key, { ...wire, tabName: targetTabName });
    }
  }
  return Array.from(conflicts.values()).map(({ endpoint, peers }) => `${endpoint} is already assigned to ${Array.from(peers).join(', ')}`);
}

export function routePlanPhase(
  tutorial: AgentPlan,
  phaseName: string,
  existingTabNames: string[],
): AgentPlan {
  const normalizedName = phaseName.trim();
  if (!normalizedName) return tutorial;
  const exists = existingTabNames.some(name => name.trim().toLowerCase() === normalizedName.toLowerCase());
  return {
    ...tutorial,
    action: exists ? 'UPDATE_CURRENT' : 'NEW_TAB',
    target_tab: normalizedName,
  };
}

export function routeExplicitStepEdit(
  tutorial: AgentPlan,
  request: string,
  activeTabName: string,
  visibleStepNumber: number,
): AgentPlan {
  if (PROJECT_RESET_REQUEST.test(request)) return tutorial;

  const explicitStep = /\bafter\b(?:\s+\w+){0,5}\s+\bstep\s*#?(\d+)\b/i.exec(request)
    || /\bstep\s*#?(\d+)\s+(?:ke\s+baad|ke\s+bad|after)\b/i.exec(request);
  const explicitReplacement = /\b(?:replace|revise|correct|rewrite|edit|fix|update)\b.{0,60}\bstep\s*#?(\d+)\b/i.exec(request)
    || /\bstep\s*#?(\d+)\s+(?:ko\s+)?(?:replace|revise|correct|rewrite|edit|fix|update|sahi|theek|sudhar(?:o|na)?)\b/i.exec(request);
  const replacesCurrentStep = /\b(?:replace|revise|correct|rewrite|edit|fix|update)\b.{0,60}\b(?:current|selected|this)\s+step\b/i.test(request)
    || /\b(?:current|selected|this|iss|is|yeh)\s+step\s+(?:ko\s+)?(?:sahi|theek|fix|correct|edit|revise|sudhar(?:o|na)?)\b/i.test(request);
  if (explicitReplacement || replacesCurrentStep) {
    const stepNumber = explicitReplacement ? Number(explicitReplacement[1]) : visibleStepNumber;
    return {
      ...tutorial,
      action: 'UPDATE_CURRENT',
      target_tab: activeTabName || tutorial.target_tab,
      steps: tutorial.steps.map(step => ({ ...step, replace_step: stepNumber })),
    };
  }

  const afterCurrentStep = /\bafter\b.{0,48}\b(?:this|current|selected|active)\s+step\b/i.test(request)
    || /\b(?:iss|is|yeh|this|current|selected)\s+step\s+ke\s+baad\b/i.test(request)
    || /\b(?:is|us)ke\s+baad\b|\bstep\s+ke\s+baad\b/i.test(request)
    || /(?:इस|इसी)\s+(?:स्टेप|चरण)\s+के\s+बाद/u.test(request);
  const asksToAddStep = /\b(?:add|insert|include|create)\b.{0,64}\b(?:(?:a|an|one|new|test|testing|verification|validation|assembly|build)\s+){0,3}step\b/i.test(request)
    || /\b(?:test(?:ing)?|verification|validation)\s+step\b.{0,48}\b(?:add|insert|include|create|kar(?:o|na)?)\b/i.test(request)
    || /\bstep\b.{0,40}\b(?:add|insert|include|jod(?:o|na)?|lagao|kar(?:o|na)?)\b/i.test(request)
    || /(?:स्टेप|चरण).{0,30}(?:जोड़|डाल|बना)/u.test(request);
  const requestsInsertion = Boolean(explicitStep) || afterCurrentStep || asksToAddStep;

  if (requestsInsertion) {
    const explicitAnchor = explicitStep ? Number(explicitStep[1]) : undefined;
    const anchor = explicitAnchor ?? (afterCurrentStep ? visibleStepNumber : undefined);
    return {
      ...tutorial,
      action: 'UPDATE_CURRENT',
      target_tab: activeTabName || tutorial.target_tab,
      steps: tutorial.steps.map(step => ({
        ...step,
        insert_after_step: anchor ?? step.insert_after_step,
      })),
    };
  }

  if (EXPLICIT_TAB_REQUEST.test(request)) {
    if (tutorial.action === 'NEW_PROJECT') {
      return {
        ...tutorial,
        action: 'NEW_TAB',
        target_tab: tutorial.target_tab || tutorial.project_name || activeTabName,
      };
    }
    return tutorial;
  }

  if (CODE_REQUEST.test(request) || (EDIT_VERB.test(request) && EDIT_TARGET.test(request))) {
    return {
      ...tutorial,
      action: 'UPDATE_CURRENT',
      target_tab: activeTabName || tutorial.target_tab,
    };
  }

  return tutorial;
}
