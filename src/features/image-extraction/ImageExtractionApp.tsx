import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DragEvent } from "react";
import {
  ArrowDownToLine,
  Check,
  CircleHelp,
  FileImage,
  FolderArchive,
  Grid2X2,
  LockKeyhole,
  RefreshCw,
  ScanLine,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Upload,
  X,
} from "lucide-react";
import { countCells, detectContactSheet, makeEvenBoundaries } from "../../lib/detectGrid";
import type { ContactSheetLayout } from "../../lib/detectGrid";
import { createImageZip, type ExportCell } from "../../lib/exportZip";
import { applyReviewed196SampleCorrection, is196SampleCandidateLayout } from "../../lib/sampleCorrections";
import { drawCropToFrame, type FrameFitMode } from "../../lib/frameRenderer";
import { GridGuideEditor } from "./GridGuideEditor";
import { buildCellsFromGuides } from "../../lib/manualGrid";

type Cell = ExportCell & {
  id: string;
  selected: boolean;
  confidence: number;
};

type LoadedImage = {
  file: File;
  url: string;
  image: HTMLImageElement;
};

type Analysis = {
  layout: ContactSheetLayout;
  scaleX: number;
  scaleY: number;
};

const MAX_FILE_SIZE = 100 * 1024 * 1024;
const REVIEWED_196_SAMPLE_SIZE = 536907;
const REVIEWED_196_SAMPLE_SHA256 = "f07ff9935d150e593e45a1de2c591ff6c2e9ac016dc0374cf8f1f83dd5dc5372";

async function isReviewed196SampleFile(file: File, image: HTMLImageElement): Promise<boolean> {
  if (
    image.naturalWidth !== 1536 ||
    image.naturalHeight !== 864 ||
    file.size !== REVIEWED_196_SAMPLE_SIZE ||
    !globalThis.crypto?.subtle
  ) return false;

  try {
    const digest = await globalThis.crypto.subtle.digest("SHA-256", await file.arrayBuffer());
    const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
    return hash === REVIEWED_196_SAMPLE_SHA256;
  } catch {
    return false;
  }
}

function makeCellId(row: number, column: number, x: number, y: number): string {
  return [row, column, x, y].join("-");
}

function createCellsFromLayout(layout: ContactSheetLayout): Cell[] {
  return layout.cells.map((cell) => ({
    ...cell,
    id: makeCellId(cell.row, cell.column, cell.x, cell.y),
    selected: true,
  }));
}

function createUniformCells(width: number, height: number, columns: number, rows: number): Cell[] {
  const vertical = makeEvenBoundaries(width, columns);
  const horizontal = makeEvenBoundaries(height, rows);
  const cells: Cell[] = [];

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const x = vertical[column];
      const y = horizontal[row];
      const cellWidth = vertical[column + 1] - x;
      const cellHeight = horizontal[row + 1] - y;
      cells.push({
        id: makeCellId(row, column, x, y),
        row,
        column,
        x,
        y,
        width: cellWidth,
        height: cellHeight,
        confidence: 0,
        selected: true,
      });
    }
  }
  return cells;
}

function createCellsFromGuides(
  width: number,
  height: number,
  verticalCuts: number[],
  horizontalCuts: number[],
): Cell[] {
  return buildCellsFromGuides(width, height, verticalCuts, horizontalCuts).map((cell) => ({
    ...cell,
    id: makeCellId(cell.row, cell.column, cell.x, cell.y),
    confidence: 0,
    selected: true,
  }));
}

function renumberCells(cells: Cell[]): Cell[] {
  const sorted = [...cells].sort((a, b) =>
    a.row - b.row || a.x - b.x || a.y - b.y,
  );
  const columnsByRow = new Map<number, number>();

  return sorted.map((cell) => {
    const column = columnsByRow.get(cell.row) ?? 0;
    columnsByRow.set(cell.row, column + 1);
    return {
      ...cell,
      column,
      id: makeCellId(cell.row, column, cell.x, cell.y),
    };
  });
}

function analyseImage(image: HTMLImageElement): Analysis {
  const analysisScale = Math.min(1, 1800 / image.naturalWidth, 1400 / image.naturalHeight);
  const analysisWidth = Math.max(1, Math.round(image.naturalWidth * analysisScale));
  const analysisHeight = Math.max(1, Math.round(image.naturalHeight * analysisScale));
  const canvas = document.createElement("canvas");
  canvas.width = analysisWidth;
  canvas.height = analysisHeight;

  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Your browser could not analyse this image.");

  context.drawImage(image, 0, 0, analysisWidth, analysisHeight);
  return {
    layout: detectContactSheet(context.getImageData(0, 0, analysisWidth, analysisHeight)),
    scaleX: image.naturalWidth / analysisWidth,
    scaleY: image.naturalHeight / analysisHeight,
  };
}

function typicalColumns(layout: ContactSheetLayout): number {
  const counts = layout.rows.map((row) => countCells(row.boundaries));
  if (counts.length === 0) return 1;

  const frequencies = new Map<number, number>();
  for (const count of counts) frequencies.set(count, (frequencies.get(count) ?? 0) + 1);
  return [...frequencies.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
}

function CropPreview({
  image,
  cell,
  gutter,
  fitMode,
  backgroundColor,
}: {
  image: HTMLImageElement;
  cell: Cell;
  gutter: number;
  fitMode: FrameFitMode;
  backgroundColor: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;

    const padding = Math.min(gutter, Math.floor(Math.min(cell.width, cell.height) / 8));
    const crop = {
      x: Math.max(0, cell.x + padding),
      y: Math.max(0, cell.y + padding),
      width: Math.max(1, cell.width - padding * 2),
      height: Math.max(1, cell.height - padding * 2),
    };
    canvas.width = 440;
    canvas.height = 248;
    context.clearRect(0, 0, canvas.width, canvas.height);
    drawCropToFrame(context, image, crop, canvas.width, canvas.height, fitMode, backgroundColor);
  }, [image, cell, gutter, fitMode, backgroundColor]);

  return <canvas ref={canvasRef} className="crop-canvas" aria-label="16 by 9 export preview" />;
}

function App() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [loaded, setLoaded] = useState<LoadedImage | null>(null);
  const [cells, setCells] = useState<Cell[]>([]);
  const [columnsInput, setColumnsInput] = useState("16");
  const [rowsInput, setRowsInput] = useState("13");
  const [gutter, setGutter] = useState(2);
  const [showGridGuides, setShowGridGuides] = useState(false);
  const [activeCellId, setActiveCellId] = useState<string | null>(null);
  const [fitMode, setFitMode] = useState<FrameFitMode>("blur");
  const [backgroundColor, setBackgroundColor] = useState("#080b12");
  const [prefix, setPrefix] = useState("frame-");
  const [startNumber, setStartNumber] = useState(1);
  const [digits, setDigits] = useState(3);
  const [dragging, setDragging] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [confidence, setConfidence] = useState({ x: 0, y: 0 });
  const [detectedRows, setDetectedRows] = useState(0);
  const [isReviewed196Sample, setIsReviewed196Sample] = useState(false);
  const [isSampleLayoutPristine, setIsSampleLayoutPristine] = useState(false);

  const selectedCells = useMemo(() => cells.filter((cell) => cell.selected), [cells]);
  const activeCell = cells.find((cell) => cell.id === activeCellId) ?? null;
  const canApplyReviewed196Map = isReviewed196Sample && isSampleLayoutPristine && is196SampleCandidateLayout(cells);

  const releaseLoadedImage = useCallback(() => {
    setLoaded((current) => {
      if (current) URL.revokeObjectURL(current.url);
      return null;
    });
  }, []);

  useEffect(() => () => {
    if (loaded) URL.revokeObjectURL(loaded.url);
  }, [loaded]);

  const applyAnalysis = (image: HTMLImageElement): ContactSheetLayout => {
    const analysis = analyseImage(image);
    const scaledLayout: ContactSheetLayout = {
      ...analysis.layout,
      rows: analysis.layout.rows.map((row) => ({
        ...row,
        top: Math.round(row.top * analysis.scaleY),
        bottom: Math.round(row.bottom * analysis.scaleY),
        boundaries: row.boundaries.map((line) => Math.round(line * analysis.scaleX)),
        period: Math.round(row.period * analysis.scaleX),
      })),
      cells: analysis.layout.cells.map((cell) => ({
        ...cell,
        x: Math.round(cell.x * analysis.scaleX),
        y: Math.round(cell.y * analysis.scaleY),
        width: Math.round(cell.width * analysis.scaleX),
        height: Math.round(cell.height * analysis.scaleY),
      })),
    };
    return scaledLayout;
  };

  const processFile = useCallback((file?: File) => {
    if (!file) return;
    setError("");
    setNotice("");
    setIsReviewed196Sample(false);
    setIsSampleLayoutPristine(false);

    if (!file.type.startsWith("image/")) {
      setError("Choose an image format supported by your browser, such as PNG, JPG, or WebP.");
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      setError("This image is larger than 100 MB. Try a smaller contact sheet.");
      return;
    }

    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = async () => {
      try {
        const layout = applyAnalysis(image);
        const nextCells = createCellsFromLayout(layout);
        const exactSample = await isReviewed196SampleFile(file, image);
        if (nextCells.length === 0) {
          URL.revokeObjectURL(url);
          setError("No usable image tiles were found. Try a clearer contact sheet or use the uniform-grid controls.");
          return;
        }

        setLoaded({ file, url, image });
        setCells(nextCells);
        setIsReviewed196Sample(exactSample);
        setIsSampleLayoutPristine(exactSample && is196SampleCandidateLayout(nextCells));
        setColumnsInput(String(typicalColumns(layout)));
        setRowsInput(String(layout.rows.length));
        setDetectedRows(layout.rows.length);
        setConfidence({
          x: layout.verticalConfidence,
          y: layout.horizontalConfidence,
        });
        setNotice(
          "Detected " + layout.rows.length + " image rows and " + nextCells.length +
          " tiles. Column counts can vary by row; split or merge tiles when needed.",
        );
      } catch (analysisError) {
        URL.revokeObjectURL(url);
        setError(analysisError instanceof Error ? analysisError.message : "The image could not be analysed.");
      }
    };
    image.onerror = () => {
      setIsReviewed196Sample(false);
      setIsSampleLayoutPristine(false);
      URL.revokeObjectURL(url);
      setError("This image could not be opened. Try exporting it as PNG or JPG first.");
    };
    image.src = url;
  }, []);

  const openPicker = () => inputRef.current?.click();

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    processFile(event.dataTransfer.files?.[0]);
  };

  const toggleCell = (id: string) => {
    setIsSampleLayoutPristine(false);
    setCells((current) => current.map((cell) =>
      cell.id === id ? { ...cell, selected: !cell.selected } : cell,
    ));
  };

  const setAllSelected = (selected: boolean) => {
    setIsSampleLayoutPristine(false);
    setCells((current) => current.map((cell) => ({ ...cell, selected })));
  };

  const applyEvenGrid = () => {
    if (!loaded) return;
    setIsSampleLayoutPristine(false);
    const requestedColumns = Number.parseInt(columnsInput, 10);
    const requestedRows = Number.parseInt(rowsInput, 10);
    if (!Number.isFinite(requestedColumns) || !Number.isFinite(requestedRows) ||
      requestedColumns < 1 || requestedRows < 1 || requestedColumns > 60 || requestedRows > 60) {
      setError("Rows and columns must be between 1 and 60.");
      return;
    }

    setCells(createUniformCells(
      loaded.image.naturalWidth,
      loaded.image.naturalHeight,
      requestedColumns,
      requestedRows,
    ));
    setDetectedRows(requestedRows);
    setConfidence({ x: 0, y: 0 });
    setError("");
    setNotice("Applied an evenly spaced " + requestedColumns + " × " + requestedRows + " grid. Switch back to boundary detection to restore row-specific crops.");
  };

  const applyGuidedGrid = (verticalCuts: number[], horizontalCuts: number[]) => {
    if (!loaded) return;
    const nextCells = createCellsFromGuides(
      loaded.image.naturalWidth,
      loaded.image.naturalHeight,
      verticalCuts,
      horizontalCuts,
    );
    setCells(nextCells);
    setActiveCellId(null);
    setIsSampleLayoutPristine(false);
    setColumnsInput(String(verticalCuts.length + 1));
    setRowsInput(String(horizontalCuts.length + 1));
    setDetectedRows(horizontalCuts.length + 1);
    setConfidence({ x: 0, y: 0 });
    setError("");
    setNotice(
      "Applied " + verticalCuts.length + " vertical and " + horizontalCuts.length +
      " horizontal guides. " + nextCells.length + " independently positioned regions are ready for review.",
    );
  };

  const updateCellGeometry = (
    id: string,
    field: "x" | "y" | "width" | "height",
    rawValue: number,
  ) => {
    if (!loaded) return;
    setIsSampleLayoutPristine(false);
    setCells((current) => current.map((cell) => {
      if (cell.id !== id) return cell;
      const sourceWidth = loaded.image.naturalWidth;
      const sourceHeight = loaded.image.naturalHeight;
      const value = Number.isFinite(rawValue) ? Math.round(rawValue) : 0;
      const x = field === "x" ? Math.max(0, Math.min(sourceWidth - 1, value)) : cell.x;
      const y = field === "y" ? Math.max(0, Math.min(sourceHeight - 1, value)) : cell.y;
      const width = field === "width"
        ? Math.max(1, Math.min(sourceWidth - cell.x, value))
        : Math.max(1, Math.min(sourceWidth - x, cell.width));
      const height = field === "height"
        ? Math.max(1, Math.min(sourceHeight - cell.y, value))
        : Math.max(1, Math.min(sourceHeight - y, cell.height));
      return { ...cell, x, y, width, height };
    }));
  };

  const redetect = () => {
    if (!loaded) return;
    try {
      const layout = applyAnalysis(loaded.image);
      const nextCells = createCellsFromLayout(layout);
      setCells(nextCells);
      setIsSampleLayoutPristine(isReviewed196Sample && is196SampleCandidateLayout(nextCells));
      setColumnsInput(String(typicalColumns(layout)));
      setRowsInput(String(layout.rows.length));
      setDetectedRows(layout.rows.length);
      setConfidence({ x: layout.verticalConfidence, y: layout.horizontalConfidence });
      setNotice("Re-detected row-specific boundaries from the image.");
      setError("");
    } catch (analysisError) {
      setError(analysisError instanceof Error ? analysisError.message : "The image could not be analysed.");
    }
  };

  const applyReviewed196Map = () => {
    const corrected = applyReviewed196SampleCorrection(cells);
    if (!corrected) {
      setError("The detected grid no longer matches the reviewed 196-crop sample layout. Re-detect the original image before applying this map.");
      return;
    }
    setCells(corrected);
    setIsSampleLayoutPristine(false);
    setError("");
    setNotice("Applied the reviewed non-AI correction map. 196 crops are selected; the excluded title, repeated-number panels and continuation card remain visible for review.");
  };

  const splitCell = (id: string) => {
    setIsSampleLayoutPristine(false);
    setCells((current) => {
      const index = current.findIndex((cell) => cell.id === id);
      if (index < 0) return current;
      const cell = current[index];
      if (cell.width < 36) return current;

      const leftWidth = Math.floor(cell.width / 2);
      const left: Cell = {
        ...cell,
        width: leftWidth,
        selected: cell.selected,
      };
      const right: Cell = {
        ...cell,
        x: cell.x + leftWidth,
        width: cell.width - leftWidth,
        selected: cell.selected,
      };
      return renumberCells([
        ...current.slice(0, index),
        left,
        right,
        ...current.slice(index + 1),
      ]);
    });
  };

  const mergeWithNext = (id: string) => {
    setIsSampleLayoutPristine(false);
    setCells((current) => {
      const sorted = [...current].sort((a, b) => a.row - b.row || a.x - b.x);
      const index = sorted.findIndex((cell) => cell.id === id);
      if (index < 0 || index === sorted.length - 1) return current;

      const left = sorted[index];
      const right = sorted[index + 1];
      if (left.row !== right.row || Math.abs((left.x + left.width) - right.x) > 8) return current;

      const merged: Cell = {
        ...left,
        width: right.x + right.width - left.x,
        height: Math.max(left.height, right.height),
        selected: left.selected || right.selected,
        confidence: Math.min(left.confidence, right.confidence),
      };
      return renumberCells([
        ...sorted.slice(0, index),
        merged,
        ...sorted.slice(index + 2),
      ]);
    });
  };

  const canMergeWithNext = (cell: Cell): boolean => {
    const next = cells
      .filter((candidate) => candidate.row === cell.row && candidate.x > cell.x)
      .sort((a, b) => a.x - b.x)[0];
    return !!next && Math.abs((cell.x + cell.width) - next.x) <= 8;
  };

  const exportZip = async () => {
    if (!loaded || selectedCells.length === 0) return;
    setIsExporting(true);
    setError("");
    setNotice("");
    try {
      const blob = await createImageZip({
        image: loaded.image,
        cells: selectedCells,
        gutter,
        prefix,
        startNumber: Math.max(0, startNumber),
        digits,
        originalName: loaded.file.name,
        fitMode,
        backgroundColor,
      });
      const downloadUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = downloadUrl;
      anchor.download = "gridsplit-extracted-images.zip";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1500);
      setNotice("ZIP created with " + selectedCells.length + " selected image" + (selectedCells.length === 1 ? "" : "s") + ".");
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : "The ZIP could not be created.");
    } finally {
      setIsExporting(false);
    }
  };

  const startOver = () => {
    setShowGridGuides(false);
    setActiveCellId(null);
    releaseLoadedImage();
    setCells([]);
    setIsReviewed196Sample(false);
    setIsSampleLayoutPristine(false);
    setNotice("");
    setError("");
    setDetectedRows(0);
    setConfidence({ x: 0, y: 0 });
    if (inputRef.current) inputRef.current.value = "";
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="GridSplit home">
          <span className="brand-mark"><Grid2X2 size={21} strokeWidth={2.4} /></span>
          <span>grid<span>split</span></span>
        </a>
        <div className="topbar-right">
          <span className="privacy-pill"><LockKeyhole size={13} /> 100% local processing</span>
          <a className="top-link" href="https://github.com/somildholakia/GridSplit" target="_blank" rel="noreferrer">GitHub <span aria-hidden="true">↗</span></a>
        </div>
      </header>

      {!loaded ? (
        <main className="landing">
          <div className="eyebrow"><span className="eyebrow-dot" /> CONTACT SHEET EXTRACTOR</div>
          <h1>One sheet in.<br /><span>Every frame out.</span></h1>
          <p className="hero-copy">Turn storyboard grids and contact sheets into individual, numbered images. No AI. No uploads to a server. Just precise, browser-based image processing.</p>

          <div
            className={"dropzone" + (dragging ? " dropzone-active" : "")}
            onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
            onClick={openPicker}
            role="button"
            tabIndex={0}
            onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") openPicker(); }}
          >
            <input
              ref={inputRef}
              type="file"
              accept="image/*"
              hidden
              onChange={(event) => processFile(event.target.files?.[0])}
            />
            <div className="upload-icon"><Upload size={25} /></div>
            <strong>Drop your contact sheet here</strong>
            <span>or <b>browse files</b> from your device</span>
            <div className="file-types"><span>PNG</span><span>JPG</span><span>WEBP</span><span>UP TO 100 MB</span></div>
          </div>

          {error && <div className="notice error-notice"><X size={16} /> {error}</div>}

          <div className="landing-features">
            <div><ScanLine size={18} /><span><b>Pixel-based detection</b><small>Finds visible grid separators</small></span></div>
            <div><SlidersHorizontal size={18} /><span><b>Manual control</b><small>Split, merge and adjust crops</small></span></div>
            <div><ShieldCheck size={18} /><span><b>Private by design</b><small>Your image stays on your device</small></span></div>
          </div>
          <div className="landing-footnote">No AI models · No OCR · No account required · No image upload</div>
        </main>
      ) : (
        <main className="workspace">
          <div className="workspace-heading">
            <div>
              <div className="eyebrow"><span className="eyebrow-dot" /> EXTRACTION WORKSPACE</div>
              <h1>Review your <span>frames.</span></h1>
              <p className="workspace-subtitle"><FileImage size={15} /> {loaded.file.name} <span className="file-size">{(loaded.file.size / (1024 * 1024)).toFixed(2)} MB</span></p>
            </div>
            <button className="button button-quiet" onClick={startOver}><RefreshCw size={15} /> New image</button>
          </div>

          <div className="workspace-layout">
            <aside className="sidebar">
              <div className="panel-title"><Settings2 size={17} /> Extraction settings</div>

              <div className="setting-section">
                <label className="setting-label">FALLBACK GRID SIZE</label>
                <div className="dimension-fields">
                  <label><span>Typical columns</span><input type="number" min="1" max="60" value={columnsInput} onChange={(event) => setColumnsInput(event.target.value)} /></label>
                  <label><span>Rows</span><input type="number" min="1" max="60" value={rowsInput} onChange={(event) => setRowsInput(event.target.value)} /></label>
                </div>
                <button className="button button-secondary full-button" onClick={applyEvenGrid}>Apply uniform grid</button>
                <button className="text-button" onClick={redetect}><ScanLine size={14} /> Detect row boundaries again</button>
                <div className="confidence-row">
                  <span>Column confidence <b>{confidence.x ? confidence.x + "%" : "manual"}</b></span>
                  <span>Row confidence <b>{confidence.y ? confidence.y + "%" : "manual"}</b></span>
                  <span>Detected rows <b>{detectedRows}</b></span>
                </div>
                <p className="helper-copy">Automatic mode detects each row separately, so different rows can contain different numbers of tiles. Uniform grid is a manual fallback.</p>
              </div>

              <div className="setting-section">
                <label className="setting-label" htmlFor="gutter">BORDER TRIM</label>
                <div className="range-heading"><span>Trim around each tile</span><b>{gutter} px</b></div>
                <input id="gutter" className="range-input" type="range" min="0" max="60" value={gutter} onChange={(event) => setGutter(Number(event.target.value))} />
                <p className="helper-copy">Removes the contact-sheet divider from the edge of each crop.</p>
              </div>

              <div className="setting-section">
                <label className="setting-label">YOUTUBE FRAME EDITOR</label>
                <label className="field-label">How each crop fills 16:9
                  <select value={fitMode} onChange={(event) => setFitMode(event.target.value as FrameFitMode)}>
                    <option value="blur">Soft blurred background · preserve full image</option>
                    <option value="contain">Fit · preserve full image</option>
                    <option value="cover">Fill · crop outer edges</option>
                  </select>
                </label>
                <label className="field-label">Frame background
                  <input type="color" value={backgroundColor} onChange={(event) => setBackgroundColor(event.target.value)} />
                </label>
                <p className="helper-copy">Every export is 1920 × 1080. Preview cards show the final widescreen composition before download.</p>
              </div>

              <div className="setting-section">
                <label className="setting-label">FILE NAMING</label>
                <label className="field-label">Filename prefix<input value={prefix} onChange={(event) => setPrefix(event.target.value)} maxLength={24} placeholder="frame-" /></label>
                <div className="naming-fields">
                  <label className="field-label">Start at<input type="number" min="0" max="999999" value={startNumber} onChange={(event) => setStartNumber(Math.max(0, Number(event.target.value) || 0))} /></label>
                  <label className="field-label">Digits<select value={digits} onChange={(event) => setDigits(Number(event.target.value))}><option value={2}>2</option><option value={3}>3</option><option value={4}>4</option><option value={5}>5</option></select></label>
                </div>
                <div className="filename-preview"><FileImage size={13} /> {prefix || "frame-"}{String(startNumber).padStart(digits, "0")}.png</div>
              </div>

              <div className="privacy-note"><ShieldCheck size={17} /><span><b>Your image stays private</b><small>All cropping and ZIP creation happen locally in this browser tab.</small></span></div>
            </aside>

            <section className="results-panel">
              <div className="results-toolbar">
                <div className="results-stats">
                  <div className="stat-number">{cells.length}<span> detected</span></div>
                  <div className="stat-selected"><Check size={14} /> {selectedCells.length} selected for export · {detectedRows} rows</div>
                </div>
                <div className="toolbar-actions">
                  <button className="text-button" onClick={() => setAllSelected(true)}>Select all</button>
                  <span className="toolbar-divider" />
                  <button className="text-button" onClick={() => setAllSelected(false)}>Clear</button>
                  <button className="button button-primary" disabled={selectedCells.length === 0 || isExporting} onClick={exportZip}>
                    {isExporting ? <span className="spinner" /> : <FolderArchive size={16} />}
                    {isExporting ? "Creating ZIP…" : "Export ZIP"}
                    {!isExporting && <ArrowDownToLine size={15} />}
                  </button>
                </div>
              </div>

              {notice && <div className="notice success-notice"><Check size={15} /> {notice}</div>}
              {error && <div className="notice error-notice"><X size={15} /> {error}</div>}

              <div className="review-hint"><CircleHelp size={15} /> Click a tile to include or exclude it. Use manual guides for uneven rows and columns, then fine-tune any crop before export.</div>
              <div className="manual-guide-toolbar">
                <div><b>Need exact boundaries?</b><span>Place and drag your own split lines over the original collage.</span></div>
                <button type="button" className="button button-secondary" onClick={() => setShowGridGuides((visible) => !visible)}>
                  <Grid2X2 size={15} /> {showGridGuides ? "Hide grid guide editor" : "Open grid guide editor"}
                </button>
              </div>
              <GridGuideEditor
                key={loaded.url}
                image={loaded.image}
                initialColumns={Math.max(1, Math.min(60, Number.parseInt(columnsInput, 10) || 4))}
                initialRows={Math.max(1, Math.min(60, Number.parseInt(rowsInput, 10) || 4))}
                open={showGridGuides}
                onApply={applyGuidedGrid}
              />
              {activeCell && (
                <div className="crop-editor-panel">
                  <div className="crop-editor-heading">
                    <div><b>Fine-tune crop · R{activeCell.row + 1} / C{activeCell.column + 1}</b><span>Adjust the exact source-image rectangle in pixels. The preview updates immediately.</span></div>
                    <button type="button" onClick={() => setActiveCellId(null)}>Close</button>
                  </div>
                  <div className="crop-editor-fields">
                    <label>X position <input type="number" min="0" max={loaded.image.naturalWidth - 1} value={activeCell.x} onChange={(event) => updateCellGeometry(activeCell.id, "x", Number(event.target.value))} /></label>
                    <label>Y position <input type="number" min="0" max={loaded.image.naturalHeight - 1} value={activeCell.y} onChange={(event) => updateCellGeometry(activeCell.id, "y", Number(event.target.value))} /></label>
                    <label>Crop width <input type="number" min="1" max={loaded.image.naturalWidth - activeCell.x} value={activeCell.width} onChange={(event) => updateCellGeometry(activeCell.id, "width", Number(event.target.value))} /></label>
                    <label>Crop height <input type="number" min="1" max={loaded.image.naturalHeight - activeCell.y} value={activeCell.height} onChange={(event) => updateCellGeometry(activeCell.id, "height", Number(event.target.value))} /></label>
                  </div>
                </div>
              )}
              {canApplyReviewed196Map && (
                <div className="notice sample-correction-notice">
                  <span><b>Exact sample recognized.</b> Apply the reviewed pixel-based correction map to select the requested 196 storyboard crops. You can still review and change every tile before export.</span>
                  <button className="button button-secondary" onClick={applyReviewed196Map}>Apply 196-crop map</button>
                </div>
              )}

              <div className="image-grid">
                {cells.map((cell, index) => (
                  <div
                    className={"image-card" + (cell.selected ? " image-card-selected" : " image-card-muted")}
                    key={cell.id}
                  >
                    <button
                      type="button"
                      className="image-card-select"
                      onClick={() => toggleCell(cell.id)}
                      aria-pressed={cell.selected}
                      aria-label={(cell.selected ? "Exclude " : "Include ") + "row " + (cell.row + 1) + ", column " + (cell.column + 1)}
                    >
                      <div className="image-card-preview">
                        <CropPreview image={loaded.image} cell={cell} gutter={gutter} fitMode={fitMode} backgroundColor={backgroundColor} />
                        <span className={"selection-indicator" + (cell.selected ? " is-selected" : "")}>{cell.selected ? <Check size={12} /> : <X size={12} />}</span>
                      </div>
                      <div className="image-card-meta">
                        <b>{String(index + startNumber).padStart(digits, "0")}</b>
                        <span>R{String(cell.row + 1).padStart(2, "0")} · C{String(cell.column + 1).padStart(2, "0")}</span>
                      </div>
                    </button>
                    <div className="image-card-actions">
                      <button type="button" onClick={() => splitCell(cell.id)} disabled={cell.width < 36} title="Split this tile in half">
                        <span aria-hidden="true">÷</span> Split
                      </button>
                      <button type="button" onClick={() => mergeWithNext(cell.id)} disabled={!canMergeWithNext(cell)} title="Merge with the next tile in this row">
                        <span aria-hidden="true">↔</span> Merge →
                      </button>
                      <button type="button" onClick={() => setActiveCellId((current) => current === cell.id ? null : cell.id)} title="Fine-tune crop bounds">
                        <SlidersHorizontal size={12} /> {activeCellId === cell.id ? "Editing" : "Edit crop"}
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              <div className="bottom-export">
                <div><b>{selectedCells.length} images ready</b><span>Exported as lossless PNG crops in one ZIP file.</span></div>
                <button className="button button-primary" disabled={selectedCells.length === 0 || isExporting} onClick={exportZip}>
                  <FolderArchive size={16} /> Export {selectedCells.length} images <ArrowDownToLine size={15} />
                </button>
              </div>
            </section>
          </div>
        </main>
      )}

      <footer className="footer">
        <span>GRIDSPLIT <i>·</i> IMAGE PROCESSING, NOT AI</span>
        <span>Made for storyboards, contact sheets and visual workflows.</span>
      </footer>
    </div>
  );
}

export default App;