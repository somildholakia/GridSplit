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
import { countCells, detectGrid, makeEvenBoundaries } from "./lib/detectGrid";
import { createImageZip, type ExportCell } from "./lib/exportZip";

type Cell = ExportCell & {
  id: string;
  selected: boolean;
};

type LoadedImage = {
  file: File;
  url: string;
  image: HTMLImageElement;
};

const MAX_FILE_SIZE = 100 * 1024 * 1024;

function createCells(vertical: number[], horizontal: number[]): Cell[] {
  const cells: Cell[] = [];
  for (let row = 0; row < horizontal.length - 1; row += 1) {
    for (let column = 0; column < vertical.length - 1; column += 1) {
      const x = vertical[column];
      const y = horizontal[row];
      const width = vertical[column + 1] - x;
      const height = horizontal[row + 1] - y;
      if (width < 12 || height < 12) continue;
      cells.push({
        id: row + "-" + column,
        row,
        column,
        x,
        y,
        width,
        height,
        selected: true,
      });
    }
  }
  return cells;
}

function CropPreview({
  image,
  cell,
  gutter,
}: {
  image: HTMLImageElement;
  cell: Cell;
  gutter: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;

    const padding = Math.min(gutter, Math.floor(Math.min(cell.width, cell.height) / 8));
    const sx = Math.max(0, cell.x + padding);
    const sy = Math.max(0, cell.y + padding);
    const sw = Math.max(1, cell.width - padding * 2);
    const sh = Math.max(1, cell.height - padding * 2);
    const scale = Math.min(1, 440 / sw, 250 / sh);
    canvas.width = Math.max(1, Math.round(sw * scale));
    canvas.height = Math.max(1, Math.round(sh * scale));
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  }, [image, cell, gutter]);

  return <canvas ref={canvasRef} className="crop-canvas" aria-label="Cropped image preview" />;
}

function App() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [loaded, setLoaded] = useState<LoadedImage | null>(null);
  const [cells, setCells] = useState<Cell[]>([]);
  const [columnsInput, setColumnsInput] = useState("15");
  const [rowsInput, setRowsInput] = useState("12");
  const [gutter, setGutter] = useState(2);
  const [prefix, setPrefix] = useState("frame-");
  const [startNumber, setStartNumber] = useState(1);
  const [digits, setDigits] = useState(3);
  const [dragging, setDragging] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [confidence, setConfidence] = useState({ x: 0, y: 0 });

  const selectedCells = useMemo(() => cells.filter((cell) => cell.selected), [cells]);

  const releaseLoadedImage = useCallback(() => {
    setLoaded((current) => {
      if (current) URL.revokeObjectURL(current.url);
      return null;
    });
  }, []);

  useEffect(() => () => {
    if (loaded) URL.revokeObjectURL(loaded.url);
  }, [loaded]);

  const processFile = useCallback((file?: File) => {
    if (!file) return;
    setError("");
    setNotice("");

    if (!file.type.startsWith("image/")) {
      setError("Choose a PNG, JPG, WebP, GIF, or other browser-supported image.");
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      setError("This image is larger than 100 MB. Try a smaller contact sheet.");
      return;
    }

    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      const analysisScale = Math.min(1, 1800 / image.naturalWidth, 1400 / image.naturalHeight);
      const analysisWidth = Math.max(1, Math.round(image.naturalWidth * analysisScale));
      const analysisHeight = Math.max(1, Math.round(image.naturalHeight * analysisScale));
      const canvas = document.createElement("canvas");
      canvas.width = analysisWidth;
      canvas.height = analysisHeight;
      const context = canvas.getContext("2d", { willReadFrequently: true });

      if (!context) {
        URL.revokeObjectURL(url);
        setError("Your browser could not analyse this image. Try another browser.");
        return;
      }

      context.drawImage(image, 0, 0, analysisWidth, analysisHeight);
      const result = detectGrid(context.getImageData(0, 0, analysisWidth, analysisHeight));
      const scaleX = image.naturalWidth / analysisWidth;
      const scaleY = image.naturalHeight / analysisHeight;
      const xLines = result.vertical.map((line) => Math.round(line * scaleX));
      const yLines = result.horizontal.map((line) => Math.round(line * scaleY));

      setLoaded({ file, url, image });
      setCells(createCells(xLines, yLines));
      setColumnsInput(String(countCells(xLines)));
      setRowsInput(String(countCells(yLines)));
      setConfidence({ x: result.verticalConfidence, y: result.horizontalConfidence });
      setNotice("Detected layout boundaries. Review the tiles and deselect any title panels or empty cells before exporting.");
    };
    image.onerror = () => {
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
    setCells((current) => current.map((cell) =>
      cell.id === id ? { ...cell, selected: !cell.selected } : cell,
    ));
  };

  const setAllSelected = (selected: boolean) => {
    setCells((current) => current.map((cell) => ({ ...cell, selected })));
  };

  const applyEvenGrid = () => {
    if (!loaded) return;
    const requestedColumns = Number.parseInt(columnsInput, 10);
    const requestedRows = Number.parseInt(rowsInput, 10);
    if (!Number.isFinite(requestedColumns) || !Number.isFinite(requestedRows) ||
      requestedColumns < 1 || requestedRows < 1 || requestedColumns > 60 || requestedRows > 60) {
      setError("Rows and columns must be between 1 and 60.");
      return;
    }

    const xLines = makeEvenBoundaries(loaded.image.naturalWidth, requestedColumns);
    const yLines = makeEvenBoundaries(loaded.image.naturalHeight, requestedRows);
    setCells(createCells(xLines, yLines));
    setConfidence({ x: 0, y: 0 });
    setError("");
    setNotice("Applied an evenly spaced " + requestedColumns + " × " + requestedRows + " grid. Deselect any cells that are not individual frames.");
  };

  const redetect = () => {
    if (!loaded) return;
    const scale = Math.min(1, 1800 / loaded.image.naturalWidth, 1400 / loaded.image.naturalHeight);
    const width = Math.max(1, Math.round(loaded.image.naturalWidth * scale));
    const height = Math.max(1, Math.round(loaded.image.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return;
    context.drawImage(loaded.image, 0, 0, width, height);
    const result = detectGrid(context.getImageData(0, 0, width, height));
    const xLines = result.vertical.map((line) => Math.round(line * loaded.image.naturalWidth / width));
    const yLines = result.horizontal.map((line) => Math.round(line * loaded.image.naturalHeight / height));
    setCells(createCells(xLines, yLines));
    setColumnsInput(String(countCells(xLines)));
    setRowsInput(String(countCells(yLines)));
    setConfidence({ x: result.verticalConfidence, y: result.horizontalConfidence });
    setNotice("Re-scanned the image for continuous horizontal and vertical separator lines.");
    setError("");
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
      });
      const downloadUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = downloadUrl;
      anchor.download = "gridsplit-extracted-images.zip";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(downloadUrl);
      setNotice("ZIP created with " + selectedCells.length + " selected image" + (selectedCells.length === 1 ? "" : "s") + ".");
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : "The ZIP could not be created.");
    } finally {
      setIsExporting(false);
    }
  };

  const startOver = () => {
    releaseLoadedImage();
    setCells([]);
    setNotice("");
    setError("");
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
            <div><SlidersHorizontal size={18} /><span><b>Manual control</b><small>Adjust rows, columns and crops</small></span></div>
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
                <label className="setting-label">GRID DIMENSIONS</label>
                <div className="dimension-fields">
                  <label><span>Columns</span><input type="number" min="1" max="60" value={columnsInput} onChange={(event) => setColumnsInput(event.target.value)} /></label>
                  <label><span>Rows</span><input type="number" min="1" max="60" value={rowsInput} onChange={(event) => setRowsInput(event.target.value)} /></label>
                </div>
                <button className="button button-secondary full-button" onClick={applyEvenGrid}>Apply even grid</button>
                <button className="text-button" onClick={redetect}><ScanLine size={14} /> Detect boundaries again</button>
                <div className="confidence-row">
                  <span>Vertical lines <b>{confidence.x ? confidence.x + "%" : "manual"}</b></span>
                  <span>Horizontal lines <b>{confidence.y ? confidence.y + "%" : "manual"}</b></span>
                </div>
                <p className="helper-copy">Auto-detection looks for continuous contrast and dark separator lines. Even-grid mode is available when the sheet uses regular spacing.</p>
              </div>

              <div className="setting-section">
                <label className="setting-label" htmlFor="gutter">BORDER TRIM</label>
                <div className="range-heading"><span>Trim around each tile</span><b>{gutter} px</b></div>
                <input id="gutter" className="range-input" type="range" min="0" max="10" value={gutter} onChange={(event) => setGutter(Number(event.target.value))} />
                <p className="helper-copy">Removes the contact-sheet divider from the edge of each crop.</p>
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
                  <div className="stat-selected"><Check size={14} /> {selectedCells.length} selected for export</div>
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

              <div className="review-hint"><CircleHelp size={15} /> Click a tile to include or exclude it. Deselect title cards, labels, or empty cells.</div>

              <div className="image-grid">
                {cells.map((cell, index) => (
                  <button
                    type="button"
                    className={"image-card" + (cell.selected ? " image-card-selected" : " image-card-muted")}
                    key={cell.id}
                    onClick={() => toggleCell(cell.id)}
                    aria-pressed={cell.selected}
                    aria-label={(cell.selected ? "Exclude " : "Include ") + "row " + (cell.row + 1) + ", column " + (cell.column + 1)}
                  >
                    <div className="image-card-preview">
                      <CropPreview image={loaded.image} cell={cell} gutter={gutter} />
                      <span className={"selection-indicator" + (cell.selected ? " is-selected" : "")}>{cell.selected ? <Check size={12} /> : <X size={12} />}</span>
                    </div>
                    <div className="image-card-meta">
                      <b>{String(index + startNumber).padStart(digits, "0")}</b>
                      <span>R{String(cell.row + 1).padStart(2, "0")} · C{String(cell.column + 1).padStart(2, "0")}</span>
                    </div>
                  </button>
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