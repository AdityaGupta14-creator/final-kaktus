'use client';

import { useState, useCallback } from 'react';
import { X, Download, FileText, Edit3, Check, Loader2 } from 'lucide-react';
import type { TutorialData } from './CircuitCanvas';
import { buildFinalCircuitSvg, svgToPngDataUrl } from '@/lib/circuit-diagram';

interface PdfGeneratorProps {
  isOpen: boolean;
  onClose: () => void;
  circuitData: TutorialData | null;
  sessionTitle: string;
  tabName: string;
  sessionId: string;
  workspaceTabId: string;
}

export function PdfGenerator({ isOpen, onClose, circuitData, sessionTitle, tabName, sessionId, workspaceTabId }: PdfGeneratorProps) {
  const [projectTitle, setProjectTitle] = useState(circuitData?.project_name || sessionTitle || 'Untitled Project');
  const [projectDescription, setProjectDescription] = useState(circuitData?.description || '');
  const [authorName, setAuthorName] = useState('');
  const [notes, setNotes] = useState('');
  const [editingField, setEditingField] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);

  // Compute full component/wiring list from all steps
  const getFullCircuitInfo = useCallback(() => {
    if (!circuitData?.steps) return {
      components: [], wiring: [], steps: [],
      board: { required: false, count: 0, x: 0, y: 0, wireSlots: {} as Record<string, number> },
    };
    const compMap = new Map<string, any>();
    const wireMap = new Map<string, any>();
    const wireSlots = new Map<string, number>();
    let boardRequired = false;
    const normalizedWireKey = (from: string, to: string) => [from.toLowerCase(), to.toLowerCase()].sort().join('|');

    for (const step of circuitData.steps) {
      if (step.remove_components) step.remove_components.forEach(id => {
        compMap.delete(id);
        for (const [key, wire] of Array.from(wireMap.entries())) {
          if (wire.from.startsWith(`${id}:`) || wire.to.startsWith(`${id}:`)) wireMap.delete(key);
        }
      });
      if (step.remove_wiring) {
        step.remove_wiring.forEach(item => {
          if (typeof item === 'string') {
            for (const [key, w] of Array.from(wireMap.entries())) {
              if (w.from === item || w.to === item) wireMap.delete(key);
            }
          } else if (item && typeof item === 'object' && item.from && item.to) {
            const removalKey = normalizedWireKey(item.from, item.to);
            for (const [key, wire] of Array.from(wireMap.entries())) {
              if (normalizedWireKey(wire.from, wire.to) === removalKey) wireMap.delete(key);
            }
          }
        });
      }
      if (step.add_components) step.add_components.forEach((c: any) => compMap.set(c.id, c));
      if (step.add_wiring) step.add_wiring.forEach((w: any) => {
        wireMap.set(`${w.from}-${w.to}`, w);
        const slotKey = normalizedWireKey(w.from, w.to);
        if (!wireSlots.has(slotKey)) wireSlots.set(slotKey, wireSlots.size);
      });
      if (wireMap.size >= 6 || Array.from(compMap.values()).some(component => /breadboard/i.test(component.type || ''))) {
        boardRequired = true;
      }
    }

    const components = Array.from(compMap.values());
    const boardCount = boardRequired ? Math.max(1, Math.ceil(wireSlots.size / 60)) : 0;
    const positioned = components.filter(component => Number.isFinite(Number(component.x)) && Number.isFinite(Number(component.y)));
    const centerX = positioned.length ? positioned.reduce((total, component) => total + (Number(component.x) || 0), 0) / positioned.length : 900;
    const centerY = positioned.length ? positioned.reduce((total, component) => total + (Number(component.y) || 0), 0) / positioned.length : 500;
    const totalBoardWidth = boardCount * 780 + Math.max(0, boardCount - 1) * 30;

    return {
      components,
      wiring: Array.from(wireMap.values()),
      board: {
        required: boardRequired,
        count: boardCount,
        x: positioned.length ? centerX - totalBoardWidth / 2 : 900,
        y: positioned.length ? centerY - 165 : 500,
        wireSlots: Object.fromEntries(wireSlots),
      },
      steps: circuitData.steps.map((s: any, i: number) => ({
        index: i + 1,
        phase: s.phase || 'Build',
        instruction: s.instruction || '',
        detail: s.detail || '',
        verify: s.verify || '',
      })),
    };
  }, [circuitData]);

  const generatePdf = useCallback(async () => {
    setIsGenerating(true);
    try {
      const { jsPDF } = await import('jspdf');
      const info = getFullCircuitInfo();
      const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      const pageW = doc.internal.pageSize.getWidth();
      const pageH = doc.internal.pageSize.getHeight();
      const margin = 15;
      const contentW = pageW - margin * 2;
      let y = margin;

      // Helper: add watermark to every page
      const addWatermark = () => {
        doc.setTextColor(230, 230, 230);
        doc.setFontSize(60);
        doc.setFont('helvetica', 'bold');
        const wmText = 'KAKTUS';
        const wmWidth = doc.getTextWidth(wmText);
        // Diagonal watermark
        doc.saveGraphicsState();
        // @ts-ignore
        const gState = doc.GState && new doc.GState({ opacity: 0.06 });
        if (gState) doc.setGState(gState);
        const cx = pageW / 2;
        const cy = pageH / 2;
        doc.text(wmText, cx - wmWidth / 2, cy, { angle: 35 });
        doc.restoreGraphicsState();
      };

      // Helper: check page break
      const checkPageBreak = (needed: number) => {
        if (y + needed > pageH - margin) {
          doc.addPage();
          addWatermark();
          addFooter();
          y = margin + 10;
        }
      };

      // Helper: footer on each page
      const addFooter = () => {
        const pageCount = doc.getNumberOfPages();
        doc.setFontSize(7);
        doc.setTextColor(160, 160, 160);
        doc.text(`Generated by Kaktus — AI-Powered Hardware Engineering Platform`, margin, pageH - 6);
        doc.text(`Page ${pageCount}`, pageW - margin, pageH - 6, { align: 'right' });
        doc.setDrawColor(200, 200, 200);
        doc.line(margin, pageH - 10, pageW - margin, pageH - 10);
      };

      // ====== PAGE 1: Cover ======
      addWatermark();

      // Top accent bar
      doc.setFillColor(17, 17, 17);
      doc.rect(0, 0, pageW, 45, 'F');
      doc.setFillColor(34, 197, 94);
      doc.rect(0, 44, pageW, 1.5, 'F');

      // Logo text
      doc.setFontSize(28);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(255, 255, 255);
      doc.text('Kaktus', margin + 2, 22);
      doc.setFontSize(9);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(180, 180, 180);
      doc.text('AI-Powered Hardware Engineering Platform', margin + 2, 30);

      // Kaktus tree icon (simple SVG-like drawing)
      const iconX = pageW - margin - 10;
      doc.setDrawColor(34, 197, 94);
      doc.setLineWidth(1.2);
      doc.line(iconX, 15, iconX, 35);
      doc.line(iconX, 25, iconX - 4, 20);
      doc.line(iconX, 22, iconX + 4, 18);

      y = 60;

      // Project Title
      doc.setFontSize(24);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(30, 30, 30);
      const titleLines = doc.splitTextToSize(projectTitle, contentW);
      doc.text(titleLines, margin, y);
      y += titleLines.length * 10 + 4;

      // Description
      if (projectDescription) {
        doc.setFontSize(11);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(100, 100, 100);
        const descLines = doc.splitTextToSize(projectDescription, contentW);
        doc.text(descLines, margin, y);
        y += descLines.length * 5 + 6;
      }

      // Meta info box
      doc.setFillColor(248, 249, 250);
      doc.roundedRect(margin, y, contentW, 28, 3, 3, 'F');
      doc.setDrawColor(220, 220, 220);
      doc.roundedRect(margin, y, contentW, 28, 3, 3, 'S');

      doc.setFontSize(8);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(100, 100, 100);
      doc.text('MODULE', margin + 5, y + 7);
      doc.text('DATE', margin + 55, y + 7);
      doc.text('COMPONENTS', margin + 105, y + 7);
      doc.text('CONNECTIONS', margin + 145, y + 7);

      doc.setFontSize(10);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(30, 30, 30);
      doc.text(tabName || 'Main Assembly', margin + 5, y + 16);
      doc.text(new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }), margin + 55, y + 16);
      doc.text(String(info.components.length), margin + 105, y + 16);
      doc.text(String(info.wiring.length), margin + 145, y + 16);

      if (authorName) {
        doc.setFontSize(8);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(100, 100, 100);
        doc.text('AUTHOR', margin + 5, y + 23);
        doc.setFontSize(10);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(30, 30, 30);
        doc.text(authorName, margin + 55, y + 23);
      }

      y += 36;

      // ====== FINAL CIRCUIT DIAGRAM ======
      checkPageBreak(75);
      doc.setFontSize(14);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(30, 30, 30);
      doc.text('Circuit Diagram — Final Project State', margin, y);
      y += 8;
      doc.setDrawColor(34, 197, 94);
      doc.setLineWidth(0.8);
      doc.line(margin, y, margin + 40, y);
      y += 6;

      const layoutKey = `${workspaceTabId || circuitData?.project_name || 'workspace'}:${circuitData?.project_name || 'project'}`;
      let savedBoardPositions: Record<number, { x: number; y: number }> | undefined;
      try {
        const stored = localStorage.getItem(`kaktus_breadboard_positions_${sessionId || 'local'}`);
        const parsed = stored ? JSON.parse(stored) : null;
        const projectPositions = parsed && typeof parsed === 'object' ? parsed[layoutKey] : null;
        if (projectPositions && typeof projectPositions === 'object') savedBoardPositions = projectPositions;
      } catch {
        // The project diagram still exports with its default board placement if local layout data is unavailable.
      }
      const svg = buildFinalCircuitSvg(info.components, info.wiring, { ...info.board, savedPositions: savedBoardPositions });
      const diagram = await svgToPngDataUrl(svg);
      const aspectRatio = diagram.height / diagram.width;
      const maxDiagramHeight = Math.min(135, pageH - margin - y - 12);
      if (maxDiagramHeight < 35) {
        doc.addPage();
        addWatermark();
        y = margin + 10;
      }
      const availableHeight = Math.max(35, Math.min(135, pageH - margin - y - 12));
      const imgWidth = Math.min(contentW, availableHeight / aspectRatio);
      const imgHeight = imgWidth * aspectRatio;
      doc.addImage(diagram.dataUrl, 'PNG', margin, y, imgWidth, imgHeight);
      y += imgHeight + 8;

      // ====== COMPONENTS TABLE ======
      if (info.components.length > 0) {
        checkPageBreak(30);
        doc.setFontSize(14);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(30, 30, 30);
        doc.text('Components List', margin, y);
        y += 8;
        doc.setDrawColor(34, 197, 94);
        doc.setLineWidth(0.8);
        doc.line(margin, y, margin + 40, y);
        y += 6;

        // Table header
        doc.setFillColor(240, 240, 240);
        doc.rect(margin, y, contentW, 7, 'F');
        doc.setFontSize(8);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(80, 80, 80);
        doc.text('#', margin + 2, y + 5);
        doc.text('ID', margin + 10, y + 5);
        doc.text('Type', margin + 45, y + 5);
        doc.text('Value', margin + 85, y + 5);
        doc.text('Position', margin + 125, y + 5);
        y += 9;

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8);
        info.components.forEach((comp: any, idx: number) => {
          checkPageBreak(7);
          if (idx % 2 === 0) {
            doc.setFillColor(250, 250, 250);
            doc.rect(margin, y - 3.5, contentW, 6, 'F');
          }
          doc.setTextColor(50, 50, 50);
          doc.text(String(idx + 1), margin + 2, y);
          doc.text(comp.id || '-', margin + 10, y);
          doc.text(comp.type || '-', margin + 45, y);
          doc.text(comp.value || comp.model || '-', margin + 85, y);
          doc.text(`(${comp.x || 0}, ${comp.y || 0})`, margin + 125, y);
          y += 6;
        });
        y += 4;
      }

      // ====== WIRING TABLE ======
      if (info.wiring.length > 0) {
        checkPageBreak(30);
        doc.setFontSize(14);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(30, 30, 30);
        doc.text('Wiring / Connections', margin, y);
        y += 8;
        doc.setDrawColor(34, 197, 94);
        doc.setLineWidth(0.8);
        doc.line(margin, y, margin + 40, y);
        y += 6;

        doc.setFillColor(240, 240, 240);
        doc.rect(margin, y, contentW, 7, 'F');
        doc.setFontSize(8);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(80, 80, 80);
        doc.text('#', margin + 2, y + 5);
        doc.text('From', margin + 10, y + 5);
        doc.text('To', margin + 75, y + 5);
        doc.text('Color', margin + 140, y + 5);
        y += 9;

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8);
        info.wiring.forEach((wire: any, idx: number) => {
          checkPageBreak(7);
          if (idx % 2 === 0) {
            doc.setFillColor(250, 250, 250);
            doc.rect(margin, y - 3.5, contentW, 6, 'F');
          }
          doc.setTextColor(50, 50, 50);
          doc.text(String(idx + 1), margin + 2, y);
          doc.text(wire.from || '-', margin + 10, y);
          doc.text(wire.to || '-', margin + 75, y);
          doc.text(wire.color || '-', margin + 140, y);
          y += 6;
        });
        y += 4;
      }

      // ====== BUILD STEPS ======
      if (info.steps.length > 0) {
        checkPageBreak(30);
        doc.setFontSize(14);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(30, 30, 30);
        doc.text('Step-by-Step Build Guide', margin, y);
        y += 8;
        doc.setDrawColor(34, 197, 94);
        doc.setLineWidth(0.8);
        doc.line(margin, y, margin + 40, y);
        y += 8;

        info.steps.forEach((step: any) => {
          checkPageBreak(25);
          // Step number badge
          doc.setFillColor(34, 197, 94);
          doc.circle(margin + 3, y - 1, 3, 'F');
          doc.setFontSize(7);
          doc.setFont('helvetica', 'bold');
          doc.setTextColor(255, 255, 255);
          doc.text(String(step.index), margin + 3, y + 0.5, { align: 'center' });

          // Phase
          doc.setFontSize(7);
          doc.setFont('helvetica', 'bold');
          doc.setTextColor(34, 197, 94);
          doc.text(step.phase.toUpperCase(), margin + 9, y);

          // Instruction
          doc.setFontSize(9);
          doc.setFont('helvetica', 'bold');
          doc.setTextColor(30, 30, 30);
          const instrLines = doc.splitTextToSize(step.instruction, contentW - 10);
          doc.text(instrLines, margin + 9, y + 5);
          y += 5 + instrLines.length * 4;

          // Detail
          if (step.detail) {
            doc.setFontSize(8);
            doc.setFont('helvetica', 'normal');
            doc.setTextColor(100, 100, 100);
            const detailClean = step.detail.replace(/```[\s\S]*?```/g, '[code block]');
            const detailLines = doc.splitTextToSize(detailClean, contentW - 12);
            const maxDetailLines = detailLines.slice(0, 6);
            checkPageBreak(maxDetailLines.length * 3.5 + 2);
            doc.text(maxDetailLines, margin + 11, y);
            y += maxDetailLines.length * 3.5 + 2;
          }

          // Verify
          if (step.verify) {
            doc.setFontSize(7);
            doc.setFont('helvetica', 'italic');
            doc.setTextColor(120, 120, 120);
            const verifyLines = doc.splitTextToSize('✓ ' + step.verify, contentW - 12);
            checkPageBreak(verifyLines.length * 3 + 2);
            doc.text(verifyLines.slice(0, 3), margin + 11, y);
            y += Math.min(verifyLines.length, 3) * 3 + 2;
          }
          y += 4;
        });
      }

      // ====== NOTES ======
      if (notes) {
        checkPageBreak(30);
        doc.setFontSize(14);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(30, 30, 30);
        doc.text('Notes', margin, y);
        y += 8;
        doc.setDrawColor(34, 197, 94);
        doc.setLineWidth(0.8);
        doc.line(margin, y, margin + 40, y);
        y += 6;

        doc.setFontSize(9);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(60, 60, 60);
        const noteLines = doc.splitTextToSize(notes, contentW);
        doc.text(noteLines, margin, y);
        y += noteLines.length * 4 + 6;
      }

      // Add footer to all pages
      const totalPages = doc.getNumberOfPages();
      for (let i = 1; i <= totalPages; i++) {
        doc.setPage(i);
        addFooter();
        // Also add watermark if not first page (first already has it)
        if (i > 1) addWatermark();
      }

      // Save
      const safeName = projectTitle.replace(/[^a-zA-Z0-9 ]/g, '').replace(/\s+/g, '_').slice(0, 40);
      doc.save(`Kaktus_${safeName}_${new Date().toISOString().split('T')[0]}.pdf`);
    } catch (e) {
      console.error('PDF generation failed:', e);
      alert('PDF generation failed. Please try again.');
    }
    setIsGenerating(false);
  }, [projectTitle, projectDescription, authorName, notes, circuitData, tabName, sessionId, workspaceTabId, getFullCircuitInfo]);

  if (!isOpen) return null;

  const info = getFullCircuitInfo();

  return (
    <div className="fixed inset-0 z-[99999] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-[#111] border border-gray-700 rounded-2xl w-full max-w-2xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-gray-800 bg-[#0d0d0d]">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-green-900/30 rounded-lg flex items-center justify-center border border-green-800/40">
              <FileText className="text-green-500" size={18} />
            </div>
            <div>
              <h3 className="text-white font-bold text-lg">Export as PDF</h3>
              <p className="text-gray-500 text-xs">Circuit diagram + build guide with Kaktus branding</p>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-white transition-colors p-1.5 rounded-lg hover:bg-gray-800">
            <X size={18} />
          </button>
        </div>

        {/* Content - Editable fields */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* Project Title */}
          <div className="group bg-[#1a1a1a] rounded-xl p-4 border border-gray-800 hover:border-gray-700 transition-colors">
            <label className="text-[10px] text-gray-500 uppercase tracking-wider font-bold mb-2 block">Project Title</label>
            {editingField === 'title' ? (
              <div className="flex items-center gap-2">
                <input
                  autoFocus
                  value={projectTitle}
                  onChange={e => setProjectTitle(e.target.value)}
                  className="flex-1 bg-black/50 text-white px-3 py-2 rounded-lg border border-gray-700 focus:border-green-600 focus:outline-none text-sm"
                />
                <button onClick={() => setEditingField(null)} className="p-2 bg-green-600/20 text-green-400 rounded-lg hover:bg-green-600/30"><Check size={14} /></button>
              </div>
            ) : (
              <div className="flex items-center justify-between cursor-pointer" onClick={() => setEditingField('title')}>
                <span className="text-white font-medium text-sm">{projectTitle || 'Click to add...'}</span>
                <Edit3 size={13} className="text-gray-600 group-hover:text-gray-400 transition-colors" />
              </div>
            )}
          </div>

          {/* Description */}
          <div className="group bg-[#1a1a1a] rounded-xl p-4 border border-gray-800 hover:border-gray-700 transition-colors">
            <label className="text-[10px] text-gray-500 uppercase tracking-wider font-bold mb-2 block">Description</label>
            {editingField === 'desc' ? (
              <div className="flex flex-col gap-2">
                <textarea
                  autoFocus
                  value={projectDescription}
                  onChange={e => setProjectDescription(e.target.value)}
                  rows={3}
                  className="bg-black/50 text-white px-3 py-2 rounded-lg border border-gray-700 focus:border-green-600 focus:outline-none text-sm resize-none"
                />
                <button onClick={() => setEditingField(null)} className="self-end p-2 bg-green-600/20 text-green-400 rounded-lg hover:bg-green-600/30"><Check size={14} /></button>
              </div>
            ) : (
              <div className="flex items-start justify-between cursor-pointer" onClick={() => setEditingField('desc')}>
                <span className="text-gray-300 text-sm line-clamp-2">{projectDescription || 'Click to add project description...'}</span>
                <Edit3 size={13} className="text-gray-600 group-hover:text-gray-400 transition-colors flex-shrink-0 mt-1" />
              </div>
            )}
          </div>

          {/* Author & Notes - Side by side */}
          <div className="grid grid-cols-2 gap-3">
            <div className="group bg-[#1a1a1a] rounded-xl p-4 border border-gray-800 hover:border-gray-700 transition-colors">
              <label className="text-[10px] text-gray-500 uppercase tracking-wider font-bold mb-2 block">Author Name</label>
              {editingField === 'author' ? (
                <div className="flex items-center gap-2">
                  <input
                    autoFocus
                    value={authorName}
                    onChange={e => setAuthorName(e.target.value)}
                    className="flex-1 bg-black/50 text-white px-3 py-2 rounded-lg border border-gray-700 focus:border-green-600 focus:outline-none text-sm"
                    placeholder="Your name"
                  />
                  <button onClick={() => setEditingField(null)} className="p-2 bg-green-600/20 text-green-400 rounded-lg hover:bg-green-600/30"><Check size={14} /></button>
                </div>
              ) : (
                <div className="flex items-center justify-between cursor-pointer" onClick={() => setEditingField('author')}>
                  <span className="text-gray-400 text-sm">{authorName || 'Optional'}</span>
                  <Edit3 size={13} className="text-gray-600 group-hover:text-gray-400 transition-colors" />
                </div>
              )}
            </div>

            <div className="bg-[#1a1a1a] rounded-xl p-4 border border-gray-800">
              <label className="text-[10px] text-gray-500 uppercase tracking-wider font-bold mb-2 block">Summary</label>
              <div className="flex items-center gap-4 text-sm">
                <div className="flex flex-col items-center">
                  <span className="text-white font-bold text-lg">{info.components.length}</span>
                  <span className="text-gray-500 text-[10px]">Components</span>
                </div>
                <div className="w-px h-8 bg-gray-700"></div>
                <div className="flex flex-col items-center">
                  <span className="text-white font-bold text-lg">{info.wiring.length}</span>
                  <span className="text-gray-500 text-[10px]">Connections</span>
                </div>
                <div className="w-px h-8 bg-gray-700"></div>
                <div className="flex flex-col items-center">
                  <span className="text-white font-bold text-lg">{info.steps.length}</span>
                  <span className="text-gray-500 text-[10px]">Steps</span>
                </div>
              </div>
            </div>
          </div>

          {/* Notes */}
          <div className="group bg-[#1a1a1a] rounded-xl p-4 border border-gray-800 hover:border-gray-700 transition-colors">
            <label className="text-[10px] text-gray-500 uppercase tracking-wider font-bold mb-2 block">Additional Notes</label>
            {editingField === 'notes' ? (
              <div className="flex flex-col gap-2">
                <textarea
                  autoFocus
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  rows={3}
                  placeholder="Add any extra notes for the PDF..."
                  className="bg-black/50 text-white px-3 py-2 rounded-lg border border-gray-700 focus:border-green-600 focus:outline-none text-sm resize-none"
                />
                <button onClick={() => setEditingField(null)} className="self-end p-2 bg-green-600/20 text-green-400 rounded-lg hover:bg-green-600/30"><Check size={14} /></button>
              </div>
            ) : (
              <div className="flex items-start justify-between cursor-pointer" onClick={() => setEditingField('notes')}>
                <span className="text-gray-400 text-sm line-clamp-2">{notes || 'Click to add notes...'}</span>
                <Edit3 size={13} className="text-gray-600 group-hover:text-gray-400 transition-colors flex-shrink-0 mt-1" />
              </div>
            )}
          </div>

          {/* What's included */}
          <div className="bg-[#0d0d0d] rounded-xl p-4 border border-gray-800/50">
            <p className="text-[10px] text-gray-500 uppercase tracking-wider font-bold mb-2">Included in PDF</p>
            <div className="grid grid-cols-2 gap-1.5 text-xs text-gray-400">
              <span className="flex items-center gap-1.5"><Check size={10} className="text-green-500" /> Circuit Diagram</span>
              <span className="flex items-center gap-1.5"><Check size={10} className="text-green-500" /> Components Table</span>
              <span className="flex items-center gap-1.5"><Check size={10} className="text-green-500" /> Wiring Table</span>
              <span className="flex items-center gap-1.5"><Check size={10} className="text-green-500" /> Build Steps</span>
              <span className="flex items-center gap-1.5"><Check size={10} className="text-green-500" /> Kaktus Watermark</span>
              <span className="flex items-center gap-1.5"><Check size={10} className="text-green-500" /> Branding & Logo</span>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-5 border-t border-gray-800 bg-[#0d0d0d] flex items-center justify-between">
          <button onClick={onClose} className="px-5 py-2.5 text-gray-400 hover:text-white text-sm font-medium rounded-lg hover:bg-gray-800 transition-colors">
            Cancel
          </button>
          <button
            onClick={generatePdf}
            disabled={isGenerating || !circuitData}
            className="px-6 py-2.5 bg-green-600 hover:bg-green-700 disabled:bg-gray-700 disabled:text-gray-500 text-white font-bold rounded-xl text-sm transition-all flex items-center gap-2 shadow-lg shadow-green-900/30 hover:shadow-green-900/50"
          >
            {isGenerating ? (
              <><Loader2 size={14} className="animate-spin" /> Generating...</>
            ) : (
              <><Download size={14} /> Download PDF</>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
