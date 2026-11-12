import { createPortal } from "react-dom";
import { useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, KeyboardEvent as ReactKeyboardEvent, ClipboardEvent as ReactClipboardEvent } from "react";
import { ClipboardPaste, Crosshair, Expand, Minus, Minimize2, Plus, RotateCcw, Scissors, Terminal, X } from "lucide-react";
import "./grid-guide-editor.css";
import { parseGridCoordinatePayload } from "../../lib/gridCoordinateImport";

type Guide = {
  id: string;
  position: number;
};

type GuideAxis = "vertical" | "horizontal";

type ActiveGuide = {
  axis: GuideAxis;
  id: string;
  row?: number;
};

type GuideInsertion = {
  guides: Guide[];
  index: number;
  position: number;
};

type GridGuideEditorProps = {
  image: HTMLImageElement;
  open: boolean;
  initialColumns: number;
  initialRows: number;
  onApply: (verticalCutsByRow: number[][], horizontalCuts: number[]) => void;
};

function createEvenGuides(count: number, axis: GuideAxis): Guide[] {
  const safeCount = Math.max(1, Math.min(60, Math.floor(count) || 1));
  return Array.from({ length: safeCount - 1 }, (_, index) => ({
    id: axis + "-initial-" + (index + 1),
    position: ((index + 1) / safeCount) * 100,
  }));
}

function createEvenRows(rows: number, columns: number): Guide[][] {
  return Array.from({ length: Math.max(1, Math.min(60, rows)) }, (_, row) =>
    createEvenGuides(columns, "vertical").map((guide, index) => ({
      ...guide,
      id: "vertical-row-" + row + "-initial-" + (index + 1),
    })),
  );
}

function cloneGuides(guides: Guide[], makeId: () => string): Guide[] {
  return guides.map((guide) => ({ ...guide, id: makeId() }));
}

function insertAtLargestGap(guides: Guide[], id: string): GuideInsertion {
  const sorted = [...guides].sort((left, right) => left.position - right.position);
  const boundaries = [0, ...sorted.map((guide) => guide.position), 100];
  let largestIndex = 0;
  for (let index = 1; index < boundaries.length - 1; index += 1) {
    if (
      boundaries[index + 1] - boundaries[index] >
      boundaries[largestIndex + 1] - boundaries[largestIndex]
    ) {
      largestIndex = index;
    }
  }
  const position = (boundaries[largestIndex] + boundaries[largestIndex + 1]) / 2;
  return {
    guides: [...sorted, { id, position }].sort((left, right) => left.position - right.position),
    index: largestIndex,
    position,
  };
}

function moveGuide(guides: Guide[], id: string, nextPosition: number): Guide[] {
  const current = [...guides].sort((left, right) => left.position - right.position);
  const index = current.findIndex((guide) => guide.id === id);
  if (index < 0) return guides;
  const lower = index === 0 ? 0.4 : current[index - 1].position + 0.4;
  const upper = index === current.length - 1 ? 99.6 : current[index + 1].position - 0.4;
  const position = Math.max(lower, Math.min(upper, nextPosition));
  return current
    .map((guide) => guide.id === id ? { ...guide, position } : guide)
    .sort((left, right) => left.position - right.position);
}

function guideCountLabel(verticalByRow: Guide[][]): string {
  const regions = verticalByRow.reduce((total, guides) => total + guides.length + 1, 0);
  return regions.toLocaleString() + " output regions across " + verticalByRow.length + " rows";
}

export function GridGuideEditor({
  image,
  open,
  initialColumns,
  initialRows,
  onApply,
}: GridGuideEditorProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const nextIdRef = useRef(0);
  const dragRef = useRef<ActiveGuide | null>(null);
  const [verticalGuidesByRow, setVerticalGuidesByRow] = useState(() =>
    createEvenRows(initialRows, initialColumns),
  );
  const [horizontalGuides, setHorizontalGuides] = useState(() =>
    createEvenGuides(initialRows, "horizontal"),
  );
  const [selectedRow, setSelectedRow] = useState(0);
  const [activeGuide, setActiveGuide] = useState<ActiveGuide | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [viewportSize, setViewportSize] = useState({ width: 1280, height: 900 });
  const [coordinateText, setCoordinateText] = useState("");
  const [coordinateStatus, setCoordinateStatus] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

  const activeRowGuides = verticalGuidesByRow[selectedRow] ?? [];
  const activeVerticalId =
    activeGuide?.axis === "vertical" && activeGuide.row === selectedRow
      ? activeGuide.id
      : null;
  const selectedVertical = activeVerticalId;
  const selectedHorizontal =
    activeGuide?.axis === "horizontal" ? activeGuide.id : null;

  const regionCount = useMemo(
    () => verticalGuidesByRow.reduce((total, guides) => total + guides.length + 1, 0),
    [verticalGuidesByRow],
  );

  const makeId = (axis: GuideAxis) => {
    nextIdRef.current += 1;
    return axis + "-manual-" + nextIdRef.current;
  };

  useEffect(() => {
    if (!isFullscreen) return;
    const previousOverflow = document.body.style.overflow;
    const updateViewport = () => {
      setViewportSize({ width: window.innerWidth, height: window.innerHeight });
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsFullscreen(false);
    };

    document.body.style.overflow = "hidden";
    updateViewport();
    window.addEventListener("resize", updateViewport);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("resize", updateViewport);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isFullscreen]);

  const updateGuideAtPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    const active = dragRef.current;
    const stage = stageRef.current;
    if (!active || !stage) return;
    const bounds = stage.getBoundingClientRect();
    const rawPosition = active.axis === "vertical"
      ? ((event.clientX - bounds.left) / bounds.width) * 100
      : ((event.clientY - bounds.top) / bounds.height) * 100;

    if (active.axis === "vertical") {
      const activeRow = active.row ?? 0;
      setVerticalGuidesByRow((current) =>
        current.map((guides, row) =>
          row === activeRow ? moveGuide(guides, active.id, rawPosition) : guides,
        ),
      );
    } else {
      setHorizontalGuides((current) => moveGuide(current, active.id, rawPosition));
    }
  };

  const startDragging = (
    axis: GuideAxis,
    id: string,
    event: ReactPointerEvent<HTMLButtonElement>,
    row?: number,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    dragRef.current = { axis, id, row };
    setActiveGuide({ axis, id, row });
    const stage = stageRef.current;
    if (stage && stage.setPointerCapture) stage.setPointerCapture(event.pointerId);
  };

  const finishDragging = (event: ReactPointerEvent<HTMLDivElement>) => {
    dragRef.current = null;
    const stage = stageRef.current;
    if (stage?.hasPointerCapture?.(event.pointerId)) {
      stage.releasePointerCapture(event.pointerId);
    }
  };

  const selectGuide = (axis: GuideAxis, id: string, row?: number) => {
    setActiveGuide({ axis, id, row });
  };

  const addVerticalGuide = () => {
    if (activeRowGuides.length >= 59) return;
    const id = makeId("vertical");
    setVerticalGuidesByRow((current) =>
      current.map((guides, row) =>
        row === selectedRow
          ? insertAtLargestGap(guides, id).guides
          : guides,
      ),
    );
    setActiveGuide({ axis: "vertical", id, row: selectedRow });
  };

  const addHorizontalGuide = () => {
    if (horizontalGuides.length >= 59) return;
    const id = makeId("horizontal");
    const insertion = insertAtLargestGap(horizontalGuides, id);
    const sourceRow = verticalGuidesByRow[insertion.index] ?? [];
    setHorizontalGuides(insertion.guides);
    setVerticalGuidesByRow((current) => [
      ...current.slice(0, insertion.index),
      cloneGuides(sourceRow, () => makeId("vertical")),
      cloneGuides(sourceRow, () => makeId("vertical")),
      ...current.slice(insertion.index + 1),
    ]);
    setSelectedRow(insertion.index);
    setActiveGuide({ axis: "horizontal", id });
  };

  const removeGuide = (axis: GuideAxis, id: string, row?: number) => {
    if (axis === "vertical") {
      const targetRow = row ?? selectedRow;
      setVerticalGuidesByRow((current) =>
        current.map((guides, index) =>
          index === targetRow ? guides.filter((guide) => guide.id !== id) : guides,
        ),
      );
      setActiveGuide(null);
      return;
    }

    const targetIndex = horizontalGuides.findIndex((guide) => guide.id === id);
    if (targetIndex < 0) return;
    setHorizontalGuides((current) => current.filter((guide) => guide.id !== id));
    // Removing a horizontal boundary joins two rows. Keep the upper row's
    // vertical guides; the merged row can then be adjusted independently.
    setVerticalGuidesByRow((current) =>
      current.filter((_, index) => index !== targetIndex + 1),
    );
    setSelectedRow((current) => {
      if (current > targetIndex + 1) return current - 1;
      if (current === targetIndex + 1) return targetIndex;
      return current;
    });
    setActiveGuide(null);
  };

  const nudgeGuide = (axis: GuideAxis, id: string, delta: number, row?: number) => {
    if (axis === "vertical") {
      const targetRow = row ?? selectedRow;
      setVerticalGuidesByRow((current) =>
        current.map((guides, index) =>
          index === targetRow
            ? moveGuide(guides, id, (guides.find((guide) => guide.id === id)?.position ?? 0) + delta)
            : guides,
        ),
      );
      return;
    }
    setHorizontalGuides((current) =>
      moveGuide(current, id, (current.find((guide) => guide.id === id)?.position ?? 0) + delta),
    );
  };

  const handleGuideKeyDown = (
    axis: GuideAxis,
    id: string,
    event: ReactKeyboardEvent<HTMLButtonElement>,
    row?: number,
  ) => {
    const step = event.shiftKey ? 2 : 0.5;
    if (
      (axis === "vertical" && (event.key === "ArrowLeft" || event.key === "ArrowRight")) ||
      (axis === "horizontal" && (event.key === "ArrowUp" || event.key === "ArrowDown"))
    ) {
      event.preventDefault();
      const direction =
        event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 1;
      nudgeGuide(axis, id, step * direction, row);
    } else if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      removeGuide(axis, id, row);
    }
  };

  const resetEven = () => {
    setVerticalGuidesByRow(createEvenRows(initialRows, initialColumns));
    setHorizontalGuides(createEvenGuides(initialRows, "horizontal"));
    setSelectedRow(0);
    setActiveGuide(null);
    dragRef.current = null;
  };

  const apply = () => {
    const verticalCutsByRow = verticalGuidesByRow.map((guides) =>
      guides
        .map((guide) => Math.round((guide.position / 100) * image.naturalWidth))
        .sort((left, right) => left - right),
    );
    const horizontalCuts = horizontalGuides
      .map((guide) => Math.round((guide.position / 100) * image.naturalHeight))
      .sort((left, right) => left - right);
    onApply(verticalCutsByRow, horizontalCuts);
  };

  const importCoordinates = (rawText: string) => {
    try {
      const parsed = parseGridCoordinatePayload(
        rawText,
        image.naturalWidth,
        image.naturalHeight,
      );
      const nextVerticalGuides = parsed.verticalCutsByRow.map((cuts) =>
        cuts.map((coordinate) => ({
          id: makeId("vertical"),
          position: (coordinate / image.naturalWidth) * 100,
        })),
      );
      const nextHorizontalGuides = parsed.horizontalCuts.map((coordinate) => ({
        id: makeId("horizontal"),
        position: (coordinate / image.naturalHeight) * 100,
      }));

      setVerticalGuidesByRow(nextVerticalGuides);
      setHorizontalGuides(nextHorizontalGuides);
      setSelectedRow(0);
      setActiveGuide(null);
      dragRef.current = null;
      onApply(parsed.verticalCutsByRow, parsed.horizontalCuts);
      const verticalCount = parsed.verticalCutsByRow.reduce((total, cuts) => total + cuts.length, 0);
      const regionCount = parsed.verticalCutsByRow.reduce((total, cuts) => total + cuts.length + 1, 0);
      setCoordinateStatus({
        type: "success",
        message: `Applied ${verticalCount + parsed.horizontalCuts.length} guides (${verticalCount} vertical, ${parsed.horizontalCuts.length} horizontal) across ${parsed.verticalCutsByRow.length} rows. ${regionCount} regions are ready in the splitter.`,
      });
    } catch (importError) {
      setCoordinateStatus({
        type: "error",
        message: importError instanceof Error ? importError.message : "Could not import these coordinates.",
      });
    }
  };

  const handleCoordinatePaste = (event: ReactClipboardEvent<HTMLTextAreaElement>) => {
    const pastedText = event.clipboardData.getData("text/plain") || event.clipboardData.getData("text");
    if (!pastedText.trim()) return;
    event.preventDefault();
    setCoordinateText(pastedText);
    importCoordinates(pastedText);
  };

  const horizontalBoundaries = [
    0,
    ...horizontalGuides.map((guide) => guide.position).sort((a, b) => a - b),
    100,
  ];
  const aspectRatio = image.naturalWidth / Math.max(1, image.naturalHeight);
  const stageWidth = Math.min(920, Math.max(150, Math.round(520 * aspectRatio)));
  const stageStyle = {
    width: (isFullscreen
      ? Math.min(
          viewportSize.width * 0.94,
          Math.max(120, (viewportSize.height - 360) * aspectRatio),
        )
      : stageWidth) + "px",
    maxWidth: "100%",
    aspectRatio: image.naturalWidth + " / " + image.naturalHeight,
  };

  if (!open) return null;

  const editorContent = (
    <section className={"grid-guide-editor" + (isFullscreen ? " is-fullscreen" : "")}>
      <div className="grid-guide-heading">
        <div>
          <div className="grid-guide-kicker"><Crosshair size={13} /> MANUAL GRID GUIDES</div>
          <h3>{isFullscreen ? "Full-screen grid editor" : "Place your own split lines"}</h3>
          <p>Choose a row, then drag its vertical guides. Vertical lines only split the selected row. Horizontal lines continue across the full image.</p>
        </div>
        <div className="grid-guide-heading-actions">
          <div className="grid-guide-count">{regionCount.toLocaleString()}<small>regions</small></div>
          <button
            type="button"
            className="grid-guide-expand"
            onClick={() => setIsFullscreen((current) => !current)}
            aria-label={isFullscreen ? "Exit full-screen editor" : "Open full-screen editor"}
            title={isFullscreen ? "Exit full screen (Esc)" : "Open full screen"}
          >
            {isFullscreen ? <Minimize2 size={16} /> : <Expand size={16} />}
            {isFullscreen ? "Exit full screen" : "Full size"}
          </button>
        </div>
      </div>

      <div className="grid-guide-coordinate-terminal">
        <div className="grid-guide-terminal-heading">
          <div>
            <div className="grid-guide-terminal-title"><Terminal size={14} /> BULK COORDINATE TERMINAL</div>
            <p>Paste one complete coordinate block. A valid paste is assigned to the grid and splitter immediately.</p>
          </div>
          <span>{image.naturalWidth.toLocaleString()} × {image.naturalHeight.toLocaleString()} px</span>
        </div>
        <textarea
          className="grid-guide-terminal-input"
          value={coordinateText}
          onChange={(event) => {
            setCoordinateText(event.target.value);
            setCoordinateStatus(null);
          }}
          onPaste={handleCoordinatePaste}
          rows={5}
          spellCheck={false}
          aria-label="Paste all image grid coordinates as JSON"
          placeholder={'{\n  "width": 1536,\n  "height": 864,\n  "horizontalCuts": [86, 173],\n  "verticalCutsByRow": [\n    [256, 512, 768],\n    [192, 576],\n    [256, 512, 768]\n  ]\n}'}
        />
        <div className="grid-guide-terminal-footer">
          <span>Pixels from top-left · X cuts per row · Y cuts span full width · paste once</span>
          <div>
            <button
              type="button"
              className="grid-guide-terminal-clear"
              onClick={() => {
                setCoordinateText("");
                setCoordinateStatus(null);
              }}
            >Clear</button>
            <button
              type="button"
              className="grid-guide-terminal-apply"
              onClick={() => importCoordinates(coordinateText)}
              disabled={!coordinateText.trim()}
            ><ClipboardPaste size={13} /> Apply all coordinates</button>
          </div>
        </div>
        {coordinateStatus && (
          <div
            className={"grid-guide-terminal-status " + coordinateStatus.type}
            role={coordinateStatus.type === "error" ? "alert" : "status"}
          >{coordinateStatus.message}</div>
        )}
      </div>

      <div className="grid-guide-stage-shell">
        <div
          ref={stageRef}
          className="grid-guide-stage"
          style={stageStyle}
          onPointerMove={updateGuideAtPointer}
          onPointerUp={finishDragging}
          onPointerCancel={finishDragging}
          onLostPointerCapture={() => { dragRef.current = null; }}
        >
          <img src={image.src} alt="Contact sheet being divided by manual grid guides" draggable={false} />
          <div className="grid-guide-overlay" aria-hidden="true">
            {verticalGuidesByRow.map((guides, row) => {
              const top = horizontalBoundaries[row];
              const bottom = horizontalBoundaries[row + 1];
              return guides.map((guide, index) => (
                <div
                  className={"grid-guide-vertical" + (row === selectedRow ? " row-active" : "")}
                  key={guide.id}
                  style={{
                    left: guide.position + "%",
                    top: top + "%",
                    height: (bottom - top) + "%",
                  }}
                >
                  <span>R{row + 1} · {index + 1}</span>
                </div>
              ));
            })}
            {horizontalGuides.map((guide, index) => (
              <div className="grid-guide-horizontal" key={guide.id} style={{ top: guide.position + "%" }}>
                <span>{index + 1}</span>
              </div>
            ))}
          </div>
          {verticalGuidesByRow.map((guides, row) => {
            const top = horizontalBoundaries[row];
            const bottom = horizontalBoundaries[row + 1];
            const rowCenter = (top + bottom) / 2;
            return guides.map((guide, index) => (
              <button
                type="button"
                key={guide.id}
                className={"grid-guide-handle vertical" + (activeVerticalId === guide.id && row === selectedRow ? " active" : "") + (row === selectedRow ? " row-active" : "")}
                style={{ left: guide.position + "%", top: rowCenter + "%" }}
                aria-label={"Vertical guide " + (index + 1) + " in row " + (row + 1) + " at " + guide.position.toFixed(1) + " percent. Use arrow keys to adjust or Delete to remove."}
                aria-pressed={activeVerticalId === guide.id && row === selectedRow}
                onPointerDown={(event) => startDragging("vertical", guide.id, event, row)}
                onKeyDown={(event) => handleGuideKeyDown("vertical", guide.id, event, row)}
                onClick={() => {
                  setSelectedRow(row);
                  selectGuide("vertical", guide.id, row);
                }}
                title={"Row " + (row + 1) + " · vertical cut at " + guide.position.toFixed(1) + "%"}
              />
            ));
          })}
          {horizontalGuides.map((guide, index) => (
            <button
              type="button"
              key={guide.id}
              className={"grid-guide-handle horizontal" + (selectedHorizontal === guide.id ? " active" : "")}
              style={{ top: guide.position + "%" }}
              aria-label={"Horizontal guide " + (index + 1) + " at " + guide.position.toFixed(1) + " percent. Use arrow keys to adjust or Delete to remove."}
              aria-pressed={selectedHorizontal === guide.id}
              onPointerDown={(event) => startDragging("horizontal", guide.id, event)}
              onKeyDown={(event) => handleGuideKeyDown("horizontal", guide.id, event)}
              onClick={() => selectGuide("horizontal", guide.id)}
              title={"Horizontal cut at " + guide.position.toFixed(1) + "%"}
            />
          ))}
        </div>
      </div>

      <div className="grid-guide-controls">
        <div className="grid-guide-control-group">
          <div>
            <b>Vertical lines · Row {selectedRow + 1}</b>
            <small>{activeRowGuides.length} cuts · {activeRowGuides.length + 1} columns</small>
          </div>
          <div className="grid-guide-row-picker" aria-label="Choose row to edit">
            {verticalGuidesByRow.map((_, row) => (
              <button
                type="button"
                key={row}
                className={selectedRow === row ? "active" : ""}
                onClick={() => {
                  setSelectedRow(row);
                  setActiveGuide(null);
                }}
              >
                Row {row + 1}
              </button>
            ))}
          </div>
          <div className="grid-guide-axis-actions">
            <button type="button" onClick={addVerticalGuide} disabled={activeRowGuides.length >= 59}><Plus size={14} /> Add line to row {selectedRow + 1}</button>
            <button type="button" onClick={() => activeVerticalId && removeGuide("vertical", activeVerticalId, selectedRow)} disabled={!activeVerticalId}><Minus size={14} /> Remove selected</button>
          </div>
          <div className="grid-guide-line-list">
            {activeRowGuides.map((guide, index) => (
              <button
                type="button"
                key={guide.id}
                className={selectedVertical === guide.id ? "active" : ""}
                onClick={() => selectGuide("vertical", guide.id, selectedRow)}
              >
                V{index + 1} · {guide.position.toFixed(1)}%
              </button>
            ))}
            {!activeRowGuides.length && <span>No vertical cuts in this row yet.</span>}
          </div>
        </div>

        <div className="grid-guide-control-group">
          <div>
            <b>Horizontal lines</b>
            <small>{horizontalGuides.length} cuts · {horizontalGuides.length + 1} rows</small>
          </div>
          <div className="grid-guide-axis-actions">
            <button type="button" onClick={addHorizontalGuide} disabled={horizontalGuides.length >= 59}><Plus size={14} /> Add line</button>
            <button type="button" onClick={() => selectedHorizontal && removeGuide("horizontal", selectedHorizontal)} disabled={!selectedHorizontal}><Minus size={14} /> Remove selected</button>
          </div>
          <div className="grid-guide-line-list">
            {horizontalGuides.map((guide, index) => (
              <button
                type="button"
                key={guide.id}
                className={selectedHorizontal === guide.id ? "active" : ""}
                onClick={() => selectGuide("horizontal", guide.id)}
              >
                H{index + 1} · {guide.position.toFixed(1)}%
              </button>
            ))}
            {!horizontalGuides.length && <span>No horizontal cuts yet.</span>}
          </div>
        </div>
      </div>

      <div className="grid-guide-footer">
        <span>{guideCountLabel(verticalGuidesByRow)} · Row-specific vertical cuts · Full-width horizontal cuts</span>
        <div>
          <button type="button" className="grid-guide-reset" onClick={resetEven}><RotateCcw size={14} /> Reset even</button>
          <button type="button" className="grid-guide-apply" onClick={apply}><Scissors size={14} /> Apply split lines</button>
          {isFullscreen && (
            <button type="button" className="grid-guide-reset" onClick={() => setIsFullscreen(false)}><X size={14} /> Close</button>
          )}
        </div>
      </div>
    </section>
  );

  return isFullscreen ? createPortal(editorContent, document.body) : editorContent;
}
