'use client';

import { useState, useRef, useEffect, useCallback, type ChangeEvent } from 'react';
import { Send, Loader2, Terminal, Cpu, Zap, ChevronDown, ChevronUp, CheckCircle2, AlertTriangle, Cable, Code, Search, ArrowRight, Layers, GitMerge, Plus, Mic, ExternalLink, Play, BookOpen, Wrench, Trash2, History , Copy, Undo2, X, FileDown, Printer, Download, CircleDot } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { requestAgent, toGeminiImagePart, AgentRequestError, type AgentErrorCode, type AgentMessage } from '@/lib/agent/client';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { buildHardwareStudioSystemPrompt } from '@/lib/agent/system-prompt';
import { extractTutorialResponse, extractOptions, extractNextSteps, extractProjectPlanResponse, recoverPersistedProjectPlans } from '@/lib/agent/protocol';
import type { AgentOptionsBlock, AgentNextStepsBlock, AgentPlan, PlanBuildAction, ProjectPlan, ResearchSource } from '@/lib/agent/protocol';
import { findSignalPinReuseConflicts, isCanvasMutationRequest, routeExplicitStepEdit, routePlanPhase } from '@/lib/agent/workspace';
import { chatSessionKey, normalizeSessionTitle, type ChatSessionSummary } from '@/lib/session-store';
import { imageAttachmentDataUrl, isImageAttachment, MAX_IMAGE_ATTACHMENTS, prepareImageAttachments, type ImageAttachment } from '@/lib/agent/image-attachments';
import { useAuth } from '@/components/AuthProvider';
import { diffArduinoSource, extractRepairedArduinoSource, inferArduinoBoard, MAX_FIRMWARE_REPAIR_ATTEMPTS, normalizeArduinoSource, runFirmwareRepairLoop, type FirmwareCompileResult, type FirmwareDiffLine } from '@/lib/agent/firmware-validation';
import { compactConversationContext, messageReferencesPriorImage } from '@/lib/agent/context-compaction';
import { hardwareFetch } from '@/lib/hardware-api';
import type { TerminalCommandResult } from '@/components/Terminal';

// --- Interfaces ---
interface ParsedTutorial {
  action?: 'NEW_PROJECT' | 'UPDATE_CURRENT' | 'NEW_TAB' | 'MERGE_TAB';
  target_tab?: string;
  targetTabName?: string;
  projectName?: string;
  description?: string;
  blueprint_svg?: string;
  stepsCount: number;
  componentsCount: number;
  connectionsCount: number;
  codeSteps: number;
  codeQualityWarnings?: string[];
  phases: string[];
  steps: Array<{
    instruction: string;
    phase?: string;
    add_components?: any[];
    add_wiring?: any[];
    remove_components?: string[];
    remove_wiring?: string[];
    hasComponents: boolean;
    hasWiring: boolean;
    hasCode: boolean;
    hasVerify: boolean;
  }>;
}

interface WorkAction {
  type: string;
  file?: string;
  added?: string;
  removed?: string;
  text: string;
}

interface NextModuleChoice {
  id: string;
  label: string;
  description: string;
  prompt?: string;
  phaseIndex?: number;
  recommended?: boolean;
}

interface Message {
  role: 'user' | 'assistant';
  content: string;
  errorCode?: AgentErrorCode;
  cleanText?: string;
  createdAt?: number;
  commands?: string[];
  commandResults?: TerminalCommandResult[];
  tutorialData?: ParsedTutorial;
  workActions?: WorkAction[];
  workTimeMs?: number;
  optionsBlock?: AgentOptionsBlock;
  nextStepsBlock?: AgentNextStepsBlock;
  implementationPlan?: ProjectPlan;
  planTabId?: string;
  planTargetTabId?: string;
  planApproved?: boolean;
  sources?: ResearchSource[];
  phasePlan?: ProjectPlan;
  phaseIndex?: number;
  phaseCompletedIndices?: number[];
  phaseTargetTabId?: string;
  phaseStartApproach?: 'recommended' | 'canvas-first' | 'hardware-first';
  canvasWarning?: string;
  imageAttachments?: ImageAttachment[];
  firmwareBuilds?: FirmwareBuildReport[];
}

interface FirmwareBuildReport {
  status: 'verified' | 'unverified' | 'compile_failed';
  stepName: string;
  moduleName: string;
  stepNumber: number;
  stepInstruction: string;
  testCondition?: string;
  boardName?: string;
  repairAttempts: number;
  changes?: FirmwareDiffLine[];
  note?: string;
}

interface FirmwareCompileResponse {
  status?: unknown;
  detail?: unknown;
  error?: unknown;
  stderr?: unknown;
  stdout?: unknown;
  missing_libraries?: unknown[];
}

function componentTypesFromSteps(steps: unknown): string[] {
  if (!Array.isArray(steps)) return [];
  return steps.flatMap((entry: unknown) => {
    if (!entry || typeof entry !== 'object') return [];
    const components = (entry as Record<string, unknown>).add_components;
    if (!Array.isArray(components)) return [];
    return components.map((component: unknown) => {
      if (!component || typeof component !== 'object') return '';
      const record = component as Record<string, unknown>;
      return `${typeof record.type === 'string' ? record.type : ''} ${typeof record.label === 'string' ? record.label : ''}`;
    });
  });
}

interface WorkflowOverride {
  plan: ProjectPlan;
  phaseIndex: number;
  completedPhaseIndices: number[];
  targetTabId: string;
  startApproach?: 'recommended' | 'canvas-first' | 'hardware-first';
}

interface FirmwareRepairPatch {
  targetTabId?: string;
  targetTabName: string;
  stepInstruction: string;
  phase?: string;
  expectedCode: string;
  repairedCode: string;
}

interface ChatBoxProps {
  apiKeys: string[];
  model: string;
  availableModels?: Array<{ name: string; displayName?: string }>;
  onModelChange?: (model: string) => void;
  onExecuteCommand: (cmd: string) => Promise<TerminalCommandResult>;
  onUpdateCircuit?: (data: any, targetTabId?: string) => void;
  onApplyFirmwareRepair?: (repair: FirmwareRepairPatch) => void;
  onStepChange?: (step: number) => void;
  currentStep?: number;
  totalSteps?: number;
  circuitData?: any;
  allTabs?: Array<{ name: string; isActive: boolean; componentCount: number; wireCount: number; stepCount: number; components: Array<{ id: string; type: string; x?: number; y?: number }>; wires: Array<{ from: string; to: string; color?: string; net?: string; stepIndex?: number }>; pinAssignments?: string[]; stepOutline?: string[]; mergedFrom?: string[] }>;
  projectMemory?: string;
  activeTabId: string;
  targetWorkspaceTabId: string;
  sessionId: string;
  sessionTitle: string;
  sessions: ChatSessionSummary[];
  onNewChat: () => void;
  onSelectSession: (sessionId: string) => void;
  onUpdateSessionTitle: (title?: string) => void;
  onDeleteSession?: (sessionId: string, e: React.MouseEvent) => void;
  onOpenImplementationPlan: (plan: ProjectPlan, sources: ResearchSource[], tabId: string, targetTabId: string, focus?: boolean) => void;
  pendingPlanAction: PlanBuildAction | null;
  onPlanActionConsumed: () => void;
  modelSelectorNode?: React.ReactNode;
  onQuotaReached?: () => void;
  isQuotaReached?: boolean;
  onMessagesChange?: (messages: Message[]) => void;
}


const HARDWARE_PROMPTS = [
  "Build a line following robot...",
  "Design a 5-DOF robotic arm...",
  "Create an automated plant watering system...",
  "Simulate an RC drone flight controller...",
  "Build an LED cube with Arduino...",
  "Design a custom PCB for ESP32...",
  "Wire a biometric attendance system...",
  "Make a smart home weather station...",
  "Design a Bluetooth controlled car...",
  "Build an obstacle avoiding rover...",
  "Explain how a PID controller works...",
  "Create a digital clock using 7-segment displays...",
  "Design a battery management system...",
  "Wire an RFID door lock circuit...",
  "Build an audio spectrum analyzer..."
];

function isLargeHardwareTask(value: string): boolean {
  const text = value.trim().toLowerCase();
  if (!text) return false;

  const scopeSignals = [
    /\b(complete|full|end[- ]to[- ]end|from scratch|entire|multi[- ]step|all[- ]in[- ]one)\b/,
    /\b(integrat\w*|automat\w*|control\w*|monitor\w*|debug\w*|test\w*)\b/,
    /\b(robot|rover|drone|iot|smart home|project|system|pcb)\b/,
  ].filter(pattern => pattern.test(text)).length;
  const hardwareAreas = [
    /\b(arduino|esp32|microcontroller|raspberry pi)\b/,
    /\b(sensor|ultrasonic|dht|rfid|imu|camera)\b/,
    /\b(motor|servo|relay|actuator|robot)\b/,
    /\b(display|lcd|oled|led|buzzer)\b/,
    /\b(bluetooth|wifi|wi-fi|wireless|cloud|web)\b/,
    /\b(code|firmware|sketch|software)\b/,
  ].filter(pattern => pattern.test(text)).length;
  const largeBuildSignal = /\b(\d+[- ]?dof|robotic arm|line[- ]following|obstacle[- ]avoiding|plant watering|smart home|attendance system|custom pcb|drone|rover|automation|iot)\b/.test(text);
  const complexMechanismBuild = /\b(?:build|create|make|design|construct|prototype)\b/.test(text)
    && /\b(?:robotic\s+)?(?:wrist|hand|arm|joint|mechanism)\b/.test(text)
    && /\b(?:move|moves|moving|motion|movement|actuat\w*|human[- ]like)\b/.test(text);

  return text.length >= 320
    || (text.length >= 110 && scopeSignals >= 2 && hardwareAreas >= 2)
    || (text.length >= 45 && largeBuildSignal && hardwareAreas >= 1)
    || complexMechanismBuild
    || hardwareAreas >= 4;
}

function hasExplicitTerminalToolRequest(value: string): boolean {
  const namesTerminal = /\b(?:terminal|shell|command line|powershell|cmd prompt)\b/i.test(value);
  const mentionsCliTool = /\b(?:npm|pnpm|yarn|git|node|python)\b/i.test(value);
  const asksToUseTerminal = /\b(?:run|execute|open|use|work|command|debug|troubleshoot|fix|test|build|start)\b/i.test(value);
  return mentionsCliTool || (namesTerminal && asksToUseTerminal);
}

function isExplicitTerminalTask(value: string): boolean {
  return hasExplicitTerminalToolRequest(value)
    || /\b(?:debug|troubleshoot|run|start|build|compile|test|fix)\b.{0,35}\b(?:app|server|project|repo|repository|software|codebase|frontend|backend|code|tests?|build)\b/i.test(value);
}

function extractTerminalCommands(value: string): string[] {
  const commands: string[] = [];
  const commandTag = /<cmd(?:\s[^>]*)?>([\s\S]*?)<\/cmd>/gi;
  let match: RegExpExecArray | null;
  while ((match = commandTag.exec(value)) !== null) {
    const command = match[1].trim();
    if (command && !/<\w+[>\s]/.test(command)) commands.push(command);
  }
  return commands;
}

function getAgentOutputTokenBudget(request: string, workflowOverride: WorkflowOverride | undefined, hasImages: boolean): number {
  if (workflowOverride || isLargeHardwareTask(request) || hasImages) return 12_288;
  if (isCanvasMutationRequest(request)) return 6_144;
  return 3_072;
}

function shouldUseGroundedResearch(request: string, workflowOverride?: WorkflowOverride): boolean {
  if (/\b(?:research|look\s*up|find\s+sources?|datasheet|manufacturer|latest\s+(?:spec|version|rating)|verify\s+(?:the\s+)?(?:rating|spec))\b/i.test(request)) return true;
  // Approved phases inherit the already researched plan and part/interface decisions.
  if (workflowOverride) return false;
  if (isLargeHardwareTask(request)) return true;
  const hardwareAction = /\b(?:build|create|make|design|construct|prototype|wire|connect|add|insert|replace|change|modify)\b/i.test(request);
  return isCanvasMutationRequest(request)
    && hardwareAction
    && /\b(?:robot|robotic|wrist|joint|servo|motor|actuator|battery|mains|high[- ]current|power supply)\b/i.test(request)
}

function enforceInAppFirmwareGuidance(text: string, target: string): string {
  const outOfAppTools = /\b(?:arduino\s+ide|platformio|visual studio code|vs\s*code|another app|different app|external ide)\b/i;
  const leaveAppAction = /\b(?:open|launch|switch to|go to|use|copy|paste|upload|flash|compile|program|test)\b/i;
  const paragraphs = text.split(/(\n\s*\n)/);
  let replaced = false;
  const guarded = paragraphs.map(paragraph => {
    if (!outOfAppTools.test(paragraph) || !leaveAppAction.test(paragraph)) return paragraph;
    replaced = true;
    return `Testing stays in Kaktus: ${target}. Open this step's Code Preview, edit and save the sketch here, choose Flash in Kaktus, select the board and USB port, then use this app's Serial Monitor. A compile result is not a physical upload or test; if the board or Kaktus connection service is unavailable, physical testing must wait.`;
  }).join('');
  return replaced ? guarded.trim() : text;
}

function modelLabel(model: string, availableModels: Array<{ name: string; displayName?: string }> = []): string {
  const option = availableModels.find(candidate => candidate.name === model);
  if (option?.displayName) return option.displayName;
  return model.replace(/^models\//, '').replace(/-/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase());
}

function recommendFullFlashModel(model: string, availableModels: Array<{ name: string; displayName?: string }> = []) {
  const normalizedModel = model.replace(/^models\//, '').toLowerCase();
  const sameVersionName = normalizedModel.replace(/-lite$/, '');
  const sameVersion = availableModels.find(option => option.name.replace(/^models\//, '').toLowerCase() === sameVersionName);
  if (sameVersion) return sameVersion;

  return availableModels
    .filter(option => /gemini.*flash/i.test(option.name) && !/lite|preview|experimental/i.test(option.name))
    .sort((a, b) => b.name.localeCompare(a.name, undefined, { numeric: true }))[0];
}
const QUICK_ACTIONS = [
  { label: "LED Blink", prompt: "Build an LED blink circuit with Arduino, include resistor and explain each step" },
  { label: "Robotic Arm", prompt: "Build a 5-finger robotic arm with wrist joint using servo motors and PCA9685 driver" },
  { label: "Amplifier", prompt: "Build an audio amplifier using LM386 with volume control and speaker output" },
  { label: "Line Follower", prompt: "Build a line following robot with L298N motor driver, 3 IR sensors, and DC motors" },
];

async function validateGeneratedFirmware({
  plan,
  apiKeys,
  model,
  signal,
  componentTypes,
  onProgress,
}: {
  plan: AgentPlan;
  apiKeys: string[];
  model: string;
  signal: AbortSignal;
  componentTypes: string[];
  onProgress: (message: string) => void;
}): Promise<{ reports: FirmwareBuildReport[] }> {
  const codeSteps = plan.steps
    .map((step, index) => ({ step, index }))
    .filter(({ step }) => {
      const language = (step.code_language || '').toLowerCase();
      if (language && !/^(?:c\+\+|cpp|ino|arduino)$/.test(language)) return false;
      return Boolean(step.code && (/\bvoid\s+setup\s*\(|\bvoid\s+loop\s*\(|\bpinMode\s*\(|#include\s*[<"]Arduino\.h/i.test(step.code)
        || /^(?:c\+\+|cpp|ino|arduino)$/.test(language)));
    });
  if (!codeSteps.length) return { reports: [] };

  const reports: FirmwareBuildReport[] = [];
  for (const { step, index } of codeSteps) {
    const testTarget = {
      moduleName: plan.target_tab || plan.project_name || 'Current module',
      stepNumber: index + 1,
      stepInstruction: step.instruction,
      testCondition: step.verify,
    };
    const originalSource = step.code || '';
    let source = normalizeArduinoSource(originalSource);
    const board = inferArduinoBoard(source, componentTypes);
    let selectedBoard = board;

    if (!selectedBoard) {
      try {
        const response = await hardwareFetch('/flash/boards', { signal });
        if (response.ok) {
          const payload = await response.json();
          const detected = Array.isArray(payload.ports)
            ? payload.ports.find((port: { fqbn?: string; board?: string }) => typeof port.fqbn === 'string' && port.fqbn)
            : undefined;
          if (detected) selectedBoard = { fqbn: detected.fqbn, name: detected.board || detected.fqbn };
        }
      } catch (error) {
        if (signal.aborted) throw error;
      }
    }

    if (!selectedBoard) {
      step.code = source;
      reports.push({
        status: 'unverified', stepName: step.phase || 'Firmware', ...testTarget, repairAttempts: 0,
        note: 'The firmware source is saved and editable, but automatic compilation could not start because the target board was not identified. Select the board in Kaktus Flash to Board when it is available.',
      });
      return { reports };
    }

    const compile = async (code: string): Promise<FirmwareCompileResult> => {
      const runCompile = async () => {
        const response = await hardwareFetch('/flash/compile', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code, board: selectedBoard!.fqbn }),
          signal,
        });
        let payload: FirmwareCompileResponse;
        try { payload = await response.json(); } catch { payload = {}; }
        if (!response.ok) {
          const detail = String(payload.detail || payload.error || 'Compiler service is unavailable.');
          return { ok: false, diagnostics: detail, infrastructureFailure: true, missingLibraries: [] as string[] };
        }
        return {
          ok: payload.status === 'success',
          diagnostics: String(payload.error || payload.stderr || payload.stdout || 'Compilation failed without diagnostic output.'),
          infrastructureFailure: /arduino-cli not found|timed out|cannot connect|platform .* not found|board .* not installed|unknown board/i.test(String(payload.error || '')),
          missingLibraries: Array.isArray(payload.missing_libraries) ? payload.missing_libraries.filter((item: unknown) => typeof item === 'string') : [],
        };
      };

      let result = await runCompile();
      if (!result.ok && result.missingLibraries?.length) {
        onProgress(`Installing ${result.missingLibraries.length} missing Arduino librar${result.missingLibraries.length === 1 ? 'y' : 'ies'} for ${step.phase || `code step ${index + 1}`}...`);
        let installed = true;
        try {
          for (const library of [...new Set(result.missingLibraries)]) {
            const response = await hardwareFetch('/flash/install-library', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ library }),
              signal,
            });
            const payload = await response.json().catch((): FirmwareCompileResponse => ({}));
            if (!response.ok || payload.status !== 'success') installed = false;
          }
        } catch (error) {
          if (signal.aborted) throw error;
          installed = false;
        }
        if (installed) result = await runCompile();
        else result = { ...result, infrastructureFailure: true, diagnostics: 'A required Arduino library could not be installed.' };
      }
      return { ok: result.ok, diagnostics: result.diagnostics.slice(0, 18_000), infrastructureFailure: result.infrastructureFailure };
    };

    let repairAttempts = 0;
    onProgress(`Compiling ${step.phase || `code step ${index + 1}`} for ${selectedBoard.name}...`);
    let repairLoop: Awaited<ReturnType<typeof runFirmwareRepairLoop>>;
    try {
      repairLoop = await runFirmwareRepairLoop({
        initialSource: source,
        compile,
        maxAttempts: MAX_FIRMWARE_REPAIR_ATTEMPTS,
        onRepairAttempt: attempt => onProgress(`Compiler found an issue; asking ${model} for repair ${attempt} of ${MAX_FIRMWARE_REPAIR_ATTEMPTS}...`),
        repair: async (currentSource, diagnostics) => {
          onProgress(`Preparing repair for ${step.phase || `code step ${index + 1}`}...`);
          const repair = await requestAgent({
            apiKeys,
            model,
            systemPrompt: 'You are an expert Arduino and embedded C++ compiler repair engineer. Return only a complete corrected sketch in one fenced cpp code block. Fix the reported compiler errors while preserving the intended behavior, wiring, pins, and hardware assumptions. Do not claim it is verified; the compiler will test it again.',
            contents: [{ role: 'user', parts: [{ text: `Target board: ${selectedBoard.name} (${selectedBoard.fqbn})\nUser task: ${step.instruction}\n\nCompiler diagnostics:\n${diagnostics}\n\nCurrent complete sketch:\n\n\`\`\`cpp\n${currentSource}\n\`\`\`` }] }],
            temperature: 0.1,
            maxOutputTokens: 16_384,
            research: false,
            abortSignal: signal,
          });
          const repairedSource = extractRepairedArduinoSource(repair.text);
          onProgress(`Recompiling repaired code for ${selectedBoard.name}...`);
          return repairedSource;
        },
      });
    } catch (error) {
      if (signal.aborted) throw error;
      step.code = source;
      reports.push({
        status: 'unverified', stepName: step.phase || 'Firmware', ...testTarget, boardName: selectedBoard.name,
        repairAttempts, note: 'The firmware source is saved and editable, but the in-app compiler or repair service became unavailable before verification.',
      });
      return { reports };
    }
    source = repairLoop.source;
    repairAttempts = repairLoop.repairAttempts;
    const result = repairLoop.result;
    step.code = source;

    if (!result.ok) {
      reports.push({
        status: result.infrastructureFailure ? 'unverified' : 'compile_failed', stepName: step.phase || 'Firmware', ...testTarget, boardName: selectedBoard.name,
        repairAttempts,
        note: result.infrastructureFailure
          ? `The firmware source is saved and editable, but automatic compilation was unavailable: ${result.diagnostics.slice(0, 1200)}`
          : `The firmware source is saved and editable, but compilation still reports errors after ${repairAttempts} repair attempt${repairAttempts === 1 ? '' : 's'}: ${result.diagnostics.slice(0, 1600)}`,
      });
      return { reports };
    }

    const changes = diffArduinoSource(normalizeArduinoSource(originalSource), source);
    reports.push({
      status: 'verified', stepName: step.phase || 'Firmware', ...testTarget, boardName: selectedBoard.name,
      repairAttempts, changes: changes.length ? changes : undefined,
    });
  }
  return { reports };
}

// --- Subcomponents ---

function WorkAccordion({ actions, timeMs, active = false, currentActivity, startedAt }: {
  actions: WorkAction[];
  timeMs?: number;
  active?: boolean;
  currentActivity?: string;
  startedAt?: number;
}) {
  const [isOpen, setIsOpen] = useState(active);
  const [elapsedMs, setElapsedMs] = useState(0);

  useEffect(() => {
    if (!active || !startedAt) return;
    const updateElapsed = () => setElapsedMs(Date.now() - startedAt);
    updateElapsed();
    const interval = window.setInterval(updateElapsed, 1000);
    return () => window.clearInterval(interval);
  }, [active, startedAt]);

  if (!active && (!actions || actions.length === 0) && !timeMs) return null;

  const rawSeconds = Math.floor((active ? elapsedMs : timeMs || ((actions && actions.length) ? actions.length * 2000 : 1500)) / 1000);
  const seconds = Math.max(1, rawSeconds);
  const timeStr = seconds < 60 ? `${seconds}s` : `${Math.floor(seconds/60)}m ${seconds%60}s`;

  return (
    <div className="mb-3 mt-2 w-full max-w-[95%]">
      <button 
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        aria-expanded={isOpen}
        className="flex w-full items-center justify-between gap-2 border-b border-gray-800 pb-2 text-left text-xs text-gray-400 transition-colors hover:text-gray-200"
      >
        <span>{active ? 'Working' : 'Worked for'} {active ? `for ${timeStr}` : timeStr}</span>
        {isOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div 
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="space-y-3 py-3">
              {active && currentActivity && (
                <p role="status" aria-live="polite" className="flex items-start gap-2 text-xs leading-relaxed text-gray-200">
                  <Loader2 size={13} className="mt-0.5 shrink-0 animate-spin text-gray-400" />
                  <span>{currentActivity}</span>
                </p>
              )}
              {actions.map((act, i) => {
                let icon = <Terminal size={12} className="text-gray-500 mt-0.5" />;
                let content = <span className="text-gray-300">Ran <span className="font-mono text-gray-200 bg-blue-900/20 px-1 rounded">{act.text}</span></span>;

                if (act.type === 'edit') {
                  icon = <Code size={12} className="text-blue-500 mt-0.5" />;
                  content = (
                    <span className="text-gray-300">
                      Edited <span className="font-mono">{act.file || 'file'}</span> 
                      {act.added && <span className="text-gray-400 ml-2">+{act.added}</span>}
                      {act.removed && <span className="text-red-500 ml-1">-{act.removed}</span>}
                    </span>
                  );
                } else if (act.type === 'explore' || act.type === 'thought') {
                  icon = <Search size={12} className="text-amber-500 mt-0.5" />;
                  content = <span className="text-gray-300">{act.text}</span>;
                } else if (act.type === 'progress') {
                  icon = <CircleDot size={12} className="text-gray-500 mt-0.5" />;
                  content = <span className="text-gray-400">{act.text}</span>;
                }

                return (
                  <div key={i} className="flex items-start gap-2 text-[11px]">
                    {icon}
                    <div className="flex-1">{content}</div>
                  </div>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function FirmwareBuildSummary({ builds }: { builds: FirmwareBuildReport[] }) {
  return (
    <div className="mb-2 mt-2 w-full max-w-[95%] space-y-2">
      {builds.map((build, index) => (
        <section key={`${build.stepName}-${index}`} className={`border-l-2 pl-2.5 ${build.status === 'verified' ? 'border-emerald-700' : build.status === 'compile_failed' ? 'border-red-700' : 'border-amber-700'}`}>
          <p className={`flex items-center gap-1.5 text-[11px] ${build.status === 'verified' ? 'text-emerald-300' : build.status === 'compile_failed' ? 'text-red-300' : 'text-amber-300'}`}>
            {build.status === 'verified' ? <CheckCircle2 size={13} /> : <AlertTriangle size={13} />}
            <span className="font-medium">{build.status === 'verified' ? 'Firmware compile verified' : build.status === 'compile_failed' ? 'Firmware saved; compile failed' : 'Firmware saved; build unverified'}</span>
            {build.boardName && <span className="text-gray-500">· {build.boardName}</span>}
            {build.repairAttempts > 0 && <span className="text-gray-500">· {build.repairAttempts} repair{build.repairAttempts === 1 ? '' : 's'}</span>}
          </p>
          {build.note && <p className="mt-1 text-[11px] leading-relaxed text-gray-400">{build.note}</p>}
          <p className="mt-1 text-[11px] leading-relaxed text-gray-400">
            <span className="text-gray-300">In-app hardware test target:</span> {build.moduleName} · Step {build.stepNumber} ({build.stepName}) — {build.stepInstruction}
            {build.testCondition ? ` Pass condition: ${build.testCondition}` : ''}
            {' '}This compile check has not uploaded or physically tested the board. In Kaktus, open that step's Code Preview, save edits, choose Flash in Kaktus, select the board/USB port, then use Serial Monitor.
          </p>
          {build.changes && build.changes.length > 0 && (
            <details className="mt-1.5">
              <summary className="w-fit cursor-pointer text-[11px] text-gray-400 hover:text-gray-200">Code changes ({build.changes.filter(change => change.kind === 'added').length} added, {build.changes.filter(change => change.kind === 'removed').length} removed)</summary>
              <div className="mt-1 max-h-64 overflow-auto rounded border border-gray-800 bg-[#0a0a0a] py-1 font-mono text-[10px]">
                {build.changes.slice(0, 200).map((change, changeIndex) => (
                  <div key={`${change.kind}-${change.line}-${changeIndex}`} className={`whitespace-pre-wrap break-all px-2 ${change.kind === 'added' ? 'bg-emerald-950/40 text-emerald-300' : 'bg-red-950/30 text-red-300'}`}>
                    <span className="mr-2 inline-block w-14 text-right text-gray-600">{change.kind === 'added' ? `+${change.line}` : `-${change.line}`}</span>
                    <span className="mr-1">{change.kind === 'added' ? '+' : '-'}</span>{change.text || ' '}
                  </div>
                ))}
                {build.changes.length > 200 && <p className="px-2 py-1 text-gray-500">Showing first 200 changed lines.</p>}
              </div>
            </details>
          )}
        </section>
      ))}
    </div>
  );
}

function OptionsCard({ block, onSelect }: { block: AgentOptionsBlock, onSelect: (label: string) => void }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="mt-3 w-full max-w-[95%]"
    >
      <div className="bg-[#0a0a0a] border border-gray-700/50 rounded-xl overflow-hidden shadow-lg">
        <div className="px-4 py-3 border-b border-gray-800/60 bg-[#0f0f0f]">
          <div className="flex items-center gap-2 text-gray-200 text-sm font-semibold">
            <Layers size={16} className="text-blue-400" />
            {block.title}
          </div>
        </div>
        <div className="p-3 space-y-2">
          {block.options.map((opt) => (
            <button
              key={opt.id}
              onClick={() => onSelect(opt.label)}
              className="w-full text-left bg-[#141414] hover:bg-[#1a1a1a] border border-gray-800 hover:border-gray-600 rounded-lg px-4 py-3 transition-all group cursor-pointer"
            >
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-gray-200 text-sm font-medium group-hover:text-white transition-colors">
                    {opt.label}
                  </div>
                  {opt.desc && (
                    <div className="text-gray-500 text-xs mt-0.5 group-hover:text-gray-400 transition-colors">
                      {opt.desc}
                    </div>
                  )}
                </div>
                <ArrowRight size={14} className="text-gray-600 group-hover:text-gray-400 transition-colors flex-shrink-0 ml-3" />
              </div>
            </button>
          ))}
        </div>
      </div>
    </motion.div>
  );
}

function NextStepsCard({ block, onSelect }: { block: AgentNextStepsBlock, onSelect: (action: string) => void }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="mt-3 w-full max-w-[95%]"
    >
      <div className="bg-[#0a0a0a] border border-gray-700/50 rounded-xl overflow-hidden shadow-lg">
        <div className="px-4 py-2.5 border-b border-gray-800/60 bg-[#0f0f0f] flex items-center gap-2">
          <CheckCircle2 size={14} className="text-emerald-400" />
          <span className="text-gray-300 text-xs font-semibold">{block.completed}</span>
          <span className="text-gray-600 text-xs">completed. Next Step Pending:</span>
        </div>
        <div className="p-3 space-y-4">
          {block.steps.map((step, i) => (
            <div key={i}>
              <div className="flex items-start gap-2 text-[12px] mb-2">
                <CircleDot size={14} className="text-blue-500 mt-0.5 shrink-0" />
                <span className="text-gray-200 font-semibold">{step.label}</span>
              </div>
              <button
                onClick={() => onSelect(step.action)}
                className="ml-5 flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-md transition-colors text-xs font-medium shadow-md shadow-blue-900/20"
              >
                Proceed to Next Step <ArrowRight size={12} />
              </button>
            </div>
          ))}
        </div>
      </div>
    </motion.div>
  );
}

export function ImplementationPlanCard({ plan, sources, approved, canApprove, onApprove }: { plan: ProjectPlan; sources: ResearchSource[]; approved?: boolean; canApprove: boolean; onApprove: (approach: 'recommended' | 'canvas-first' | 'hardware-first', phaseIndex: number) => void }) {
  const [startApproach, setStartApproach] = useState<'recommended' | 'canvas-first' | 'hardware-first'>('canvas-first');
  const [startPhaseIndex, setStartPhaseIndex] = useState(0);
  const independentPhaseIndices = plan.subsystems.map((phase, index) => phase.dependencies.length === 0 ? index : -1).filter(index => index >= 0);
  const availableStartIndices = independentPhaseIndices.length ? independentPhaseIndices : [0];
  const selectedStartIndex = availableStartIndices.includes(startPhaseIndex) ? startPhaseIndex : availableStartIndices[0];

  return (
    <section className="mt-3 w-full max-w-[95%] border border-gray-700/50 bg-[#0a0a0a] rounded-lg overflow-hidden">
      <header className="px-4 py-3 border-b border-gray-800 flex items-center gap-2">
        <Layers size={16} className="text-gray-300" />
        <h3 className="text-sm font-semibold text-gray-100">{plan.title}</h3>
      </header>
      <div className="p-4 space-y-4">
        <p className="text-xs leading-relaxed text-gray-300">{plan.summary}</p>
        <div>
          <h4 className="text-[11px] uppercase font-semibold text-gray-500 mb-2">Build phases · {plan.subsystems.length}</h4>
          <ol className="space-y-2">
            {plan.subsystems.map((phase, index) => (
              <li key={`${phase.name}-${index}`} className="flex gap-3 text-xs">
                <span className="w-5 h-5 shrink-0 flex items-center justify-center border border-gray-700 text-gray-400 rounded-full text-[10px]">{index + 1}</span>
                <div><p className="text-gray-200 font-medium">{phase.name}</p><p className="text-gray-500 mt-0.5">{phase.purpose}</p>
                  {phase.dependencies.length > 0 && <p className="text-gray-600 mt-1">Depends on: {phase.dependencies.join(', ')}</p>}
                  {phase.deliverables.length > 0 && <p className="text-gray-500 mt-1">Deliverables: {phase.deliverables.join('; ')}</p>}
                  {phase.acceptance.length > 0 && <p className="text-gray-400 mt-1">Acceptance: {phase.acceptance.join('; ')}</p>}
                </div>
              </li>
            ))}
          </ol>
        </div>
        {plan.billOfMaterials.length > 0 && <div>
          <h4 className="text-[11px] uppercase font-semibold text-gray-500 mb-1">Initial bill of materials</h4>
          <div className="divide-y divide-gray-800/70">{plan.billOfMaterials.map((part, index) => <div key={`${part.item}-${index}`} className="py-1.5 text-[11px] text-gray-400"><span className="text-gray-200">{part.quantity} × {part.item}</span>{part.specification && ` · ${part.specification}`}<span className="block text-gray-600">{part.rationale}</span></div>)}</div>
        </div>}
        {plan.calculations.length > 0 && <div>
          <h4 className="text-[11px] uppercase font-semibold text-gray-500 mb-1">Engineering estimates</h4>
          {plan.calculations.map((item, index) => <p key={`${item.name}-${index}`} className="py-1 text-[11px] text-gray-400"><span className="text-gray-200">{item.name}:</span> <code className="text-gray-300 font-mono">{item.equation}</code> {item.values} = {item.result}{item.caveat && <span className="block text-gray-600">{item.caveat}</span>}</p>)}
        </div>}
        {plan.risks.length > 0 && <p className="text-[11px] text-gray-400"><Wrench size={12} className="inline mr-1" />{plan.risks.join(' · ')}</p>}
        {plan.assumptions.length > 0 && <p className="text-[11px] text-gray-500">Assumptions: {plan.assumptions.join(' · ')}</p>}
        {plan.verification.length > 0 && <p className="text-[11px] text-gray-400">Project verification: {plan.verification.join(' · ')}</p>}
        <div className="border-t border-gray-800 pt-3">
          <label htmlFor="project-start-phase" className="block text-[11px] uppercase font-semibold text-gray-500 mb-1.5">Choose the first subsystem</label>
          <select
            id="project-start-phase"
            value={selectedStartIndex}
            onChange={event => setStartPhaseIndex(Number(event.target.value))}
            disabled={approved || !canApprove}
            className="w-full max-w-md bg-[#111] border border-gray-700 rounded-md px-3 py-2 text-xs text-gray-200 disabled:opacity-60"
          >
            {availableStartIndices.map(index => <option key={index} value={index}>{index + 1}. {plan.subsystems[index].name}{index === 0 ? ' · recommended' : ''}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="project-start-approach" className="block text-[11px] uppercase font-semibold text-gray-500 mb-1.5">Choose a starting approach</label>
          <select
            id="project-start-approach"
            value={startApproach}
            onChange={event => setStartApproach(event.target.value as typeof startApproach)}
            disabled={approved || !canApprove}
            className="w-full max-w-md bg-[#111] border border-gray-700 rounded-md px-3 py-2 text-xs text-gray-200 disabled:opacity-60"
          >
            <option value="canvas-first">Canvas-first: show the real components and interfaces early</option>
            <option value="recommended">Recommended: follow the dependency order</option>
            <option value="hardware-first">Hardware-first: prioritize a safe buildable assembly</option>
          </select>
        </div>
        {sources.length > 0 && <div className="border-t border-gray-800 pt-3">
          <h4 className="text-[11px] uppercase font-semibold text-gray-500 mb-2">Research sources</h4>
          <div className="space-y-1">{sources.map(source => <a key={source.uri} href={source.uri} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 text-[11px] text-blue-400 hover:text-blue-300"><ExternalLink size={11} />{source.title}</a>)}</div>
        </div>}
        {sources.length === 0 && <p className="text-[11px] text-gray-400">No attributable research sources were returned. Verify part-specific ratings against manufacturer datasheets before powering hardware.</p>}
        <button onClick={() => onApprove(startApproach, selectedStartIndex)} disabled={approved || !canApprove} title={!canApprove ? 'Add an API key and select a model to build phases' : undefined} className="inline-flex items-center gap-2 px-3 py-2 bg-gray-700 hover:bg-gray-600 disabled:bg-gray-800 disabled:text-gray-500 text-white text-xs font-semibold rounded-md">
          {approved ? <><CheckCircle2 size={14} /> Plan approved</> : canApprove ? <><Play size={13} /> Approve and start</> : <>Add API key to build phases</>}
        </button>
      </div>
    </section>
  );
}

function findEligiblePhaseIndices(plan: ProjectPlan, completedIndices: number[]): number[] {
  const completed = new Set(completedIndices);
  const completedNames = new Set(completedIndices.map(index => plan.subsystems[index]?.name.toLowerCase()).filter(Boolean));
  return plan.subsystems.map((phase, index) => !completed.has(index) && phase.dependencies.every(dependency => {
    const dependencyIndex = plan.subsystems.findIndex(item => item.name.toLowerCase() === dependency.toLowerCase());
    return dependencyIndex < 0 || completedNames.has(dependency.toLowerCase());
  }) ? index : -1).filter(index => index >= 0);
}

function getPlannedModuleChoices(plan: ProjectPlan, completedIndices: number[]): NextModuleChoice[] {
  const eligibleIndices = findEligiblePhaseIndices(plan, completedIndices);
  const choices = eligibleIndices.map((phaseIndex, optionIndex) => {
    const phase = plan.subsystems[phaseIndex];
    return {
      id: `phase-${phaseIndex}`,
      label: phase.name,
      description: phase.purpose,
      phaseIndex,
      recommended: optionIndex === 0,
    };
  });
  return choices.length ? [...choices, {
    id: 'custom',
    label: 'Another module',
    description: 'Choose this to name a different module yourself.',
  }] : [];
}

function getSuggestedModuleChoices(
  tutorialData: ParsedTutorial,
  circuitData: any,
  allTabs: ChatBoxProps['allTabs'],
): NextModuleChoice[] {
  const steps = Array.isArray(circuitData?.steps) ? circuitData.steps : [];
  const components = [
    ...steps.flatMap((step: any) => Array.isArray(step.add_components) ? step.add_components : []),
    ...(allTabs || []).flatMap(tab => tab.components),
  ];
  const moduleText = [
    ...(tutorialData.phases || []),
    ...steps.map((step: any) => `${step.phase || ''} ${step.instruction || ''}`),
    ...(allTabs || []).flatMap(tab => [tab.name, ...(tab.stepOutline || [])]),
  ].join(' ').toLowerCase();
  const projectText = `${tutorialData.projectName || ''} ${tutorialData.description || ''} ${components.map((component: any) => `${component.type || ''} ${component.label || ''}`).join(' ')}`.toLowerCase().replace(/[_-]+/g, ' ');
  const projectName = circuitData?.project_name || tutorialData.projectName || 'the current project';
  const choices: NextModuleChoice[] = [];
  const hasFirmware = tutorialData.codeSteps > 0
    || steps.some((step: any) => typeof step.code === 'string' && step.code.trim())
    || (allTabs || []).some(tab => /firmware|control\s+code|sketch/i.test(`${tab.name} ${(tab.stepOutline || []).join(' ')}`));
  const hasController = /\b(?:arduino|esp32|esp8266|raspberry\s*pi|pico|microcontroller|mcu|stm32)\b/.test(projectText);

  if (hasController && !hasFirmware && !/firmware|control\s+code/.test(moduleText)) {
    choices.push({
      id: 'suggest-firmware',
      label: 'Firmware and control',
      description: 'Add editable controller code that matches the circuit and pin assignments.',
      prompt: `Create a new module tab named Firmware and Control for the existing project ${projectName}. Add complete editable firmware matched to the existing components and pin assignments, plus the necessary compile and functional checks. Preserve the existing modules.`,
      recommended: true,
    });
  }

  if (!/test|testing|verification|validation|acceptance/.test(moduleText)) {
    choices.push({
      id: 'suggest-testing',
      label: 'Testing and verification',
      description: 'Add measurable checks for the completed circuit and its behavior.',
      prompt: `Create a new module tab named Testing and Verification for the existing project ${projectName}. Add safe, ordered, measurable checks for the current design and state the expected result for each. Preserve the existing modules.`,
      recommended: choices.length === 0,
    });
  }

  if (/\b(?:robot|robotic|wrist|arm|motor|servo|actuator|mechanism|drone|chassis)\b/.test(projectText)
    && !/mechanical|fabrication|enclosure/.test(moduleText)) {
    choices.push({
      id: 'suggest-mechanical',
      label: 'Mechanical assembly',
      description: 'Add the physical structure and interfaces needed to mount and move the hardware.',
      prompt: `Create a new module tab named Mechanical Assembly for the existing project ${projectName}. Define the physical structure, part interfaces, and required dimensions as assumptions where they are unknown. Preserve existing modules.`,
      recommended: choices.length === 0,
    });
  }

  if (!choices.length) {
    choices.push({
      id: 'suggest-integration',
      label: 'Integration and acceptance',
      description: 'Add a final module that checks the complete project against its intended behavior.',
      prompt: `Create a new module tab named Integration and Acceptance for the existing project ${projectName}. Add an ordered integration checklist and measurable acceptance checks. Preserve existing modules.`,
      recommended: true,
    });
  }

  return [...choices, {
    id: 'custom',
    label: 'Another module',
    description: 'Choose this to name a different module yourself.',
  }];
}

function NextModuleCard({
  moduleName,
  options,
  disabled,
  onSubmit,
}: {
  moduleName: string;
  options: NextModuleChoice[];
  disabled: boolean;
  onSubmit: (choice: NextModuleChoice, customName: string) => void;
}) {
  const [selectedId, setSelectedId] = useState(options[0]?.id || '');
  const [customName, setCustomName] = useState('');
  const selected = options.find(option => option.id === selectedId);
  const needsCustomName = selected?.id === 'custom';

  return (
    <section className="-mx-2 -mt-2 mb-2 w-auto overflow-hidden rounded-t-3xl border-b border-neutral-800 bg-[#0b0b0b]" aria-label="Choose the next module">
      <header className="border-b border-neutral-800 bg-[#101010] px-3 py-2.5">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-neutral-400">Module handoff</p>
        <h3 className="mt-1 text-xs font-semibold text-neutral-100">Final step reached: {moduleName}</h3>
        <p className="mt-1 text-[10px] leading-relaxed text-neutral-500">Select what to build next, then submit to continue in the workspace.</p>
      </header>
      <div className="space-y-1.5 p-2.5" role="radiogroup" aria-label="Next module options">
        {options.map((option, index) => (
          <label
            key={option.id}
            className={`flex cursor-pointer items-start gap-2.5 rounded-lg border px-2.5 py-2 transition-colors ${selectedId === option.id ? 'border-neutral-500 bg-white/[0.07]' : 'border-neutral-800 bg-white/[0.025] hover:border-neutral-700 hover:bg-white/[0.05]'}`}
          >
            <input
              type="radio"
              name={`next-module-choice-${moduleName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}
              value={option.id}
              checked={selectedId === option.id}
              onChange={() => setSelectedId(option.id)}
              className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-white"
            />
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2 text-[11px] font-medium text-neutral-200">
                {option.label}
                {option.recommended && index === 0 && <span className="rounded border border-neutral-700 px-1 py-0.5 text-[8px] uppercase tracking-wide text-neutral-400">Recommended</span>}
              </span>
              <span className="mt-0.5 block text-[10px] leading-relaxed text-neutral-500">{option.description}</span>
            </span>
          </label>
        ))}
        {needsCustomName && (
          <input
            value={customName}
            onChange={event => setCustomName(event.target.value)}
            placeholder="Name the next module"
            aria-label="Name the next module"
            className="w-full rounded-md border border-neutral-700 bg-[#111] px-2.5 py-2 text-[11px] text-neutral-200 outline-none placeholder:text-neutral-600 focus:border-neutral-500"
          />
        )}
      </div>
      <footer className="flex items-center justify-end border-t border-neutral-800 px-2.5 py-2">
        <button
          type="button"
          onClick={() => selected && onSubmit(selected, customName.trim())}
          disabled={disabled || !selected || (needsCustomName && !customName.trim())}
          className="inline-flex items-center gap-2 rounded-md border border-neutral-600 bg-neutral-200 px-3 py-1.5 text-[10px] font-semibold text-neutral-950 transition-colors hover:bg-white disabled:cursor-not-allowed disabled:border-neutral-800 disabled:bg-neutral-800 disabled:text-neutral-500"
        >
          Submit <Send size={11} />
        </button>
      </footer>
    </section>
  );
}

function artifactBaseName(content: string): string {
  const heading = content.match(/^\s*#\s+(.+)$/m)?.[1] || content.split('\n').find(line => line.trim()) || 'hardware-studio-response';
  return heading.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 64) || 'hardware-studio-response';
}

function messageArtifactText(message: Message): string {
  if (!message.implementationPlan) return message.cleanText || message.content;
  const plan = message.implementationPlan;
  return [
    `# ${plan.title}`,
    plan.summary,
    '## Assumptions', ...plan.assumptions.map(item => `- ${item}`),
    '## Subsystems', ...plan.subsystems.map((phase, index) => [
      `### ${index + 1}. ${phase.name}`,
      phase.purpose,
      phase.dependencies.length ? `Dependencies: ${phase.dependencies.join(', ')}` : '',
      ...phase.deliverables.map(item => `- Deliverable: ${item}`),
      ...phase.acceptance.map(item => `- Acceptance: ${item}`),
    ].filter(Boolean).join('\n')),
    '## Bill Of Materials', ...plan.billOfMaterials.map(item => `- ${item.quantity} ${item.item}: ${item.specification}. ${item.rationale}`),
    '## Calculations', ...plan.calculations.map(item => `- ${item.name}: ${item.equation}; ${item.values} = ${item.result}${item.caveat ? ` (${item.caveat})` : ''}`),
    '## Risks', ...plan.risks.map(item => `- ${item}`),
    '## Verification', ...plan.verification.map(item => `- ${item}`),
  ].filter(Boolean).join('\n\n');
}

function downloadArtifact(content: string, filename: string, mimeType: string) {
  const url = URL.createObjectURL(new Blob([content], { type: mimeType }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function printResponseAsPdf(content: string, title: string) {
  const printWindow = window.open('', '_blank', 'width=900,height=700');
  if (!printWindow) {
    window.alert('Allow pop-ups for this app to print or save the response as a PDF.');
    return;
  }
  const escaped = content.replace(/[&<>]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[character] || character);
  const escapedTitle = title.replace(/[&<>]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[character] || character);
  printWindow.document.open();
  printWindow.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${escapedTitle}</title><style>@page{margin:18mm}body{font:11pt/1.55 Arial,sans-serif;color:#181818}h1{font-size:20pt}pre{font:inherit;white-space:pre-wrap;overflow-wrap:anywhere}header{border-bottom:1px solid #bbb;margin-bottom:20px;padding-bottom:10px}small{color:#555}</style></head><body><header><h1>${escapedTitle}</h1><small>Hardware Studio</small></header><pre>${escaped}</pre></body></html>`);
  printWindow.document.close();
  printWindow.focus();
  window.setTimeout(() => printWindow.print(), 250);
}

// --- Main Component ---
export function ChatBox({ apiKeys, model, availableModels = [], onModelChange, onExecuteCommand, onUpdateCircuit, onApplyFirmwareRepair, onStepChange, currentStep, totalSteps, circuitData, allTabs, projectMemory, activeTabId, targetWorkspaceTabId, sessionId, sessionTitle, sessions, onNewChat, onSelectSession, onUpdateSessionTitle, onDeleteSession, onOpenImplementationPlan, pendingPlanAction, onPlanActionConsumed, modelSelectorNode, onQuotaReached, isQuotaReached, onMessagesChange }: ChatBoxProps) {
  const { user } = useAuth();
  const [messages, setMessages] = useState<Message[]>([]);
  const [chatReady, setChatReady] = useState(false);
  const [promptIndex, setPromptIndex] = useState(0);
  const [historyOpen, setHistoryOpen] = useState(false);

  useEffect(() => {
    queueMicrotask(() => {
      try {
        const saved = localStorage.getItem(chatSessionKey(sessionId, user?.uid))
          || (user?.uid ? localStorage.getItem(chatSessionKey(sessionId, 'local')) : null);
        if (saved) {
          const parsed: unknown = JSON.parse(saved);
          if (Array.isArray(parsed)) {
            const validMessages = parsed.filter((message): message is Message =>
              !!message && typeof message === 'object' &&
              ((message as Message).role === 'user' || (message as Message).role === 'assistant') &&
              typeof (message as Message).content === 'string'
            ).map(message => {
              const content = (message as Message).content;
              const role = (message as Message).role;
              let clean = (message as Message).cleanText;
              if (!clean && typeof content === 'string') {
                if (role === 'user') {
                  clean = content;
                } else {
                  clean = content.replace(/<tutorial>[\s\S]*?<\/tutorial>/gi, '').replace(/<cmd[\s>][\s\S]*?<\/cmd>/gi, '').trim();
                  if (!clean) clean = 'Updated the circuit design.';
                }
              }
              return {
                ...message,
                cleanText: clean || content,
                createdAt: (message as Message).createdAt || Date.now(),
                imageAttachments: Array.isArray((message as Message).imageAttachments)
                  ? (message as Message).imageAttachments!.filter(isImageAttachment).slice(0, MAX_IMAGE_ATTACHMENTS)
                  : undefined,
              };
            });
            const recoveredMessages = recoverPersistedProjectPlans(validMessages);
            setMessages(recoveredMessages.map(message => {
              if (message.role !== 'assistant' || !message.implementationPlan) return message;
              const tabId = message.planTabId || 'implementation-plan';
              const targetTabId = message.planTargetTabId || 'main';
              onOpenImplementationPlan(message.implementationPlan, message.sources || [], tabId, targetTabId, false);
              const status = 'Implementation plan opened in its workspace tab.';
              return {
                ...message,
                content: status,
                cleanText: '',
                implementationPlan: undefined,
                planTabId: tabId,
                planTargetTabId: targetTabId,
              };
            }));
          }
        }
      } catch { /* Ignore an unreadable local chat snapshot. */ }
      setChatReady(true);
    });
  }, [onOpenImplementationPlan, sessionId, user?.uid]);

  useEffect(() => {
    if (chatReady) {
      try {
        localStorage.setItem(chatSessionKey(sessionId, user?.uid), JSON.stringify(messages));
      } catch { /* Keep the chat usable if storage is full. */ }
      onMessagesChange?.(messages);
    }
  }, [chatReady, messages, sessionId, user?.uid, onMessagesChange]);

  useEffect(() => {
    const interval = setInterval(() => {
      setPromptIndex((prev) => (prev + 1) % HARDWARE_PROMPTS.length);
    }, 2500);
    return () => clearInterval(interval);
  }, []);

  const [input, setInput] = useState('');
  const dismissedWarningRequestRef = useRef<string | null>(null);
  const isDismissedPrompt = Boolean(dismissedWarningRequestRef.current && dismissedWarningRequestRef.current === input.trim());
  const modelRecommendation = !isDismissedPrompt && /flash-lite/i.test(model) && isLargeHardwareTask(input)
    ? recommendFullFlashModel(model, availableModels)
    : undefined;
  const [pendingModelWarning, setPendingModelWarning] = useState<{
    request: string;
    recommendation: { name: string; displayName?: string };
    workflowOverride?: WorkflowOverride;
  } | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingActivity, setProcessingActivity] = useState('Preparing your request and active workspace...');
  const [processingActivities, setProcessingActivities] = useState<WorkAction[]>([]);
  const [processingStartedAt, setProcessingStartedAt] = useState<number>();
  const [pendingImages, setPendingImages] = useState<ImageAttachment[]>([]);
  const [isPreparingImages, setIsPreparingImages] = useState(false);
  const [imageError, setImageError] = useState('');
  const imageInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const handledPlanActionRef = useRef<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const submittingRef = useRef(false);
  const isMountedRef = useRef(true);
  const [visibleCount, setVisibleCount] = useState(30);
  const reachedFinalStep = Boolean((totalSteps || 0) > 0 && (currentStep || 0) >= (totalSteps || 0) - 1);
  const activeWorkspaceTabName = allTabs?.find(tab => tab.isActive)?.name;

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    submittingRef.current = false;
  }, [model]);

  useEffect(() => {
    submittingRef.current = false;
    setPendingModelWarning(null);
    dismissedWarningRequestRef.current = null;
  }, [sessionId]);

  const totalMessages = messages.length;
  const startIndex = Math.max(0, totalMessages - visibleCount);
  const visibleMessages = messages.slice(startIndex);
  const hasMoreMessages = startIndex > 0;

  const handleLoadMoreMessages = useCallback(() => {
    setVisibleCount(prev => Math.min(prev + 30, totalMessages));
  }, [totalMessages]);

  const startNewChat = () => {
    if (isProcessing) return;
    onNewChat();
  };

  const handleImageSelection = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.currentTarget.files || []);
    event.currentTarget.value = '';
    if (!files.length) return;
    setImageError('');
    setIsPreparingImages(true);
    try {
      const existingBytes = pendingImages.reduce((total, image) => total + image.byteSize, 0);
      const additions = await prepareImageAttachments(files, existingBytes, pendingImages.length);
      setPendingImages(current => [...current, ...additions]);
    } catch (error) {
      setImageError(error instanceof Error ? error.message : 'Could not prepare this image.');
    } finally {
      setIsPreparingImages(false);
    }
  };

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isProcessing]);

  useEffect(() => {
    if (reachedFinalStep) messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [reachedFinalStep]);

  const cancelGeneration = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
  };

  const handleSend = async (overrideInput?: string, workflowOverride?: WorkflowOverride, allowLiteTask = false, modelOverride?: string) => {
    if (isQuotaReached) {
      onQuotaReached?.();
      return;
    }
    if (submittingRef.current || isProcessing || isPreparingImages) return;
    const textToSend = overrideInput || input;
    const attachedImages = pendingImages;
    const userMsg = textToSend.trim() || (attachedImages.length
      ? 'Analyze the attached image. Describe what is visible, read any legible text, identify relevant objects or components, and note uncertainty.'
      : '');
    const requestModel = modelOverride || model;
    const workflowPhase = workflowOverride?.plan.subsystems[workflowOverride.phaseIndex];
    if (!userMsg || !apiKeys || apiKeys.length === 0 || !requestModel) {
      submittingRef.current = false;
      if (!apiKeys || apiKeys.length === 0) alert('Please add at least one API Key in the Admin Panel.');
      return;
    }

    const isExplicitlyAllowedOrDismissed = allowLiteTask || dismissedWarningRequestRef.current === userMsg;
    if (!isExplicitlyAllowedOrDismissed && /flash-lite/i.test(requestModel) && isLargeHardwareTask(userMsg)) {
      const recommendation = recommendFullFlashModel(requestModel, availableModels);
      if (recommendation) {
        submittingRef.current = false;
        setPendingModelWarning({ request: userMsg, recommendation, workflowOverride });
        return;
      }
    }
    
    submittingRef.current = true;
    dismissedWarningRequestRef.current = null;
    setPendingModelWarning(null);
    
    onUpdateSessionTitle(sessionTitle === 'New chat' ? normalizeSessionTitle(userMsg) : undefined);
    if (workflowOverride) {
      setMessages(prev => prev.map(message => message.implementationPlan ? { ...message, planApproved: true } : message));
    }
    setMessages(prev => [...prev, {
      role: 'user', content: userMsg, cleanText: userMsg, createdAt: Date.now(),
      imageAttachments: attachedImages.length ? attachedImages : undefined,
    }]);
    setInput('');
    setPendingImages([]);
    setImageError('');
    const startTime = Date.now();
    try {
      sessionStorage.setItem(`kaktus_active_task_${sessionId}`, JSON.stringify({ userMsg, startedAt: startTime }));
    } catch { /* ignore */ }
    const progressLog: WorkAction[] = [];
    const executedCommands: string[] = [];
    const executedCommandResults: TerminalCommandResult[] = [];
    const recordProgress = (text: string, type = 'progress') => {
      progressLog.push({ type, text });
      setProcessingActivities([...progressLog]);
      setProcessingActivity(text);
    };
    setProcessingActivities([]);
    setProcessingActivity('Preparing your request and active workspace...');
    setProcessingStartedAt(startTime);
    setIsProcessing(true);
    abortControllerRef.current = new AbortController();

    try {
      // Build context arrays for system prompt
      const currentComponents = circuitData?.steps?.slice(0, (currentStep || 0) + 1)
        .flatMap((s: any) => s.add_components || []) || [];
      const currentWires = circuitData?.steps?.slice(0, (currentStep || 0) + 1)
        .flatMap((s: any) => s.add_wiring || []) || [];
      const compactedChat = compactConversationContext(messages.map(message => ({
        role: message.role,
        text: message.role === 'assistant' ? (message.cleanText || message.content) : message.content,
      })));

      const systemPrompt = buildHardwareStudioSystemPrompt({
        surface: 'circuit',
        userRequest: userMsg,
        projectName: circuitData?.project_name,
        currentStep,
        totalSteps: circuitData?.steps?.length || 0,
        components: currentComponents,
        wires: currentWires,
        allTabs,
        currentState: projectMemory || compactedChat.earlierContext ? {
          ...(projectMemory ? { perChatProjectMemory: projectMemory } : {}),
          ...(compactedChat.earlierContext ? { earlierConversationContext: compactedChat.earlierContext } : {}),
        } : undefined,
        workflow: workflowOverride ? { stage: 'implementation', plan: workflowOverride.plan, phaseIndex: workflowOverride.phaseIndex, completedPhaseIndices: workflowOverride.completedPhaseIndices, startApproach: workflowOverride.startApproach } : undefined,
      });

      const history: AgentMessage[] = compactedChat.recentMessages.map(m => ({
        role: m.role === 'user' ? 'user' : 'model',
        parts: [{ text: m.text }]
      }));
      while (history[0]?.role === 'model') history.shift();
      const previousImageMessage = [...messages].reverse().find(message => message.imageAttachments?.some(isImageAttachment));
      const imagesForRequest = attachedImages.length
        ? attachedImages
        : messageReferencesPriorImage(userMsg)
          ? previousImageMessage?.imageAttachments?.filter(isImageAttachment) || []
          : [];
      const maxOutputTokens = getAgentOutputTokenBudget(userMsg, workflowOverride, imagesForRequest.length > 0);
      const useGroundedResearch = shouldUseGroundedResearch(userMsg, workflowOverride);
      const contents = history;
      contents.push({ role: 'user', parts: [{ text: userMsg }, ...imagesForRequest.map(toGeminiImagePart)] });

      recordProgress(`Prepared the active project and recent chat context${imagesForRequest.length ? ` with ${imagesForRequest.length} image${imagesForRequest.length === 1 ? '' : 's'}` : ''}.`);
      setProcessingActivity('Sent the request to the selected model; waiting for its response...');

      if (imagesForRequest.length) {
        const requestSize = () => new TextEncoder().encode(JSON.stringify({
          apiKey: apiKeys[0], model: requestModel, systemPrompt, contents, temperature: 0.2, maxOutputTokens, research: useGroundedResearch,
        })).byteLength;
        while (requestSize() > 1_400_000 && contents.length > 1) {
          const removeCount = contents.length > 2 && contents[0].role === 'user' && contents[1].role === 'model' ? 2 : 1;
          contents.splice(0, removeCount);
        }
        if (requestSize() > 1_400_000) {
          throw new Error('The image and current request are too large to send together. Try fewer or smaller images.');
        }
      }

      let agentReply = await requestAgent({
        apiKeys,
        model: requestModel,
        systemPrompt,
        contents,
        temperature: 0.2,
        maxOutputTokens,
        research: useGroundedResearch,
        abortSignal: abortControllerRef.current.signal,
      });
      recordProgress('Received a response from the selected model.');
      setProcessingActivity('Reviewing the response and its structured project output...');
      if (agentReply.sources.length > 0) {
        recordProgress(`Reviewed ${agentReply.sources.length} source link${agentReply.sources.length === 1 ? '' : 's'} returned with the response.`, 'explore');
      }
      let replyText = agentReply.text;
      let tutorialResponse = extractTutorialResponse(replyText);
      let extractedPlanResponse = extractProjectPlanResponse(replyText);
      const isCanvasBuildRequest = Boolean(workflowOverride) || isCanvasMutationRequest(userMsg);

      if (isCanvasBuildRequest && !tutorialResponse.plan && (workflowOverride || !extractedPlanResponse.plan)) {
        try {
          recordProgress('Checking the answer against the canvas format.', 'explore');
          setProcessingActivity('Preparing a canvas-format repair...');
          const repairReply = await requestAgent({
            apiKeys,
            model: requestModel,
            systemPrompt: `You are a circuit design assistant. Your ONLY job right now is to convert the previous text-only answer into a valid <tutorial> JSON payload. Output ONLY the <tutorial> tag with JSON inside. No extra prose.

EXACT FORMAT REQUIRED:
<tutorial>
{
  "action": "NEW_PROJECT",
  "project_name": "Project Name",
  "description": "Brief description",
  "steps": [
    {
      "phase": "Assembly",
      "instruction": "Place the Arduino Uno on the workspace",
      "detail": "The Arduino Uno is the main microcontroller...",
      "verify": "Confirm the Arduino is placed correctly",
      "add_components": [{"id": "uno1", "type": "arduino_uno", "x": 400, "y": 300}],
      "add_wiring": []
    }
  ]
}
</tutorial>

RULES:
- Every step needs instruction, detail, verify, add_components, add_wiring
- Preserve the original user request and every applicable deliverable from the previous answer, including a complete firmware sketch in the corresponding step's code and code_language fields. Never drop code merely to repair the JSON format. When a requested test needs controller code, include the complete diagnostic sketch in that test step.
- Do not invent a separate test phase unless the user requested testing or safe commissioning requires it. Keep objective step verification in verify.
- CRITICAL LAYOUT RULE: Components are very large. Place them in a wide-open grid, spaced AT LEAST 600-800px apart (x/y coordinates 100-2000). NEVER overlap components or cram them together. Do not try to fit them into a small area.
- Wires need from, to, color (format: "componentId:pinName")
- Use real component types: arduino_uno, led, resistor, capacitor, buzzer, servo, etc.
- Wire colors: red=power, black=ground, green=signal, orange=PWM
- Output NOTHING except the <tutorial> tag with JSON inside`,
            contents: [
              ...contents,
              { role: 'model', parts: [{ text: replyText.slice(0, 24000) }] },
              { role: 'user', parts: [{ text: `Convert your previous answer into a <tutorial> JSON payload for the canvas. Original user request: ${userMsg}. Preserve its firmware and testing deliverables, including complete editable code fields when needed. Include ALL components with coordinates and ALL wiring. Previous issues: ${tutorialResponse.errors.join(' ')}` }] },
            ] as any,
            temperature: 0.1,
            maxOutputTokens: Math.min(maxOutputTokens, 16_384),
            research: false,
            abortSignal: abortControllerRef.current.signal,
          });
          const repairedTutorial = extractTutorialResponse(repairReply.text);
          if (repairedTutorial.plan) {
            const originalSources = agentReply.sources;
            agentReply = {
              ...repairReply,
              sources: originalSources.length ? originalSources : repairReply.sources,
              researched: agentReply.researched || repairReply.researched,
            };
            replyText = repairReply.text;
            tutorialResponse = repairedTutorial;
            extractedPlanResponse = extractProjectPlanResponse(replyText);
            recordProgress('Canvas-format response validated; ready to update the workspace.', 'explore');
          }
        } catch (repairError) {
          console.warn('Canvas output repair failed:', repairError);
        }
      }

      let moduleCompletionMessage: string | undefined;
      const phaseDeliverableText = workflowPhase
        ? [workflowPhase.name, ...workflowPhase.deliverables, ...workflowPhase.acceptance].join(' ')
        : '';
      const phaseRequiresFirmwareCode = Boolean(workflowPhase && /\b(?:firmware|embedded software|controller code|control code|diagnostic sketch|test firmware|programming code)\b/i.test(phaseDeliverableText));
      const phaseHasFirmwareCode = Boolean(tutorialResponse.plan?.steps.some(step => typeof step.code === 'string' && step.code.trim()));
      const moduleNeedsCompletion = Boolean(workflowPhase && tutorialResponse.plan && (
        (workflowPhase.deliverables.length > 1 && tutorialResponse.plan.steps.length < 2)
        || (phaseRequiresFirmwareCode && !phaseHasFirmwareCode)
      ));
      if (workflowPhase && tutorialResponse.plan && moduleNeedsCompletion) {
        const originalSources = agentReply.sources;
        const originalResearch = agentReply.researched;
        setProcessingActivity(`Completing all deliverables for ${workflowPhase.name} in its module...`);
        recordProgress(`The first draft only covered one step; asking the model to finish the full ${workflowPhase.name} module before applying it.`, 'explore');
        try {
          const completionReply = await requestAgent({
            apiKeys,
            model: requestModel,
            systemPrompt,
            contents: [
              ...contents,
              { role: 'model', parts: [{ text: replyText.slice(0, 24000) }] },
              { role: 'user', parts: [{ text: `The preceding draft is incomplete for the approved ${workflowPhase.name} module (${tutorialResponse.plan.steps.length} steps; ${workflowPhase.deliverables.length} planned deliverables). Finish every applicable deliverable in this same tab. Do not return a teaser, component-selection-only step, or ask the user to continue for missing work. Create useful checkpoints and represent components, mechanical artifacts, wiring, interfaces, and verification in the tutorial JSON. ${phaseRequiresFirmwareCode && !phaseHasFirmwareCode ? 'This phase explicitly requires firmware/code but the draft has no code field. Add a dedicated firmware step with the complete editable source in code and code_language, matching the approved board, pins, wiring, and behavior. Do not replace it with prose or pseudocode.' : ''} Cover every deliverable and acceptance item while preserving completed modules and interfaces. Return the full replacement module as one valid <tutorial> JSON payload.` }] },
            ] as AgentMessage[],
            temperature: 0.15,
            maxOutputTokens: Math.min(maxOutputTokens, 16_384),
            research: false,
            abortSignal: abortControllerRef.current.signal,
          });
          const completedTutorial = extractTutorialResponse(completionReply.text);
          const completedHasRequiredCode = !phaseRequiresFirmwareCode
            || Boolean(completedTutorial.plan?.steps.some(step => typeof step.code === 'string' && step.code.trim()));
          if (completedTutorial.plan && completedTutorial.plan.steps.length >= 2 && completedHasRequiredCode) {
            agentReply = {
              ...completionReply,
              sources: originalSources.length ? originalSources : completionReply.sources,
              researched: originalResearch || completionReply.researched,
            };
            replyText = completionReply.text;
            tutorialResponse = completedTutorial;
            extractedPlanResponse = extractProjectPlanResponse(replyText);
            recordProgress(`Completed the ${workflowPhase.name} module draft with ${completedTutorial.plan.steps.length} build checkpoints.`, 'explore');
          } else {
            moduleCompletionMessage = `I held ${workflowPhase.name} because its draft still did not cover the full module. The canvas was left unchanged; retry with a stronger available model or ask to complete this module again.`;
          }
        } catch (completionError) {
          console.warn('Module completion repair failed:', completionError);
          moduleCompletionMessage = `I held ${workflowPhase.name} because the model could not complete all of its planned deliverables. The canvas was left unchanged; retry this module when the model is available.`;
        }
      }

      const proposedPlan = workflowOverride ? null : extractedPlanResponse.plan;
      if (proposedPlan) {
        setProcessingActivity('Opening the implementation plan in its workspace tab...');
        onOpenImplementationPlan(proposedPlan, agentReply.sources, 'implementation-plan', targetWorkspaceTabId);
        recordProgress('Opened the implementation plan in its workspace tab.', 'edit');
      }

      // 1. Parse Work Log
      const workActions: WorkAction[] = [];
      const workRegex = /<work>([\s\S]*?)<\/work>/;
      const workMatch = workRegex.exec(replyText);
      if (workMatch) {
        const actionsRaw = workMatch[1];
        const actionRegex = /<action\s+type="([^"]+)"(?:\s+file="([^"]+)")?(?:\s+added="([^"]+)")?(?:\s+removed="([^"]+)")?>([\s\S]*?)<\/action>/g;
        let actMatch;
      while ((actMatch = actionRegex.exec(actionsRaw)) !== null) {
          workActions.push({
            type: actMatch[1],
            file: actMatch[2],
            added: actMatch[3],
            removed: actMatch[4],
            text: actMatch[5].trim()
          });
        }
      }

      
      // Parse Navigation
      const navRegex = /<nav\s+step="(\d+)"\s*\/?>/gi;
      let navMatch;
      while ((navMatch = navRegex.exec(replyText)) !== null) {
        const step = parseInt(navMatch[1], 10);
        if (!isNaN(step) && onStepChange) {
          // step is 1-indexed in the prompt, so subtract 1 for 0-indexed array
          onStepChange(step - 1);
        }
      }
      if (workActions.length) progressLog.push(...workActions);

      // 2. Parse Commands
      const commands = executedCommands;
      const hasHardwareScope = isCanvasBuildRequest && /\b(?:circuit|wiring|breadboard|arduino|esp32|microcontroller|servo|robot|sensor|motor|firmware|sketch)\b/i.test(userMsg);
      const canRunTerminalCommands = isExplicitTerminalTask(userMsg)
        && (!hasHardwareScope || hasExplicitTerminalToolRequest(userMsg))
        && !proposedPlan
        && !workflowOverride;
      let terminalReply = replyText;
      let terminalCommandCount = 0;
      if (canRunTerminalCommands) {
        for (let round = 0; round < 3; round += 1) {
          const roundCommands = extractTerminalCommands(terminalReply);
          if (!roundCommands.length) break;
          const availableSlots = 4 - terminalCommandCount;
          if (availableSlots <= 0) break;

          for (const cmd of roundCommands.slice(0, availableSlots)) {
            commands.push(cmd);
            terminalCommandCount += 1;
            recordProgress(`Running ${cmd.length > 72 ? `${cmd.slice(0, 69)}...` : cmd} in the local terminal...`);
            let result: TerminalCommandResult;
            try {
              result = await onExecuteCommand(cmd);
            } catch (commandError) {
              result = {
                output: commandError instanceof Error ? commandError.message : String(commandError),
                exitCode: 1,
              };
            }
            executedCommandResults.push(result);
            recordProgress(`Terminal command finished with exit code ${result.exitCode}.`);
          }

          setProcessingActivity('Reviewing terminal output and deciding whether a focused repair is needed...');
          const terminalReport = commands.map((command, index) => {
            const result = executedCommandResults[index];
            const output = result.output.slice(-3500) || '(no output)';
            return `Command ${index + 1}: ${command}\nExit code: ${result.exitCode}\nOutput:\n${output}`;
          }).join('\n\n');
          const terminalFollowup = await requestAgent({
            apiKeys,
            model: requestModel,
            systemPrompt,
            contents: [
              { role: 'user', parts: [{ text: userMsg }] },
              { role: 'model', parts: [{ text: terminalReply.slice(0, 16_000) }] },
              { role: 'user', parts: [{ text: `Local terminal results for the requested task:\n${terminalReport}\n\nInspect the output and exit codes. Do not repeat completed commands unless needed. If another focused command is required to fix or verify the app/repository, emit it in <cmd> tags. Otherwise give a concise result with accurate pass/fail status. Never claim success without a successful exit code.` }] },
            ],
            temperature: 0.15,
            maxOutputTokens: Math.min(maxOutputTokens, 2048),
            research: false,
            abortSignal: abortControllerRef.current.signal,
          });
          agentReply = { ...terminalFollowup, sources: agentReply.sources };
          replyText = terminalFollowup.text;
          terminalReply = replyText;
          tutorialResponse = extractTutorialResponse(replyText);
          extractedPlanResponse = extractProjectPlanResponse(replyText);

          const terminalUnavailable = executedCommandResults.some(result => /local terminal (?:is disconnected|service|connection)|terminal connection closed|terminal could not open/i.test(result.output));
          if (terminalUnavailable) {
            replyText = terminalReply.replace(/<cmd(?:\s[^>]*)?>[\s\S]*?<\/cmd>/gi, '').trim();
            replyText += '\n\nI could not reach the local terminal service. Open this app at http://localhost:3000 on this computer and make sure its local server is running.';
            terminalReply = replyText;
            break;
          }

          if (round === 2 && extractTerminalCommands(terminalReply).length) {
            replyText = terminalReply.replace(/<cmd(?:\s[^>]*)?>[\s\S]*?<\/cmd>/gi, '').trim();
            replyText += '\n\nI stopped the automatic terminal loop after three run-and-review rounds. The latest command output is shown above; any remaining work still needs review.';
            terminalReply = replyText;
          }
        }
      }
      const commandResults = executedCommandResults.length ? [...executedCommandResults] : undefined;
      const timeMs = Date.now() - startTime;

      // 3. Commit the circuit first; firmware verification can take longer than the response.
      let tutorialData: ParsedTutorial | undefined;
      let firmwareBuilds: FirmwareBuildReport[] | undefined;
      let pinAllocationMessage: string | undefined;
      let deferredFirmwareValidation: {
        plan: AgentPlan;
        componentTypes: string[];
        targetTabId?: string;
        targetTabName: string;
        originalSources: string[];
      } | undefined;
      if (!moduleCompletionMessage && tutorialResponse.plan && onUpdateCircuit && (!proposedPlan || workflowOverride)) {
        const phaseName = workflowOverride?.plan.subsystems[workflowOverride.phaseIndex]?.name;
        const parsed = workflowOverride && phaseName
          ? routePlanPhase(tutorialResponse.plan, phaseName, allTabs?.map(tab => tab.name) || [])
          : routeExplicitStepEdit(
            tutorialResponse.plan,
            userMsg,
            allTabs?.find(tab => tab.isActive)?.name || '',
            (currentStep || 0) + 1,
          );

        const activeTabName = allTabs?.find(tab => tab.isActive)?.name;
        const pinLedger = parsed.action === 'NEW_PROJECT' ? [] : allTabs || [];
        const pinConflicts = findSignalPinReuseConflicts(pinLedger, parsed.steps, parsed.target_tab || activeTabName || '');
        if (pinConflicts.length) {
          pinAllocationMessage = `I held this circuit update because it reuses a signal pin that is already assigned: ${pinConflicts.join('; ')}. The current circuit is unchanged. Ask for a free pin or an explicitly shared bus.`;
          recordProgress('Held the circuit update because a signal pin is already assigned elsewhere in this chat workspace.', 'explore');
        }

        if (!pinAllocationMessage) {
        const isNewProjectTab = parsed.action === 'NEW_PROJECT' || parsed.action === 'NEW_TAB';
        const relevantTabs = (allTabs || []).filter(tab => parsed.target_tab ? tab.name === parsed.target_tab : tab.isActive);
        const includeActiveCircuit = !isNewProjectTab && (!parsed.target_tab || parsed.target_tab === activeTabName);
        const projectComponentTypes = [
          ...parsed.steps.flatMap(step => (step.add_components || []).map(component => `${component.type || ''} ${component.label || ''}`)),
          ...(includeActiveCircuit ? componentTypesFromSteps(circuitData?.steps) : []),
          ...(!isNewProjectTab ? relevantTabs.flatMap(tab => tab.components.map(component => component.type)) : []),
        ];
        if (parsed.steps.some(step => Boolean(step.code?.trim()))) {
          deferredFirmwareValidation = {
            plan: parsed,
            componentTypes: projectComponentTypes,
            targetTabId: workflowOverride?.targetTabId || activeTabId,
            targetTabName: parsed.target_tab || activeTabName || parsed.project_name || 'Current module',
            originalSources: parsed.steps.map(step => step.code || ''),
          };
          recordProgress('The circuit is ready. Firmware compilation and any code repair will continue in the background.', 'progress');
        }
        tutorialData = {
            action: parsed.action,
            target_tab: parsed.target_tab,
            targetTabName: parsed.target_tab || activeTabName || parsed.project_name || 'Current module',
            projectName: parsed.project_name,
            description: parsed.description,
            blueprint_svg: parsed.blueprint_svg,
            stepsCount: parsed.steps.length,
            componentsCount: parsed.steps.reduce((acc, step) => acc + (step.add_components?.length || 0), 0),
            connectionsCount: parsed.steps.reduce((acc, step) => acc + (step.add_wiring?.length || 0), 0),
            codeSteps: parsed.steps.filter(s => !!s.code).length,
            codeQualityWarnings: tutorialResponse.warnings.filter(warning => warning.startsWith('Code review ')),
            phases: Array.from(new Set(parsed.steps.map(s => s.phase).filter(Boolean))) as string[],
            steps: parsed.steps.map(s => ({
              instruction: s.instruction || '',
              phase: s.phase,
              add_components: s.add_components,
              add_wiring: s.add_wiring,
              remove_components: s.remove_components,
              remove_wiring: s.remove_wiring,
              hasComponents: !!(s.add_components?.length),
              hasWiring: !!(s.add_wiring?.length),
              hasCode: !!s.code,
              hasVerify: !!s.verify
            }))
        };

        setProcessingActivity(`Updating ${parsed.target_tab || 'the active workspace'} with ${parsed.steps.length} checked steps...`);
        onUpdateCircuit(parsed, workflowOverride?.targetTabId || activeTabId);
        recordProgress(`Updated ${parsed.target_tab || 'the active workspace'} with ${parsed.steps.length} step${parsed.steps.length === 1 ? '' : 's'}.`, 'edit');
        }
      } else if (tutorialResponse.errors.length > 0 && isCanvasBuildRequest) {
        console.warn('Canvas response did not validate:', tutorialResponse.errors);
      }

      // 4. Parse Options block
      setProcessingActivity('Finishing the response and project details...');
      const optionsBlock = moduleCompletionMessage ? undefined : extractOptions(replyText) || undefined;

      // 5. Parse Next Steps block
      const nextStepsBlock = moduleCompletionMessage ? undefined : extractNextSteps(replyText) || undefined;

      // 6. Get Clean Text
      let cleanText = proposedPlan ? extractedPlanResponse.cleanText : tutorialResponse.cleanText;
      if (moduleCompletionMessage) {
        cleanText = moduleCompletionMessage;
      } else if (pinAllocationMessage) {
        cleanText = pinAllocationMessage;
      }
      if (!moduleCompletionMessage && !pinAllocationMessage && isCanvasBuildRequest && !proposedPlan && !tutorialData) {
        cleanText = cleanText.replace(/```json[\s\S]*?```/gi, '').trim();
      }
      if (proposedPlan && !agentReply.researched) {
        cleanText += '\n\nSearch returned no attributable sources for this response. Treat part-specific values as provisional until verified against the manufacturer documentation.';
      }
      const canvasWarning = !moduleCompletionMessage && !pinAllocationMessage && isCanvasBuildRequest && !proposedPlan && !tutorialData
        ? 'Canvas was not changed because the model did not return a valid component-and-step payload. The app tried one format repair; review the answer and retry when the model is available.'
        : undefined;

      // If text is just a bare JSON object, hide it
      if (cleanText.startsWith('{') && cleanText.endsWith('}') && cleanText.includes('"steps"')) {
        cleanText = "I have updated the circuit design for you.";
      }
      if (deferredFirmwareValidation) {
        cleanText = `${cleanText.trim()}\n\nThe module is ready in the canvas. Firmware compilation and any required code repair will continue in the background; the result will appear here.`.trim();
      }
      const codeStepIndex = tutorialData?.steps.findIndex(step => step.hasCode) ?? -1;
      const firmwareTestTarget = firmwareBuilds?.[0]
        ? `${firmwareBuilds[0].moduleName}, Step ${firmwareBuilds[0].stepNumber} (${firmwareBuilds[0].stepName})`
        : codeStepIndex >= 0 && tutorialData
          ? `${tutorialData.projectName || 'Current module'}, Step ${codeStepIndex + 1}${tutorialData.steps[codeStepIndex].phase ? ` (${tutorialData.steps[codeStepIndex].phase})` : ''} — ${tutorialData.steps[codeStepIndex].instruction}`
          : `${circuitData?.project_name || 'the current module'}, current firmware step`;
      cleanText = enforceInAppFirmwareGuidance(cleanText, firmwareTestTarget);

      const assistantCreatedAt = Date.now();
      setMessages(prev => [...prev, { 
        role: 'assistant',
        content: proposedPlan ? 'Implementation plan opened in its workspace tab.' : replyText,
        cleanText: proposedPlan ? '' : cleanText,
        createdAt: assistantCreatedAt,
        commands, 
        commandResults,
        tutorialData,
        workActions: progressLog,
        workTimeMs: timeMs,
        optionsBlock,
        nextStepsBlock,
        sources: proposedPlan ? undefined : agentReply.sources,
        phasePlan: workflowOverride?.plan,
        phaseIndex: workflowOverride?.phaseIndex,
        phaseCompletedIndices: workflowOverride && tutorialData
          ? Array.from(new Set([...(workflowOverride.completedPhaseIndices || []), workflowOverride.phaseIndex]))
          : undefined,
        phaseTargetTabId: workflowOverride?.targetTabId,
        phaseStartApproach: workflowOverride?.startApproach,
        canvasWarning,
        firmwareBuilds,
      }]);

      if (deferredFirmwareValidation) {
        const validationJob = deferredFirmwareValidation;
        const validationController = new AbortController();
        void validateGeneratedFirmware({
          plan: validationJob.plan,
          apiKeys,
          model: requestModel,
          signal: validationController.signal,
          componentTypes: validationJob.componentTypes,
          onProgress: () => undefined,
        }).then(({ reports }) => {
          validationJob.plan.steps.forEach((step, index) => {
            const expectedCode = validationJob.originalSources[index];
            const repairedCode = step.code || '';
            if (!expectedCode || !repairedCode || normalizeArduinoSource(expectedCode) === normalizeArduinoSource(repairedCode)) return;
            onApplyFirmwareRepair?.({
              targetTabId: validationJob.targetTabId,
              targetTabName: validationJob.targetTabName,
              stepInstruction: step.instruction || '',
              phase: step.phase,
              expectedCode,
              repairedCode,
            });
          });

          const summary = reports.length
            ? reports.map(report => report.status === 'verified' ? 'compile passed' : report.status === 'compile_failed' ? 'compile failed' : 'build unverified').join('; ')
            : 'no Arduino sketch required compilation';
          setMessages(previous => previous.map(message => message.role === 'assistant' && message.createdAt === assistantCreatedAt
            ? {
              ...message,
              firmwareBuilds: reports.length ? reports : undefined,
              workActions: [...(message.workActions || []), { type: 'progress', text: `Background firmware check finished: ${summary}.` }],
            }
            : message));
        }).catch(error => {
          console.warn('Background firmware validation failed:', error);
          const reports: FirmwareBuildReport[] = validationJob.plan.steps.flatMap((step, index) => step.code?.trim() ? [{
            status: 'unverified' as const,
            stepName: step.phase || 'Firmware',
            moduleName: validationJob.targetTabName,
            stepNumber: index + 1,
            stepInstruction: step.instruction || '',
            repairAttempts: 0,
            note: 'The sketch remains saved and editable, but the background compiler check could not finish. Use Flash to Board in Kaktus to compile it later.',
          }] : []);
          setMessages(previous => previous.map(message => message.role === 'assistant' && message.createdAt === assistantCreatedAt
            ? { ...message, firmwareBuilds: reports, workActions: [...(message.workActions || []), { type: 'progress', text: 'Background firmware check could not finish; the generated code remains in the module.' }] }
            : message));
        });
      }

    } catch (error: any) {
      if (error.name === 'AbortError') {
        progressLog.push({ type: 'progress', text: 'User cancelled agent execution.' });
        setMessages(prev => [...prev, {
          role: 'assistant', content: 'User cancelled agent execution.', cleanText: 'User cancelled agent execution.',
          createdAt: Date.now(), workActions: progressLog, workTimeMs: Date.now() - startTime,
        }]);
      } else {
        const errorMessage = error instanceof Error ? error.message : String(error);
        const errorCode = error instanceof AgentRequestError ? error.code : undefined;
        if (errorCode === 'APP_QUOTA_EXCEEDED' && onQuotaReached) {
          onQuotaReached();
        }
        progressLog.push({ type: 'progress', text: `Request ended with an error: ${errorMessage}` });
        setMessages(prev => [...prev, {
          role: 'assistant', content: `Error: ${errorMessage}`, cleanText: `Error: ${errorMessage}`, errorCode,
          createdAt: Date.now(),
          commands: executedCommands.length ? executedCommands : undefined,
          commandResults: executedCommandResults.length ? executedCommandResults : undefined,
          workActions: progressLog, workTimeMs: Date.now() - startTime,
        }]);
      }
    } finally {
      submittingRef.current = false;
      try {
        sessionStorage.removeItem(`kaktus_active_task_${sessionId}`);
      } catch { /* ignore */ }
      if (isMountedRef.current) {
        setIsProcessing(false);
      }
    }
  };

  const handleSendRef = useRef(handleSend);
  useEffect(() => {
    handleSendRef.current = handleSend;
  }, [handleSend]);

  useEffect(() => {
    if (!pendingPlanAction || isProcessing || handledPlanActionRef.current === pendingPlanAction.id) return;
    handledPlanActionRef.current = pendingPlanAction.id;
    const instruction = pendingPlanAction.completedPhaseIndices?.length
      ? `Continue the approved project. Build subsystem ${pendingPlanAction.phaseIndex + 1}: ${pendingPlanAction.plan.subsystems[pendingPlanAction.phaseIndex].name}.`
      : `APPROVE PROJECT PLAN: start with subsystem ${pendingPlanAction.phaseIndex + 1}: ${pendingPlanAction.plan.subsystems[pendingPlanAction.phaseIndex].name}`;
    void handleSendRef.current(instruction, { ...pendingPlanAction, completedPhaseIndices: pendingPlanAction.completedPhaseIndices || [] });
    onPlanActionConsumed();
  }, [pendingPlanAction, isProcessing, onPlanActionConsumed]);

  const latestTutorialMessageIndex = messages.reduce((latestIndex, message, index) => {
    if (message.role !== 'assistant' || !message.tutorialData) return latestIndex;
    const targetName = message.tutorialData.targetTabName || message.tutorialData.target_tab;
    if (targetName && activeWorkspaceTabName
      && targetName.trim().toLowerCase() !== activeWorkspaceTabName.trim().toLowerCase()) return latestIndex;
    return index;
  }, -1);
  const nextModuleMessage = reachedFinalStep && !isProcessing && !pendingModelWarning && latestTutorialMessageIndex >= 0
    ? messages[latestTutorialMessageIndex]
    : undefined;
  const nextModuleTutorial = nextModuleMessage?.tutorialData;
  const plannedNextModuleChoices = nextModuleMessage?.phasePlan
    ? getPlannedModuleChoices(nextModuleMessage.phasePlan, nextModuleMessage.phaseCompletedIndices || [])
    : [];
  const nextModuleChoices = nextModuleTutorial
    ? plannedNextModuleChoices.length
      ? plannedNextModuleChoices
      : getSuggestedModuleChoices(nextModuleTutorial, circuitData, allTabs)
    : [];
  const nextModuleName = nextModuleTutorial?.targetTabName
    || nextModuleTutorial?.target_tab
    || activeWorkspaceTabName
    || 'Current module';

  const handleNextModuleSubmit = (choice: NextModuleChoice, customName: string) => {
    if (!nextModuleMessage?.tutorialData) return;
    if (choice.phaseIndex != null && nextModuleMessage.phasePlan) {
      const completedPhaseIndices = Array.from(new Set([
        ...(nextModuleMessage.phaseCompletedIndices || []),
        choice.phaseIndex,
      ]));
      void handleSend(
        `Continue the approved project. Build subsystem ${choice.phaseIndex + 1}: ${nextModuleMessage.phasePlan.subsystems[choice.phaseIndex].name}.`,
        {
          plan: nextModuleMessage.phasePlan,
          phaseIndex: choice.phaseIndex,
          completedPhaseIndices,
          targetTabId: nextModuleMessage.phaseTargetTabId || targetWorkspaceTabId || activeTabId,
          startApproach: nextModuleMessage.phaseStartApproach,
        },
      );
      return;
    }

    const projectName = circuitData?.project_name || nextModuleMessage.tutorialData.projectName || 'this project';
    const request = choice.id === 'custom'
      ? `Create a new module tab named ${customName} for the existing project ${projectName}. Build this module only, include its complete relevant steps and checks, and preserve the existing modules.`
      : choice.prompt || `Create a new module tab named ${choice.label} for the existing project ${projectName}. Build this module only, include its complete relevant steps and checks, and preserve the existing modules.`;
    void handleSend(request);
  };

  return (
    <div className="flex flex-col h-full bg-[#111] text-gray-200 text-sm font-sans relative">
      {/* Header */}
      <div className="p-3 border-b border-gray-800 flex items-center justify-between bg-[#0a0a0a] min-w-0">
          <div className="flex min-w-0 items-center text-gray-300">
            
            <span className="font-semibold text-xs truncate" title={sessionTitle}>{sessionTitle}</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="relative">
              <button
                type="button"
                onClick={() => setHistoryOpen(open => !open)}
                disabled={isProcessing}
                title="Chat history"
                aria-label="Chat history"
                aria-expanded={historyOpen}
                className="p-1.5 text-gray-400 hover:text-white hover:bg-gray-800 disabled:opacity-40 rounded-md transition-colors"
              >
                <History size={16} />
              </button>
              <AnimatePresence>
                {historyOpen && (
                  <motion.div
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    className="absolute right-0 top-9 z-50 w-72 max-h-80 overflow-y-auto border border-gray-700 bg-[#101010] shadow-xl rounded-md p-1"
                    role="menu"
                    aria-label="Saved chats"
                  >
                    {sessions.map(session => (
                      <div key={session.id} className={`flex items-center w-full rounded pr-1 my-0.5 text-xs ${session.id === sessionId ? 'bg-gray-800 text-white' : 'text-gray-300 hover:bg-gray-800/70'}`}>
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            setHistoryOpen(false);
                            onSelectSession(session.id);
                          }}
                          className="block flex-1 text-left truncate px-3 py-2"
                          title={session.title}
                        >
                          {session.title}
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                             e.stopPropagation();
                             if (confirm('Are you sure you want to delete this chat?')) {
                               if (onDeleteSession) onDeleteSession(session.id, e);
                             }
                          }}
                          className="p-1.5 ml-1 text-gray-500 hover:text-red-400 hover:bg-gray-700/50 rounded transition-colors"
                          title="Delete chat"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
            <button
              type="button"
              onClick={startNewChat}
              disabled={isProcessing}
              title="Start a new chat"
              aria-label="Start a new chat"
              className="p-1.5 text-gray-400 hover:text-white hover:bg-gray-800 disabled:opacity-40 rounded-md transition-colors"
            >
              <Plus size={16} />
            </button>
          </div>
      </div>

      {(pendingModelWarning || modelRecommendation) && (
        <div role="status" aria-live="polite" className="mx-3 mt-2 flex shrink-0 items-start gap-2 rounded-xl border border-amber-500/25 bg-amber-500/[0.08] px-3 py-2 text-left">
          <AlertTriangle size={15} className="mt-0.5 shrink-0 text-amber-300" />
          <div className="min-w-0 flex-1">
            <p className="text-[11px] leading-relaxed text-amber-100">
              {pendingModelWarning
                ? `This task is paused before sending because it may be too large for ${modelLabel(model, availableModels)}. ${modelLabel(pendingModelWarning.recommendation.name, availableModels)} is a better fit.`
                : `This multi-step task may be too large for ${modelLabel(model, availableModels)}. ${modelLabel(modelRecommendation!.name, availableModels)} is a better fit.`}
            </p>
            {pendingModelWarning && (
              <p className="mt-1 truncate text-[10px] text-amber-200/60" title={pendingModelWarning.request}>{pendingModelWarning.request}</p>
            )}
            {pendingModelWarning ? (
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  disabled={isProcessing || isQuotaReached}
                  onClick={() => {
                    const pending = pendingModelWarning;
                    if (!pending) return;
                    submittingRef.current = false;
                    setPendingModelWarning(null);
                    dismissedWarningRequestRef.current = null;
                    onModelChange?.(pending.recommendation.name);
                    void handleSend(pending.request, pending.workflowOverride, true, pending.recommendation.name);
                  }}
                  className="rounded-lg border border-amber-300/20 bg-amber-300/15 px-2 py-1 text-[10px] font-semibold text-amber-100 transition-colors hover:bg-amber-300/25 disabled:opacity-50"
                >
                  Switch &amp; send
                </button>
                <button
                  type="button"
                  disabled={isProcessing || isQuotaReached}
                  onClick={() => {
                    const pending = pendingModelWarning;
                    if (!pending) return;
                    submittingRef.current = false;
                    setPendingModelWarning(null);
                    dismissedWarningRequestRef.current = pending.request;
                    void handleSend(pending.request, pending.workflowOverride, true, model);
                  }}
                  className="rounded-lg px-2 py-1 text-[10px] text-amber-100/70 transition-colors hover:bg-amber-300/10 hover:text-amber-100 disabled:opacity-50"
                >
                  Use {modelLabel(model, availableModels)} anyway
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const pending = pendingModelWarning;
                    if (pending) {
                      setInput(current => current.trim() ? current : pending.request);
                      dismissedWarningRequestRef.current = pending.request;
                    }
                    submittingRef.current = false;
                    setPendingModelWarning(null);
                  }}
                  title="Dismiss model warning"
                  aria-label="Dismiss model warning"
                  className="ml-auto rounded-lg p-1 text-amber-100/60 hover:bg-amber-300/10 hover:text-amber-100"
                >
                  <X size={12} />
                </button>
              </div>
            ) : onModelChange ? (
              <button
                type="button"
                onClick={() => {
                  submittingRef.current = false;
                  setPendingModelWarning(null);
                  onModelChange(modelRecommendation!.name);
                }}
                className="mt-1 rounded-lg border border-amber-300/20 bg-amber-300/10 px-2 py-1 text-[10px] font-semibold text-amber-100 transition-colors hover:bg-amber-300/20"
              >
                Switch to {modelLabel(modelRecommendation!.name, availableModels)}
              </button>
            ) : null}
          </div>
        </div>
      )}

      {/* Messages Area */}
      {messages.length > 0 ? (
        <div className="flex-1 overflow-y-auto p-4 space-y-6">
          {hasMoreMessages && (
            <div className="flex justify-center pb-2">
              <button
                type="button"
                onClick={handleLoadMoreMessages}
                className="text-xs text-blue-400 hover:text-blue-300 px-3 py-1 rounded bg-blue-950/30 border border-blue-800/40 transition-colors"
              >
                Load earlier messages ({messages.length - visibleCount} more)
              </button>
            </div>
          )}
          {visibleMessages.map((msg, index) => {
            const idx = startIndex + index;
            return (
          <div key={`${idx}-${msg.createdAt || idx}`} className={`flex flex-col group ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
            
            {msg.role === 'assistant' && msg.workActions && msg.workActions.length > 0 && (
              <WorkAccordion actions={msg.workActions} timeMs={msg.workTimeMs} />
            )}
            {msg.role === 'assistant' && msg.firmwareBuilds && msg.firmwareBuilds.length > 0 && (
              <FirmwareBuildSummary builds={msg.firmwareBuilds} />
            )}

            <div className={`max-w-[90%] ${msg.role === 'user' ? 'bg-[#2a2a2a] text-white rounded-2xl rounded-tr-sm px-4 py-2 shadow-md' : 'text-gray-300'}`}>
              {msg.imageAttachments?.map(image => (
                <figure key={image.id} className="mb-2 last:mb-0">
                  <img src={imageAttachmentDataUrl(image)} alt={image.name} title={image.name} className="max-h-56 max-w-full rounded-md border border-gray-700/70 object-contain" />
                  <figcaption className="mt-1 max-w-56 truncate text-[10px] text-gray-500">{image.name}</figcaption>
                </figure>
              ))}
              {(() => {
                const displayText = msg.cleanText || (typeof msg.content === 'string' ? msg.content.replace(/<tutorial>[\s\S]*?<\/tutorial>/gi, '').replace(/<cmd[\s>][\s\S]*?<\/cmd>/gi, '').trim() : '') || msg.content;
                if (!displayText) return null;
                return (
                  <div className={`leading-relaxed ${msg.role === 'user' ? 'whitespace-pre-wrap' : ''}`}>
                    {msg.role === 'user' ? (
                      displayText
                    ) : (
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm, remarkMath]}
                        rehypePlugins={[[rehypeKatex, { throwOnError: false, strict: 'ignore' }]]}
                        components={{

                          code: ({node, inline, className, children, ...props}: any) => {
                            const match = /language-(\w+)/.exec(className || '');
                            if (!inline && match) {
                              return (
                                <div className="relative my-4 rounded-xl overflow-hidden border border-gray-700 bg-[#0d0d0d] shadow-lg">
                                  <div className="flex items-center justify-between px-4 py-2 bg-gray-800 border-b border-gray-700">
                                    <span className="text-[10px] font-mono text-gray-400 uppercase tracking-wider">{match[1]}</span>
                                    <button 
                                      onClick={(e) => {
                                        navigator.clipboard.writeText(String(children).replace(/\n$/, ''));
                                        const btn = e.currentTarget;
                                        const oldHtml = btn.innerHTML;
                                        btn.innerHTML = '<span class="text-[10px] text-green-400">Copied!</span>';
                                        setTimeout(() => btn.innerHTML = oldHtml, 2000);
                                      }} 
                                      className="text-gray-500 hover:text-white transition-colors flex items-center gap-1"
                                      title="Copy code"
                                    >
                                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                                      <span className="text-[10px]">Copy</span>
                                    </button>
                                  </div>
                                  <pre className="p-4 overflow-x-auto text-[12px] leading-relaxed">
                                    <code className={className} {...props}>{children}</code>
                                  </pre>
                                </div>
                              );
                            }
                            return <code className="bg-gray-800 text-blue-300 px-1.5 py-0.5 rounded text-[11px] font-mono whitespace-pre-wrap" {...props}>{children}</code>;
                          },

                          p: ({node, ...props}) => <p className="mb-3 last:mb-0" {...props} />,
                          ul: ({node, ...props}) => <ul className="list-disc pl-5 mb-3 space-y-1 marker:text-blue-500" {...props} />,
                          ol: ({node, ...props}) => <ol className="list-decimal pl-5 mb-3 space-y-1 marker:text-blue-500" {...props} />,
                          li: ({node, ...props}) => <li className="text-gray-300" {...props} />,
                          strong: ({node, ...props}) => <strong className="font-semibold text-white" {...props} />,
                          a: ({node, ...props}) => <a className="text-blue-400 hover:underline" {...props} />,
                          h1: ({node, ...props}) => <h1 className="text-xl font-bold text-white mb-3 mt-4" {...props} />,
                          h2: ({node, ...props}) => <h2 className="text-lg font-bold text-white mb-2 mt-3 border-b border-gray-800 pb-1" {...props} />,
                          h3: ({node, ...props}) => <h3 className="text-base font-semibold text-white mb-2 mt-3" {...props} />,
                          table: ({node, ...props}) => <div className="overflow-x-auto mb-3"><table className="w-full text-left border-collapse border border-gray-800" {...props} /></div>,
                          th: ({node, ...props}) => <th className="border border-gray-800 bg-gray-900/50 px-3 py-2 font-semibold text-gray-200" {...props} />,
                          td: ({node, ...props}) => <td className="border border-gray-800 px-3 py-2 text-gray-300" {...props} />,
                          blockquote: ({node, ...props}) => <blockquote className="border-l-2 border-blue-500 pl-3 italic text-gray-400 my-2" {...props} />,
                          pre: ({node, ...props}) => <pre className="bg-[#0a0a0a] border border-gray-800 rounded-md p-3 overflow-x-auto mb-3" {...props} />
                        }}
                      >
                        {displayText}
                      </ReactMarkdown>
                    )}
                  </div>
                );
              })()}
            </div>

            {/* Message Tools (Time, Copy, Undo) */}
            <div className={`mt-1.5 flex items-center gap-3 text-gray-500 opacity-0 group-hover:opacity-100 transition-opacity ${msg.role === 'user' ? 'self-end mr-2' : 'self-start ml-2'}`}>
              {msg.createdAt && (
                <span className="text-[10px] select-none font-medium text-gray-600">
                  {new Date(msg.createdAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                </span>
              )}
              <div className="flex items-center gap-1.5">
                {msg.role === 'assistant' && (() => {
                  const exportText = messageArtifactText(msg);
                  const filename = artifactBaseName(exportText);
                  return <>
                    <button
                      onClick={() => downloadArtifact(exportText, `${filename}.md`, 'text/markdown;charset=utf-8')}
                      className="hover:text-gray-300 transition-colors p-1 rounded hover:bg-gray-800"
                      title="Download response as Markdown"
                      aria-label="Download response as Markdown"
                    ><FileDown size={13} /></button>
                    <button
                      onClick={() => printResponseAsPdf(exportText, filename)}
                      className="hover:text-gray-300 transition-colors p-1 rounded hover:bg-gray-800"
                      title="Print or save response as PDF"
                      aria-label="Print or save response as PDF"
                    ><Printer size={13} /></button>
                    {msg.tutorialData?.blueprint_svg && <button
                      onClick={() => downloadArtifact(msg.tutorialData!.blueprint_svg!, `${filename}-diagram.svg`, 'image/svg+xml;charset=utf-8')}
                      className="hover:text-gray-300 transition-colors p-1 rounded hover:bg-gray-800"
                      title="Download circuit diagram as SVG"
                      aria-label="Download circuit diagram as SVG"
                    ><Download size={13} /></button>}
                  </>;
                })()}
                <button 
                  onClick={() => navigator.clipboard.writeText(msg.cleanText || msg.content)}
                  className="hover:text-gray-300 transition-colors p-1 rounded hover:bg-gray-800"
                  title="Copy message"
                >
                  <Copy size={13} />
                </button>
                <button 
                  onClick={() => setMessages(prev => prev.slice(0, idx + 1))}
                  className="hover:text-gray-300 transition-colors p-1 rounded hover:bg-gray-800"
                  title="Rewind to this point"
                >
                  <Undo2 size={13} />
                </button>
              </div>
            </div>

            {msg.role === 'assistant' && msg.errorCode === 'APP_QUOTA_EXCEEDED' && (
              <div 
                onClick={() => { window.location.href = '/#pricing'; }}
                className="mt-2.5 inline-flex items-center gap-2 px-3.5 py-1.5 rounded-lg bg-red-500/20 hover:bg-red-500/30 border border-red-500/40 text-red-300 font-semibold text-xs cursor-pointer transition-all hover:scale-105 active:scale-95 shadow-sm"
              >
                <span className="w-2 h-2 rounded-full bg-red-400 animate-ping" />
                <span>Quota Exceeded • Click to Upgrade Plan (₹39 - ₹169) →</span>
              </div>
            )}

            {msg.canvasWarning && (
              <p role="status" className="mt-2 max-w-[95%] border-l-2 border-amber-500/70 pl-2 text-[11px] leading-relaxed text-amber-300/90">{msg.canvasWarning}</p>
            )}

            {!msg.implementationPlan && msg.sources && msg.sources.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 max-w-[95%]">
                {msg.sources.slice(0, 8).map(source => <a key={source.uri} href={source.uri} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[10px] text-blue-400 hover:text-blue-300"><ExternalLink size={10} />{source.title}</a>)}
              </div>
            )}

            {msg.commands && msg.commands.length > 0 && (
              <div className="mt-3 w-full max-w-[95%]">
                {msg.commands.map((cmd, i) => (
                  <div key={i} className="bg-[#0a0a0a] border border-gray-800 rounded-lg p-3 mb-2 flex flex-col gap-2 shadow-sm">
                    <div className="flex items-center gap-2 text-gray-400 text-xs font-semibold uppercase tracking-wider">
                      <Terminal size={14} className="text-gray-400" />
                      Executing Command
                    </div>
                    <code className="font-mono text-[11px] text-green-400 break-all bg-black/30 p-2 rounded">
                      {cmd}
                    </code>
                    {msg.commandResults?.[i] && (
                      <div className="rounded-md border border-gray-800 bg-black/40 p-2">
                        <div className={`mb-1 text-[10px] font-medium ${msg.commandResults[i].exitCode === 0 ? 'text-gray-400' : 'text-red-300'}`}>
                          Exit code {msg.commandResults[i].exitCode}
                        </div>
                        {msg.commandResults[i].output ? (
                          <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words font-mono text-[10px] leading-relaxed text-gray-300">{msg.commandResults[i].output}</pre>
                        ) : (
                          <span className="text-[10px] text-gray-500">Command completed without output.</span>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {msg.tutorialData && (
              <div className="mt-3 w-full max-w-[95%]">
                <div className="bg-[#0a0a0a] border border-blue-900/40 rounded-xl overflow-hidden shadow-lg">
                  <div className="bg-gray-900/50 px-3 py-2 border-b border-gray-800 flex items-center justify-between">
                    <div className="flex items-center gap-2 text-gray-200 text-xs font-bold uppercase tracking-wider">
                      <Zap size={14} className="text-gray-300" />
                      Circuit Update
                    </div>
                    {msg.tutorialData.action === 'NEW_TAB' && (
                      <span className="text-[10px] bg-gray-800 text-gray-300 px-1.5 py-0.5 rounded font-mono">NEW TAB</span>
                    )}
                    {msg.tutorialData.action === 'MERGE_TAB' && (
                      <span className="text-[10px] bg-gray-800 text-gray-300 px-1.5 py-0.5 rounded font-mono flex items-center gap-1">
                        <GitMerge size={10} /> MERGE
                      </span>
                    )}
                  </div>
                  
                  <div className="p-3">
                    <h3 className="text-gray-200 font-semibold mb-1 text-sm">{msg.tutorialData.projectName || 'Design Modification'}</h3>
                    {msg.tutorialData.description && (
                      <p className="text-gray-500 text-xs mb-2">{msg.tutorialData.description}</p>
                    )}
                    
                    <div className="grid grid-cols-3 gap-2 mt-3 mb-3">
                      <div className="bg-gray-900 rounded border border-gray-800 p-2 flex flex-col items-center justify-center text-center">
                        <span className="text-gray-400 text-[10px] uppercase font-bold tracking-wider">Components</span>
                        <span className="text-gray-200 font-mono text-lg mt-0.5">{msg.tutorialData.componentsCount}</span>
                      </div>
                      <div className="bg-gray-900 rounded border border-gray-800 p-2 flex flex-col items-center justify-center text-center">
                        <span className="text-gray-400 text-[10px] uppercase font-bold tracking-wider">Connections</span>
                        <span className="text-gray-200 font-mono text-lg mt-0.5">{msg.tutorialData.connectionsCount}</span>
                      </div>
                      <div className="bg-gray-900 rounded border border-gray-800 p-2 flex flex-col items-center justify-center text-center">
                        <span className="text-gray-400 text-[10px] uppercase font-bold tracking-wider">Code</span>
                        <span className="text-gray-200 font-mono text-lg mt-0.5">{msg.tutorialData.codeSteps}</span>
                      </div>
                    </div>

                    <div className="text-[11px] text-gray-500 border-t border-gray-800 pt-2 flex flex-wrap gap-1">
                      {msg.tutorialData.phases.map(p => (
                        <span key={p} className="bg-gray-800/50 px-1.5 py-0.5 rounded text-gray-400">{p}</span>
                      ))}
                    </div>
                    {(msg.tutorialData.codeQualityWarnings?.length ?? 0) > 0 && (
                      <div role="status" className="mt-3 border-t border-amber-900/40 pt-2 text-[11px] leading-relaxed text-amber-300/90">
                        <p className="mb-1 font-medium">Code review notes</p>
                        {(msg.tutorialData.codeQualityWarnings ?? []).map((warning, index) => (
                          <p key={`${index}-${warning}`}>{warning.replace(/^Code review \(step \d+\):\s*/, '')}</p>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Interactive Options */}
            {msg.optionsBlock && (
              <OptionsCard block={msg.optionsBlock} onSelect={(label) => handleSend(label)} />
            )}

            {/* Next Steps - hide if this message just created new tutorial steps (user hasn't completed them yet) */}
            {msg.nextStepsBlock && !msg.tutorialData && (
              <NextStepsCard block={msg.nextStepsBlock} onSelect={(action) => handleSend(action)} />
            )}
          </div>
            );
          })}
        
          {isProcessing && (
            <WorkAccordion
              actions={processingActivities}
              active
              currentActivity={processingActivity}
              startedAt={processingStartedAt}
            />
          )}
          <div ref={messagesEndRef} />
        </div>
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
          <h2 className="text-base font-mono font-bold text-white mb-4 whitespace-nowrap tracking-tight">
            Serial.println("Hello Maker!");
          </h2>
                    <div className="h-6 relative overflow-hidden w-full max-w-sm mx-auto mb-8 flex justify-center items-center">
            <AnimatePresence>
              <motion.p
                key={promptIndex}
                initial={{ y: 25, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: -25, opacity: 0 }}
                transition={{ duration: 0.5, ease: "easeOut" }}
                className="text-gray-500 text-sm absolute whitespace-nowrap"
              >
                {HARDWARE_PROMPTS[promptIndex]}
              </motion.p>
            </AnimatePresence>
          </div>

        </div>
      )}

      {/* Input Area (Centered if empty, bottom if not) */}
      <div className={`px-4 pb-4 w-full ${messages.length === 0 ? 'mt-auto mx-auto max-w-md' : 'pt-2 bg-transparent'}`}>
        {messages.length === 0 && (
          <div className="flex flex-col items-start gap-1 mb-4 pl-1">
            {QUICK_ACTIONS.map(a => (
              <button 
                key={a.label}
                onClick={() => isQuotaReached ? onQuotaReached?.() : handleSend(a.prompt)}
                className="text-[12px] text-gray-400 hover:text-gray-200 flex items-center gap-2 px-2 py-1 rounded-md hover:bg-gray-800/60 transition-all duration-200 w-auto"
              >
                <Search size={14} className="text-gray-500" />
                <span className="font-medium tracking-wide">{a.label}</span>
              </button>
            ))}
          </div>
        )}
        <div className={`bg-[#212121] border ${isQuotaReached ? 'border-red-500/60 bg-red-950/20 shadow-[0_0_20px_rgba(239,68,68,0.25)]' : 'border-gray-700/50'} rounded-3xl p-2 flex flex-col focus-within:border-gray-500/50 transition-all`}>
          {nextModuleTutorial && (
            <NextModuleCard
              key={`${latestTutorialMessageIndex}-${nextModuleName}-${nextModuleChoices.map(choice => choice.id).join('-')}`}
              moduleName={nextModuleName}
              options={nextModuleChoices}
              disabled={isProcessing || isPreparingImages || isQuotaReached || apiKeys.length === 0 || !model || !onUpdateCircuit}
              onSubmit={handleNextModuleSubmit}
            />
          )}
          <input
            ref={imageInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            onChange={handleImageSelection}
            className="hidden"
            disabled={isProcessing || isPreparingImages || isQuotaReached}
            aria-label="Choose images to analyze"
          />
          {isQuotaReached && (
            <div 
              onClick={() => {
                if (onQuotaReached) onQuotaReached();
              }}
              className="mb-1.5 mx-1 px-3 py-1.5 bg-red-500/20 hover:bg-red-500/30 border border-red-500/40 rounded-xl flex items-center justify-between text-xs text-red-300 cursor-pointer transition-all hover:scale-[1.01] active:scale-[0.99] group select-none shadow-sm"
            >
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-red-500 animate-ping" />
                <span className="font-bold text-red-200">Daily Quota Limit Reached!</span>
                <span className="hidden sm:inline text-red-300/80">Messaging locked. Resets daily at 12:00 AM or upgrade</span>
              </div>
              <span className="font-extrabold text-white bg-red-600 hover:bg-red-500 px-2.5 py-0.5 rounded-full text-[11px] uppercase tracking-wider flex items-center gap-1 shadow-sm">
                Upgrade ₹39-₹169 →
              </span>
            </div>
          )}
          {pendingImages.length > 0 && (
            <div className="flex flex-wrap gap-2 px-2 pt-2" aria-label="Attached images">
              {pendingImages.map((image, index) => (
                <div key={image.id} className="relative h-16 w-20 overflow-hidden rounded border border-gray-700 bg-black/30">
                  <img src={imageAttachmentDataUrl(image)} alt={image.name} title={image.name} className="h-full w-full object-cover" />
                  <button
                    type="button"
                    onClick={() => setPendingImages(current => current.filter((_, itemIndex) => itemIndex !== index))}
                    className="absolute right-0.5 top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-black/80 text-gray-200 hover:text-white"
                    title={`Remove ${image.name}`}
                    aria-label={`Remove ${image.name}`}
                  ><X size={12} /></button>
                </div>
              ))}
            </div>
          )}
          {imageError && <p role="alert" className="px-2 pt-1 text-[11px] text-red-400">{imageError}</p>}
          {isPreparingImages && <p role="status" className="px-2 pt-1 text-[11px] text-gray-400">Preparing image...</p>}
          <textarea
            value={input}
            onChange={e => {
              setInput(e.target.value);
              if (pendingModelWarning) setPendingModelWarning(null);
              submittingRef.current = false;
            }}
            onClick={() => { if (isQuotaReached) onQuotaReached?.(); }}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if (isQuotaReached) {
                  onQuotaReached?.();
                  return;
                }
                handleSend();
              }
            }}
            placeholder={isQuotaReached ? "Daily quota exhausted. Click here to upgrade plan (₹39 - ₹169)..." : "Message Agent..."}
            className={`w-full bg-transparent resize-none outline-none min-h-[44px] max-h-[150px] px-2 py-2 text-sm ${isQuotaReached ? 'cursor-pointer placeholder-red-400 font-medium text-red-400' : 'text-gray-200 placeholder-gray-500'}`}
            rows={1}
            readOnly={isProcessing || isQuotaReached}
          />
          
          <div className="flex items-center justify-between mt-1 px-1">
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => isQuotaReached ? onQuotaReached?.() : imageInputRef.current?.click()}
                disabled={isQuotaReached ? false : (isProcessing || isPreparingImages || pendingImages.length >= MAX_IMAGE_ATTACHMENTS)}
                className="text-gray-400 hover:text-white disabled:opacity-40 p-1 rounded-full transition-colors flex items-center justify-center"
                title="Attach image"
                aria-label="Attach image"
              >
                {isPreparingImages ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
              </button>
              {modelSelectorNode && (
                <div className="scale-90 origin-left -ml-1">
                  {modelSelectorNode}
                </div>
              )}
            </div>
            
            <div className="flex items-center gap-2">

              <button
                onClick={() => {
                  if (isQuotaReached) {
                    onQuotaReached?.();
                  } else {
                    isProcessing ? cancelGeneration() : handleSend();
                  }
                }}
                disabled={isQuotaReached ? false : ((!input.trim() && pendingImages.length === 0 && !isProcessing) || isPreparingImages)}
                className={`${isProcessing ? 'bg-red-500 hover:bg-red-600' : 'bg-[#007AFF] hover:bg-blue-600 disabled:bg-gray-700'} text-white w-8 h-8 rounded-full flex items-center justify-center transition-colors shadow-md`}
              >
                {isProcessing ? <div className="w-2.5 h-2.5 bg-white rounded-[2px]" /> : <ArrowRight size={16} />}
              </button>
            </div>
          </div>
        </div>
        
        {messages.length === 0 && (
          <p className="text-center text-[10px] text-gray-600 mt-4">
            AI can make mistakes. Verify component limits before powering up.
          </p>
        )}
      </div>
    </div>
  );
}
