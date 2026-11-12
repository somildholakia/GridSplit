import { useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, KeyboardEvent as ReactKeyboardEvent } from "react";
import { Crosshair, Minus, Plus, RotateCcw, Scissors } from "lucide-react";
import "./grid-guide-editor.css";

type Guide = {
  id: string;
  position: number;
};

type GuideAxis = "vertical" | "horizontal";

type ActiveGuide = {
  axis: GuideAxis;
  id: string;
};

type GridGuideEditorProps = {
  image: HTMLImageElement;
  initialColumns: number;
  initialRows: number;
  onApply: (verticalCuts: number[], horizontalCuts: number[]) => void;
};

function createEvenGuides(count: number, axis: GuideAxis): Guide[] {
  const safeCount = Math.max(1, Math.min(60, Math.floor(count) || 1));
  return Array.from({ length: safeCount - 1 }, (_, index) => ({
    id: axis + "-initial-" + (index + 1),
    position: ((index + 1) / safeCount) * 100,
  }));
}

function insertAtLargestGap(guides: Guide[], id: string): Guide[] {
  const sorted = [...guides].sort((left, right) => left.position - right.position);
  const boundaries = [0, ...sorted.map((guide) => guide.position), 100];
  let largestIndex = 0;
  for (let index = 1; index < boundaries.length - 1; index += 1) {
    if (boundaries[index + 1] - boundaries[index] > boundaries[largestIndex + 1] - boundaries[largestIndex]) {
      largestIndex = index;
    }
  }
  const position = (boundaries[largestIndex] + boundaries[largestIndex + 1]) / 2;
  return [...sorted, { id, position }].sort((left, right) => left.position - right.position);
}

function moveGuide(guides: Guide[], id: string, nextPosition: number): Guide[] {
  const current = [...guides].sort((left, right) => left.position - right.position);
  const index = current.findIndex((guide) => guide.id === id);
  if (index < 0) return guides;
  const lower = index === 0 ? 0.4 : current[index - 1].position + 0.4;
  const upper = index === current.length - 1 ? 99.6 : current[index + 1].position - 0.4;
  const position = Math.max(lower, Math.min(upper, nextPosition));
  return current.map((guide) => guide.id === id ? { ...guide, position } : guide)
    .sort((left, right) => left.position - right.position);
}

function GuideControls({
  axis,
  guides,
  active,
  onAdd,
  onRemove,
  onSelect,
}: {
  axis: GuideAxis;
  guides: Guide[];
  active: boolean;
  onAdd: () => void;
  onRemove: () => void;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="grid-guide-axis">
      <div>
        <b>{axis === "vertical" ? "Column cuts" : "Row cuts"}</b>
        <small>{guides.length} guide{guides.length === 1 ? "" : "s"} · {guides.length + 1} {axis === "vertical" ? "columns" : "rows"}</small>
      </div>
      <div className="grid-guide-axis-actions">
        <button type="button" onClick={onAdd} disabled={guides.length >= 59} aria-label={"Add " + axis + " cut"}><Plus size={14} /> Add</button>
        <button type="button" onClick={onRemove} disabled={!active} aria-label={"Remove selected " + axis + " cut"}><Minus size={14} /> Remove</button>
      </div>
      {guides.length > 0 && (
        <div className="grid-guide-line-list">
          {guides.map((guide, index) => (
            <button
              type="button"
              key={guide.id}
              className={active && guide.id === activeGuideIdPlaceholder ? "active" : ""}
              onClick={() => onSelect(guide.id)}
            >
              {axis === "vertical" ? "V" : "H"}{index + 1} · {guide.position.toFixed(1)}%
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function guideCountLabel(vertical: Guide[], horizontal: Guide[]): string {
  return ((vertical.length + 1) * (horizontal.length + 1)).toLocaleString() + " output regions";
}

export function GridGuideEditor({
  image,
  initialColumns,
  initialRows,
  onApply,
}: GridGuideEditorProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const nextIdRef = useRef(0);
  const dragRef = useRef<ActiveGuide | null>(null);
  const [verticalGuides, setVerticalGuides] = useState(() => createEvenGuides(initialColumns, "vertical"));
  const [horizontalGuides, setHorizontalGuides] = useState(() => createEvenGuides(initialRows, "horizontal"));
  const [activeGuide, setActiveGuide] = useState<ActiveGuide | null>(null);

  const regionCount = useMemo(
    () => (verticalGuides.length + 1) * (horizontalGuides.length + 1),
    [verticalGuides.length, horizontalGuides.length],
  );

  const makeId = (axis: GuideAxis) => {
    nextIdRef.current += 1;
    return axis + "-manual-" + nextIdRef.current;
  };

  const updateGuideAtPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    const active = dragRef.current;
    const stage = stageRef.current;
    if (!active || !stage) return;
    const bounds = stage.getBoundingClientRect();
    const rawPosition = active.axis === "vertical"
      ? ((event.clientX - bounds.left) / bounds.width) * 100
      : ((event.clientY - bounds.top) / bounds.height) * 100;
    const setter = active.axis === "vertical" ? setVerticalGuides : setHorizontalGuides;
    setter((current) => moveGuide(current, active.id, rawPosition));
  };

  const startDragging = (
    axis: GuideAxis,
    id: string,
    event: ReactPointerEvent<HTMLButtonElement>,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    dragRef.current = { axis, id };
    setActiveGuide({ axis, id });
    const stage = stageRef.current;
    if (stage && stage.setPointerCapture) stage.setPointerCapture(event.pointerId);
  };

  const finishDragging = (event: ReactPointerEvent<HTMLDivElement>) => {
    dragRef.current = null;
    const stage = stageRef.current;
    if (stage?.hasPointerCapture?.(event.pointerId)) stage.releasePointerCapture(event.pointerId);
  };

  const addGuide = (axis: GuideAxis) => {
    const id = makeId(axis);
    if (axis === "vertical") {
      setVerticalGuides((current) => insertAtLargestGap(current, id));
    } else {
      setHorizontalGuides((current) => insertAtLargestGap(current, id));
    }
    setActiveGuide({ axis, id });
  };

  const removeGuide = (axis: GuideAxis) => {
    if (!activeGuide || activeGuide.axis !== axis) return;
    if (axis === "vertical") {
      setVerticalGuides((current) => current.filter((guide) => guide.id !== activeGuide.id));
    } else {
      setHorizontalGuides((current) => current.filter((guide) => guide.id !== activeGuide.id));
    }
    setActiveGuide(null);
  };

  const selectGuide = (axis: GuideAxis, id: string) => {
    setActiveGuide({ axis, id });
  };

  const resetEven = () => {
    setVerticalGuides(createEvenGuides(initialColumns, "vertical"));
    setHorizontalGuides(createEvenGuides(initialRows, "horizontal"));
    setActiveGuide(null);
    dragRef.current = null;
  };

  const nudgeGuide = (axis: GuideAxis, id: string, delta: number) => {
    const setter = axis === "vertical" ? setVerticalGuides : setHorizontalGuides;
    setter((current) => {
      const guide = current.find((item) => item.id === id);
      return guide ? moveGuide(current, id, guide.position + delta) : current;
    });
  };

  const handleGuideKeyDown = (
    axis: GuideAxis,
    id: string,
    event: ReactKeyboardEvent<HTMLButtonElement>,
  ) => {
    const step = event.shiftKey ? 2 : 0.5;
    if ((axis === "vertical" && event.key === "ArrowLeft") ||
      (axis === "horizontal" && event.key === "ArrowUp")) {
      event.preventDefault();
      nudgeGuide(axis, id, -step);
    } else if ((axis === "vertical" && event.key === "ArrowRight") ||
      (axis === "horizontal" && event.key === "ArrowDown")) {
      event.preventDefault();
      nudgeGuide(axis, id, step);
    } else if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      if (axis === "vertical") setVerticalGuides((current) => current.filter((guide) => guide.id !== id));
      else setHorizontalGuides((current) => current.filter((guide) => guide.id !== id));
      setActiveGuide(null);
    }
  };

  const apply = () => {
    const verticalCuts = verticalGuides
      .map((guide) => Math.round((guide.position / 100) * image.naturalWidth))
      .sort((left, right) => left - right);
    const horizontalCuts = horizontalGuides
      .map((guide) => Math.round((guide.position / 100) * image.naturalHeight))
      .sort((left, right) => left - right);
    onApply(verticalCuts, horizontalCuts);
  };

  const selectedVertical = activeGuide?.axis === "vertical" ? activeGuide.id : null;
  const selectedHorizontal = activeGuide?.axis === "horizontal" ? activeGuide.id : null;
  const aspectRatio = image.naturalWidth / Math.max(1, image.naturalHeight);
  const stageWidth = Math.min(920, Math.max(150, Math.round(520 * aspectRatio)));

  return (
    <section className="grid-guide-editor">
      <div className="grid-guide-heading">
        <div>
          <div className="grid-guide-kicker"><Crosshair size={13} /> MANUAL GRID GUIDES</div>
          <h3>Place your own split lines</h3>
          <p>Drag each guide onto a divider in the collage. Guides can be unevenly spaced, so wide and narrow frames are both supported.</p>
        </div>
        <div className="grid-guide-count">{regionCount.toLocaleString()}<small>regions</small></div>
      </div>

      <div className="grid-guide-stage-shell">
        <div
          ref={stageRef}
          className="grid-guide-stage"
          style={{ width: stageWidth + "px", maxWidth: "100%", aspectRatio: image.naturalWidth + " / " + image.naturalHeight }}
          onPointerMove={updateGuideAtPointer}
          onPointerUp={finishDragging}
          onPointerCancel={finishDragging}
          onLostPointerCapture={() => { dragRef.current = null; }}
        >
          <img src={image.src} alt="Contact sheet being divided by manual grid guides" draggable={false} />
          <div className="grid-guide-overlay" aria-hidden="true">
            {verticalGuides.map((guide, index) => (
              <div className="grid-guide-vertical" key={guide.id} style={{ left: guide.position + "%" }}>
                <span>{index + 1}</span>
              </div>
            ))}
            {horizontalGuides.map((guide, index) => (
              <div className="grid-guide-horizontal" key={guide.id} style={{ top: guide.position + "%" }}>
                <span>{index + 1}</span>
              </div>
            ))}
          </div>
          {verticalGuides.map((guide, index) => (
            <button
              type="button"
              key={guide.id}
              className={"grid-guide-handle vertical" + (selectedVertical === guide.id ? " active" : "")}
              style={{ left: guide.position + "%" }}
              aria-label={"Vertical guide " + (index + 1) + " at " + guide.position.toFixed(1) + " percent. Use arrow keys to adjust or Delete to remove."}
              aria-pressed={selectedVertical === guide.id}
              onPointerDown={(event) => startDragging("vertical", guide.id, event)}
              onKeyDown={(event) => handleGuideKeyDown("vertical", guide.id, event)}
              onClick={() => selectGuide("vertical", guide.id)}
              title={"Vertical cut at " + guide.position.toFixed(1) + "%"}
            />
          ))}
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
            <b>Vertical lines</b>
            <small>{verticalGuides.length} cuts · {verticalGuides.length + 1} columns</small>
          </div>
          <div className="grid-guide-axis-actions">
            <button type="button" onClick={() => addGuide("vertical")} disabled={verticalGuides.length >= 59}><Plus size={14} /> Add line</button>
            <button type="button" onClick={() => removeGuide("vertical")} disabled={!selectedVertical}><Minus size={14} /> Remove selected</button>
          </div>
          <div className="grid-guide-line-list">
            {verticalGuides.map((guide, index) => (
              <button type="button" key={guide.id} className={selectedVertical === guide.id ? "active" : ""} onClick={() => selectGuide("vertical", guide.id)}>
                V{index + 1} · {guide.position.toFixed(1)}%
              </button>
            ))}
            {!verticalGuides.length && <span>No vertical cuts yet.</span>}
          </div>
        </div>

        <div className="grid-guide-control-group">
          <div>
            <b>Horizontal lines</b>
            <small>{horizontalGuides.length} cuts · {horizontalGuides.length + 1} rows</small>
          </div>
          <div className="grid-guide-axis-actions">
            <button type="button" onClick={() => addGuide("horizontal")} disabled={horizontalGuides.length >= 59}><Plus size={14} /> Add line</button>
            <button type="button" onClick={() => removeGuide("horizontal")} disabled={!selectedHorizontal}><Minus size={14} /> Remove selected</button>
          </div>
          <div className="grid-guide-line-list">
            {horizontalGuides.map((guide, index) => (
              <button type="button" key={guide.id} className={selectedHorizontal === guide.id ? "active" : ""} onClick={() => selectGuide("horizontal", guide.id)}>
                H{index + 1} · {guide.position.toFixed(1)}%
              </button>
            ))}
            {!horizontalGuides.length && <span>No horizontal cuts yet.</span>}
          </div>
        </div>
      </div>

      <div className="grid-guide-footer">
        <span>{guideCountLabel(verticalGuides, horizontalGuides)} · Select a line, then use Delete or the Remove button.</span>
        <div>
          <button type="button" className="grid-guide-reset" onClick={resetEven}><RotateCcw size={14} /> Reset even</button>
          <button type="button" className="grid-guide-apply" onClick={apply}><Scissors size={14} /> Apply split lines</button>
        </div>
      </div>
    </section>
  );
}
